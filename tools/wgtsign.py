"""Tizen .wgt signing + verification (Samsung TV).

Reproduces the Tizen W3C widget signature format byte-for-byte:

  author-signature.xml   Id=AuthorSignature      role-author
      References: every packaged file (sorted) + #prop
  signature1.xml         Id=DistributorSignature role-distributor
      References: author-signature.xml + every packaged file + #prop

Per-file References use percent-encoded URIs (quote with safe=''), SHA-512
digests.  #prop points at the <Object Id="prop"> SignatureProperties and is
digested with inclusive C14N.  SignedInfo is canonically serialised with
exclusive C14N and signed RSA-PKCS#1 v1.5 / SHA-512.
"""

from __future__ import annotations

import base64
import hashlib
import os
import zipfile
from urllib.parse import quote, unquote

from lxml import etree
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import padding

DS = "http://www.w3.org/2000/09/xmldsig#"
DSP = "http://www.w3.org/2009/xmldsig-properties"
C14N = "http://www.w3.org/2001/10/xml-exc-c14n#"
C14N11 = "http://www.w3.org/2006/12/xml-c14n11"
RSA_SHA512 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"
SHA512 = "http://www.w3.org/2001/04/xmlenc#sha512"
PROFILE_URI = "http://www.w3.org/ns/widgets-digsig#profile"

SIG_FILES = ("author-signature.xml", "signature1.xml")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _wrap(value: str, width: int = 76) -> str:
    return "\n".join(value[i : i + width] for i in range(0, len(value), width))


def _flat(text: str) -> str:
    return "".join(text.split())


def uri_for(path: str) -> str:
    """config.js -> config.js ; css/home.css -> css%2Fhome.css"""
    return quote(path, safe="")


def _c14n_inclusive(elem) -> bytes:
    """C14N over a standalone element (ns decls lift to its own root)."""
    standalone = etree.fromstring(etree.tostring(elem))
    return etree.tostring(
        standalone, method="c14n", exclusive=False, with_comments=False
    )


def load_p12(path: str, password: str):
    with open(path, "rb") as fh:
        blob = fh.read()
    key, cert, extra = pkcs12.load_key_and_certificates(blob, password.encode())
    return key, [cert] + list(extra or [])


def _props_object(sig_id: str, role: str):
    obj = etree.Element(f"{{{DS}}}Object", nsmap={None: DS})
    obj.set("Id", "prop")
    props = etree.SubElement(obj, f"{{{DSP}}}SignatureProperties")
    for pid, local, val in (
        ("profile", "Profile", PROFILE_URI),
        ("role", "Role", f"http://www.w3.org/ns/widgets-digsig#role-{role}"),
        ("identifier", "Identifier", None),
    ):
        prop = etree.SubElement(props, f"{{{DSP}}}SignatureProperty")
        prop.set("Id", pid)
        prop.set("Target", f"#{sig_id}")
        el = etree.SubElement(prop, f"{{{DSP}}}{local}")
        if val:
            el.set("URI", val)
    return obj


def _make_signature(refs, key, certs, sig_id: str, role: str) -> bytes:
    sig = etree.Element(f"{{{DS}}}Signature", nsmap={None: DS})
    sig.set("Id", sig_id)

    signed_info = etree.SubElement(sig, f"{{{DS}}}SignedInfo")
    cm = etree.SubElement(signed_info, f"{{{DS}}}CanonicalizationMethod")
    cm.set("Algorithm", C14N)
    sm = etree.SubElement(signed_info, f"{{{DS}}}SignatureMethod")
    sm.set("Algorithm", RSA_SHA512)

    for path, data in refs:
        ref = etree.SubElement(signed_info, f"{{{DS}}}Reference")
        ref.set("URI", uri_for(path))
        dm = etree.SubElement(ref, f"{{{DS}}}DigestMethod")
        dm.set("Algorithm", SHA512)
        dv = etree.SubElement(ref, f"{{{DS}}}DigestValue")
        dv.text = _wrap(_b64(hashlib.sha512(data).digest()))

    obj = _props_object(sig_id, role)
    prop_digest = hashlib.sha512(_c14n_inclusive(obj)).digest()
    ref = etree.SubElement(signed_info, f"{{{DS}}}Reference")
    ref.set("URI", "#prop")
    transforms = etree.SubElement(ref, f"{{{DS}}}Transforms")
    tr = etree.SubElement(transforms, f"{{{DS}}}Transform")
    tr.set("Algorithm", C14N11)
    dm = etree.SubElement(ref, f"{{{DS}}}DigestMethod")
    dm.set("Algorithm", SHA512)
    dv = etree.SubElement(ref, f"{{{DS}}}DigestValue")
    dv.text = _wrap(_b64(prop_digest))

    canonical = etree.tostring(
        signed_info, method="c14n", exclusive=True, with_comments=False
    )
    value = key.sign(canonical, padding.PKCS1v15(), hashes.SHA512())

    sv = etree.SubElement(sig, f"{{{DS}}}SignatureValue")
    sv.text = _wrap(_b64(value))

    key_info = etree.SubElement(sig, f"{{{DS}}}KeyInfo")
    x509_data = etree.SubElement(key_info, f"{{{DS}}}X509Data")
    for cert in certs:
        el = etree.SubElement(x509_data, f"{{{DS}}}X509Certificate")
        el.text = _wrap(_b64(cert.public_bytes(serialization.Encoding.DER)))

    sig.append(obj)
    return etree.tostring(sig, encoding="UTF-8", xml_declaration=False)


