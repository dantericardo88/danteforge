#!/usr/bin/env python3
"""Convert a SWE-bench predictions JSONL ({instance_id, model_name_or_path, model_patch} per line) into the
DICT format SWE-bench-Live's evaluation.evaluation expects: {instance_id: {"model_patch": "..."}}.

Usage: preds_to_dict.py <in.jsonl> <out.json>
The Live grader (evaluation/evaluation.py:266) does `preds = json.load(f)` then `preds[id]["model_patch"]`,
so it needs a single JSON object keyed by instance_id — NOT the JSONL the official swebench harness reads.
"""
import json
import sys


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    preds: dict[str, dict[str, str]] = {}
    with open(src, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            preds[obj["instance_id"]] = {"model_patch": obj.get("model_patch", "")}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(preds, f)
    print(f"[preds_to_dict] converted {len(preds)} prediction(s) -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
