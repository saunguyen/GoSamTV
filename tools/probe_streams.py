"""Probe every playlist entry and report which streams actually play.

Pass 1: fetch the manifest, require HTTP 200 + #EXTM3U.
Pass 2: for master playlists, fetch the first variant and require segments.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(r"S:\GoSamTV")
M3U = ROOT / "us.m3u"
OUT = ROOT / ".work" / "stream-test.json"

UA = ("Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 "
      "(KHTML, like Gecko) SamsungBrowser/5.0 Chrome/76.0.3809.146 TV Safari/537.36")
TIMEOUT = 9
WORKERS = 40


def parse_playlist(path: Path):
    entries = []
    pending = None
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#EXTINF"):
            name = line.split(",", 1)[1].strip() if "," in line else "Kênh"
            name = re.sub(r"\s*\(\d{3,4}p\)\s*$", "", name).strip()
            tid = re.search(r'tvg-id="([^"]*)"', line)
            pending = {"name": name, "id": tid.group(1) if tid else ""}
        elif line.startswith("#"):
            continue
        elif pending is not None:
            pending["url"] = line
            entries.append(pending)
            pending = None
    return entries


def fetch(url: str, limit: int = 4096):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    })
    started = time.time()
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        body = response.read(limit)
        return response.status, body, time.time() - started


def is_placeholder(text: str) -> bool:
    """Some providers answer with a valid playlist that only shows a still
    'signal low' card — that is a dead channel, not a working stream."""
    if "signal_low" in text or "signal-low" in text:
        return True
    segments = [l.strip() for l in text.splitlines()
                if l.strip() and not l.strip().startswith("#")]
    if segments and "#EXT-X-ENDLIST" in text:
        if all(seg.lower().endswith((".png", ".jpg", ".jpeg", ".gif")) for seg in segments):
            return True
    return False


def probe(entry):
    result = dict(entry)
    result.update({"ok": False, "why": "", "ms": 0, "kind": ""})
    try:
        status, body, elapsed = fetch(entry["url"])
        result["ms"] = int(elapsed * 1000)
        if status != 200:
            result["why"] = f"HTTP {status}"
            return result
        text = body.decode("utf-8", "replace")
        if "#EXTM3U" not in text:
            result["why"] = "not a playlist"
            return result

        if "#EXT-X-STREAM-INF" in text:
            result["kind"] = "master"
            variant = None
            for line in text.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    variant = urljoin(entry["url"], line)
                    break
            if not variant:
                result["why"] = "no variant"
                return result
            status2, body2, _ = fetch(variant)
            text2 = body2.decode("utf-8", "replace")
            if status2 != 200 or "#EXTM3U" not in text2:
                result["why"] = f"variant HTTP {status2}"
                return result
            if "#EXTINF" not in text2 and "#EXT-X-TARGETDURATION" not in text2:
                result["why"] = "variant without segments"
                return result
            if is_placeholder(text2):
                result["why"] = "placeholder (signal low)"
                return result
            result["kind"] = "master+segments"
        else:
            result["kind"] = "media"
            if "#EXTINF" not in text and "#EXT-X-TARGETDURATION" not in text:
                result["why"] = "no segments"
                return result
            if is_placeholder(text):
                result["why"] = "placeholder (signal low)"
                return result

        result["ok"] = True
        return result
    except urllib.error.HTTPError as exc:
        result["why"] = f"HTTP {exc.code}"
    except urllib.error.URLError as exc:
        result["why"] = f"net: {exc.reason}"[:60]
    except Exception as exc:  # noqa: BLE001
        result["why"] = type(exc).__name__ + ": " + str(exc)[:50]
    return result


def main():
    entries = parse_playlist(M3U)
    print(f"probe {len(entries)} channels ...", flush=True)
    results = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(probe, e): e for e in entries}
        done = 0
        for future in as_completed(futures):
            results.append(future.result())
            done += 1
            if done % 100 == 0:
                ok = sum(1 for r in results if r["ok"])
                print(f"  {done}/{len(entries)} done, {ok} working", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = [r for r in results if r["ok"]]
    print(f"\nworking: {len(ok)}/{len(results)}")
    print("sample working:")
    for r in ok[:15]:
        print(f"  {r['name'][:40]:42} {r['ms']:5}ms {r['kind']}")


if __name__ == "__main__":
    main()
