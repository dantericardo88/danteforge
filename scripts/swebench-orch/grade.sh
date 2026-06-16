#!/usr/bin/env bash
# Build (once) the Linux orchestrator image, then grade predictions via the official harness IN LINUX.
# Usage: grade.sh <predictions.jsonl host path> <run_id> <report_dir host path> <instance_id...>
set -euo pipefail
PRED="$1"; RUN_ID="$2"; REPORTDIR="$3"; shift 3; IDS="$*"

# CH-035: the Docker daemon stops unattended (Docker Desktop). Self-heal: if it's down, start it and
# wait for readiness before grading — so an overnight run survives a daemon outage instead of failing.
ensure_docker() {
  for i in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then return 0; fi
    if [ "$i" -eq 1 ]; then
      echo "[grade] docker daemon down — starting Docker Desktop and waiting (≤300s)…" >&2
      powershell.exe -NoProfile -Command "if (Test-Path 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe') { Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe' }" >/dev/null 2>&1 || true
    fi
    sleep 10
  done
  echo "[grade] docker daemon NOT ready after ~300s — cannot grade" >&2; return 1
}
ensure_docker || exit 4

docker build -q -t df-swebench-orch "$(dirname "$0")" >/dev/null
mkdir -p "$REPORTDIR"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${PRED}:/work/predictions.jsonl:ro" \
  -v "${REPORTDIR}:/work/out" \
  df-swebench-orch \
  sh -c "cd /work/out && python -m swebench.harness.run_evaluation \
    -d SWE-bench/SWE-bench_Lite -s test -p /work/predictions.jsonl \
    -id '$RUN_ID' --max_workers 1 -i $IDS --report_dir /work/out --cache_level env"