def collect_files(stage_dir: str):
    files = []
    for base, _dirs, names in os.walk(stage_dir):
        for name in names:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, stage_dir).replace(os.sep, "/")
            if rel in SIG_FILES:
                continue
            with open(full, "rb") as fh:
                files.append((rel, fh.read()))
    files.sort(key=lambda item: item[0])
    return files


def sign_wgt(stage_dir: str, out_wgt: str, cert_dir: str, password: str) -> dict:
    author_key, author_chain = load_p12(os.path.join(cert_dir, "author.p12"), password)
    dist_key, dist_chain = load_p12(
        os.path.join(cert_dir, "distributor.p12"), password
    )

    files = collect_files(stage_dir)
    author_sig = _make_signature(files, author_key, author_chain,
                                 "AuthorSignature", "author")
    dist_sig = _make_signature(
        [("author-signature.xml", author_sig)] + files,
        dist_key, dist_chain, "DistributorSignature", "distributor",
    )

    order = [("author-signature.xml", author_sig)] + files + [
        ("signature1.xml", dist_sig)
    ]
    with zipfile.ZipFile(out_wgt, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for path, data in order:
            z.writestr(path, data)

    return {"files": len(files), "bytes": os.path.getsize(out_wgt)}


def verify_wgt(path: str) -> dict:
    z = zipfile.ZipFile(path)
    names = z.namelist()
    result = {"file": path, "entries": len(names), "problems": []}

    for sig_name in SIG_FILES:
        if sig_name not in names:
            result["problems"].append(f"missing {sig_name}")
            result["ok"] = False
            return result

    def check(sig_name: str, label: str) -> None:
        doc = etree.fromstring(z.read(sig_name))
        signed_info = doc.find(f"{{{DS}}}SignedInfo")
        cert_el = doc.find(
            f"{{{DS}}}KeyInfo/{{{DS}}}X509Data/{{{DS}}}X509Certificate"
        )
        cert = x509.load_der_x509_certificate(
            base64.b64decode(_flat(cert_el.text))
        )
        canonical = etree.tostring(
            signed_info, method="c14n", exclusive=True, with_comments=False
        )
        value = base64.b64decode(
            _flat(doc.find(f"{{{DS}}}SignatureValue").text)
        )
        try:
            cert.public_key().verify(
                value, canonical, padding.PKCS1v15(), hashes.SHA512()
            )
        except Exception as exc:  # noqa: BLE001
            result["problems"].append(f"{label}: bad SignatureValue ({exc})")

        bad = 0
        refs = signed_info.findall(f"{{{DS}}}Reference")
        for ref in refs:
            uri = ref.get("URI")
            want = _flat(ref.find(f"{{{DS}}}DigestValue").text)
            if uri.startswith("#"):
                target = doc.find(f".//*[@Id='{uri[1:]}']")
                if target is None:
                    bad += 1
                    result["problems"].append(f"{label}: missing {uri}")
                    continue
                got = _b64(hashlib.sha512(_c14n_inclusive(target)).digest())
            else:
                name = unquote(uri)
                if name not in names:
                    bad += 1
                    result["problems"].append(f"{label}: missing file {name}")
                    continue
                got = _b64(hashlib.sha512(z.read(name)).digest())
            if got != want:
                bad += 1
                if bad <= 3:
                    result["problems"].append(f"{label}: digest mismatch {uri}")
        result[f"{label}_refs"] = len(refs)
        result[f"{label}_bad"] = bad

    check("author-signature.xml", "author")
    check("signature1.xml", "distributor")
    result["ok"] = not result["problems"]
    return result
