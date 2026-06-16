#!/usr/bin/env bash
# Build (once) the Linux orchestrator image, then grade predictions via the official harness IN LINUX.
# Usage: grade.sh <predictions.jsonl host path> <run_id> <report_dir host path> <instance_id...>
set -euo pipefail
PRED="$1"; RUN_ID="$2"; REPORTDIR="$3"; shift 3; IDS="$*"
docker build -q -t df-swebench-orch "$(dirname "$0")" >/dev/null
mkdir -p "$REPORTDIR"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${PRED}:/work/predictions.jsonl:ro" \
  -v "${REPORTDIR}:/work/out" \
  df-swebench-orch \
  python -m swebench.harness.run_evaluation \
    -d SWE-bench/SWE-bench_Lite -s test -p /work/predictions.jsonl \
    -id "$RUN_ID" --max_workers 1 -i $IDS --report_dir /work/out --cache_level env
