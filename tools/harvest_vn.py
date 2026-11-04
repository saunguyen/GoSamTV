"""Harvest replacement streams for dead VN channels from community playlists."""

from __future__ import annotations

import gzip
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from probe_streams import probe  # noqa: E402

ROOT = Path(r"S:\GoSamTV")

SOURCES = [
    "https://raw.githubusercontent.com/ntbqn/iptv/master/iptv-all.m3u",
    "https://pastebin.com/raw/gf3NsQLj",
    "https://iptv-org.github.io/iptv/countries/vn.m3u",
]

# our id -> substrings that must appear in the normalised channel name
WANTED = {
    "htv1": ["htv1"],
    "htv2": ["htv2"],
    "htv3": ["htv3"],
    "htv4": ["htv4"],
    "htv7": ["htv7"],
    "htv9": ["htv9"],
    "htv_thethao": ["htv the thao", "htv sports", "htvthethao"],
    "htvc_giadinh": ["htvc gia dinh", "htvc family", "htvcgiadinh"],
    "htvc_phim": ["htvc phim", "htvc movies", "htvcphim"],
    "htvc_phunu": ["htvc phu nu", "htvc women", "htvcphunu"],
    "htvc_plus": ["htvc plus"],
    "vtv6": ["vtv6"],
    "vtvcab2": ["vtvcab 2", "phim viet", "on phim viet"],
    "hanoi1": ["ha noi 1", "hanoitv1", "hanoi 1"],
    "hanoi2": ["ha noi 2", "hanoitv2", "hanoi 2"],
    "hatinh": ["ha tinh", "hatinh"],
    "dongnai2": ["dong nai 2", "dongnai2"],
    "hue": ["thua thien hue", "hue tv", "hue"],
    "daklak": ["dak lak", "daklak"],
    "khanhhoa": ["khanh hoa", "khanhhoa"],
    "thanhhoa": ["thanh hoa", "thanhhoa"],
    "angiang2": ["an giang 2"],
    "quangninh3": ["quang ninh 3"],
    "anninhtv": ["an ninh", "anninh"],
    "binhphuoc": ["binh phuoc"],
    "haugiang": ["hau giang"],
    "binhdinh": ["binh dinh"],
    "vungtau": ["vung tau", "brt"],
    "ttxvn": ["vnews", "thong tan xa"],
    "nhandan": ["nhan dan"],
    "yenbai": ["yen bai"],
    "taynininh": ["tay ninh"],
}


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.replace("đ", "d").replace("Đ", "D")


def norm(text: str) -> str:
    text = strip_accents(text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=45) as response:
        raw = response.read()
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
        return raw.decode("utf-8", "replace")


def parse(text: str):
    out = []
    pending = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#EXTINF"):
            name = line.split(",", 1)[1].strip() if "," in line else ""
            pending = name
        elif line.startswith("#"):
            continue
        elif pending is not None:
            out.append((pending, line))
            pending = None
    return out


def main():
    candidates: dict[str, list[dict]] = {key: [] for key in WANTED}
    for url in SOURCES:
        try:
            text = fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"skip {url}: {exc}")
            continue
        entries = parse(text)
        print(f"{url} -> {len(entries)} entries")
        for name, stream in entries:
            n = norm(name)
            for key, needles in WANTED.items():
                if any(needle in n for needle in needles):
                    if len(candidates[key]) < 6 and stream.startswith("http"):
                        candidates[key].append({"name": name, "url": stream})

    results = {}
    for key, items in candidates.items():
        if not items:
            print(f"  {key:14} no candidate")
            continue
        for item in items:
            probe_result = probe({"name": item["name"], "id": key, "url": item["url"]})
            if probe_result["ok"]:
                results[key] = {"url": item["url"], "from": item["name"]}
                print(f"  OK   {key:14} {item['name'][:36]:38} {item['url'][:60]}")
                break
            else:
                print(f"  fail {key:14} {item['name'][:30]:32} {probe_result['why'][:28]}")

    out = ROOT / ".work" / "vn-overrides2.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nworking replacements: {len(results)}/{len(WANTED)}")


if __name__ == "__main__":
    main()
