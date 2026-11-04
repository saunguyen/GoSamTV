"""Merge the probe results into tools/stream-status.json for the build to use."""

from __future__ import annotations

import datetime
import json
from pathlib import Path

ROOT = Path(r"S:\GoSamTV")
WORK = ROOT / ".work"

intl = json.loads((WORK / "stream-test.json").read_text(encoding="utf-8"))
vn = json.loads((WORK / "stream-test-vn.json").read_text(encoding="utf-8"))

payload = {
    "testedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    "note": "Kết quả dò luồng: ok = tải được manifest và có segment.",
    "intl": {r["url"]: ("ok" if r["ok"] else r.get("why", "fail")) for r in intl},
    "vn": {r["id"]: ("ok" if r["ok"] else r.get("why", "fail")) for r in vn},
}

out = ROOT / "tools" / "stream-status.json"
out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

print("intl ok:", sum(1 for v in payload["intl"].values() if v == "ok"), "/", len(payload["intl"]))
print("vn ok:", sum(1 for v in payload["vn"].values() if v == "ok"), "/", len(payload["vn"]))
print("written:", out)
