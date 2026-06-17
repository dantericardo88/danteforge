#!/usr/bin/env bash
# Build (once) the Linux orchestrator image, then grade predictions via the official harness IN LINUX.
# Usage: grade.sh <predictions> <run_id> <report_dir> <dataset> <namespace> <split> <instance_id...>
#   dataset/namespace/split parameterize the suite: lite/verified use SWE-bench + swebench + test;
#   live uses SWE-bench-Live/SWE-bench-Live + starryzhang + lite (contamination-resistant, CH-036).
set -euo pipefail
PRED="$1"; RUN_ID="$2"; REPORTDIR="$3"; DATASET="$4"; NAMESPACE="$5"; SPLIT="$6"; shift 6; IDS="$*"

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

# CH-036: SWE-bench-Live grading is a SEPARATE multi-component pipeline (evaluation/ + launch/RepoLaunch),
# NOT a swebench.harness drop-in — see Dockerfile.live. It is NOT wired yet. Solving Live works (proven);
# grading does not. Fail CLEANLY with the honest reason rather than a cryptic module error.
DIR="$(dirname "$0")"
if echo "$DATASET" | grep -qi "Live"; then
  echo "[grade] SWE-bench-Live grading is not yet integrated (CH-036): Live uses its own evaluation/ +" >&2
  echo "[grade] launch/ pipeline, not swebench.harness. The 5 solved Live patches are saved; wire the Live" >&2
  echo "[grade] eval pipeline (see scripts/swebench-orch/Dockerfile.live) to grade them. Solve works; grade is WIP." >&2
  exit 5
fi
IMG=df-swebench-orch
docker build -q -t "$IMG" "$DIR" >/dev/null
mkdir -p "$REPORTDIR"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${PRED}:/work/predictions.jsonl:ro" \
  -v "${REPORTDIR}:/work/out" \
  "$IMG" \
  sh -c "cd /work/out && python -m swebench.harness.run_evaluation \
    -d '$DATASET' -s '$SPLIT' -n '$NAMESPACE' -p /work/predictions.jsonl \
    -id '$RUN_ID' --max_workers 1 -i $IDS --report_dir /work/out --cache_level env"
