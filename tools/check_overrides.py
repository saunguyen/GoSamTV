"""Re-check the URLs in tools/vn-overrides.json and drop the ones that died.

Some sources hand out signed links that expire after a few hours; without this
they would stay in the list as a black tile until someone notices.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from probe_streams import probe  # noqa: E402

ROOT = Path(r"S:\GoSamTV")
OVERRIDES = ROOT / "tools" / "vn-overrides.json"


def main() -> int:
    if not OVERRIDES.exists():
        print("no overrides file")
        return 0

    data = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    alive, dropped = {}, []

    for channel_id, info in data.items():
        url = info.get("url", "")
        result = probe({"name": channel_id, "id": channel_id, "url": url})
        if result["ok"]:
            alive[channel_id] = info
            print(f"OK   {channel_id:14} {url[:64]}")
        else:
            dropped.append(channel_id)
            print(f"DROP {channel_id:14} {result['why'][:40]}")

    if dropped:
        OVERRIDES.write_text(json.dumps(alive, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"removed {len(dropped)} dead override(s): {', '.join(dropped)}")
    print(f"overrides alive: {len(alive)}/{len(data)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
