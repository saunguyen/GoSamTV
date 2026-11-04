"""Probe the Vietnamese channel list shipped in app/data/channels.js."""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from probe_streams import probe  # noqa: E402

ROOT = Path(r"S:\GoSamTV")
DATA = ROOT / "app" / "data" / "channels.js"
OUT = ROOT / ".work" / "stream-test-vn.json"


def load_vn():
    raw = DATA.read_text(encoding="utf-8")
    payload = raw[len("window.LP_DATA="):].strip().rstrip(";")
    return json.loads(payload)["vn"]


def main():
    channels = load_vn()
    print(f"probe {len(channels)} vn channels ...", flush=True)
    results = []
    with ThreadPoolExecutor(max_workers=24) as pool:
        futures = [pool.submit(probe, {"name": c["name"], "id": c["id"], "url": c["url"]})
                   for c in channels]
        for future in as_completed(futures):
            results.append(future.result())

    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = [r for r in results if r["ok"]]
    print(f"working: {len(ok)}/{len(results)}")
    for r in results:
        flag = "OK " if r["ok"] else "ERR"
        print(f"  {flag} {r['name'][:34]:36} {r['why'][:30]:32} {r['ms']}ms")


if __name__ == "__main__":
    main()
