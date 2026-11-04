"""Find replacement streams for the dead Vietnamese channels."""

from __future__ import annotations

import gzip
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from probe_streams import probe  # noqa: E402

ROOT = Path(r"S:\GoSamTV")

# our channel id -> exact name in the iptv-org Vietnam playlist
CANDIDATES = {
    "htv1": "HTV1 (720p)",
    "htv2": "HTV2 (720p)",
    "htv3": "HTV3 (720p)",
    "htv4": "HTV4 (1080p)",
    "htv7": "HTV7 (720p)",
    "htv9": "HTV9 (720p)",
    "htv_thethao": "HTV Sports (1080i)",
    "htvc_giadinh": "HTVC Family (720p)",
    "htvc_phim": "HTVC Movies (720p)",
    "htvc_phunu": "HTVC Women (720p)",
    "vtv6": "VTV6 (1080p)",
    "vtvcab2": "ON Phim Viet (1080p)",
    "hanoi1": "HanoiTV1 (720p)",
    "hatinh": "Ha Tinh TV (720p)",
    "dongnai2": "Dong Nai TV 2 (1080p)",
    "tayninh": "Tay Ninh TV (720p)",
    "anninhtv": "An Ninh TV HD (1080p)",
    "angiang2": "An Giang TV 2 (1080p) [Geo-blocked]",
}


def fetch_org():
    req = urllib.request.Request(
        "https://iptv-org.github.io/iptv/countries/vn.m3u",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"},
    )
    raw = urllib.request.urlopen(req, timeout=30).read()
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    text = raw.decode("utf-8", "replace")
    channels, pending = {}, None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#EXTINF"):
            pending = line.split(",", 1)[1].strip() if "," in line else ""
        elif line.startswith("#"):
            continue
        elif pending:
            channels[pending] = line
            pending = None
    return channels


def main():
    org = fetch_org()
    results = {}
    for our_id, org_name in CANDIDATES.items():
        url = org.get(org_name)
        if not url:
            print(f"MISS {our_id:14} -> {org_name} (not in playlist)")
            continue
        result = probe({"name": org_name, "id": our_id, "url": url})
        results[our_id] = {"url": url, "org": org_name, "ok": result["ok"], "why": result["why"], "ms": result["ms"]}
        flag = "OK  " if result["ok"] else "FAIL"
        print(f"{flag} {our_id:14} {org_name[:28]:30} {result['why'][:26]:28} {result['ms']}ms")

    out = ROOT / ".work" / "vn-overrides.json"
    ok = {k: {"url": v["url"], "org": v["org"]} for k, v in results.items() if v["ok"]}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(ok, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nusable replacements: {len(ok)}")


if __name__ == "__main__":
    main()
