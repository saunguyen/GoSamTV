import json
import sys

sys.path.insert(0, r"S:\GoSamTV\tools")
import wgtsign

for p in sys.argv[1:]:
    print(json.dumps(wgtsign.verify_wgt(p), indent=2, ensure_ascii=False))
