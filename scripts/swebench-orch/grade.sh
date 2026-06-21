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
      # CH-035 self-heal, OS-aware: on the cloud Linux box (the safe grade host) use systemctl; on the
      # Windows workstation use Docker Desktop. Probing systemctl first keeps the cloud path off powershell.exe.
      if command -v systemctl >/dev/null 2>&1; then
        echo "[grade] docker daemon down — starting it via systemctl (Linux) and waiting (≤300s)…" >&2
        sudo systemctl start docker >/dev/null 2>&1 || true
      else
        echo "[grade] docker daemon down — starting Docker Desktop (Windows) and waiting (≤300s)…" >&2
        powershell.exe -NoProfile -Command "if (Test-Path 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe') { Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe' }" >/dev/null 2>&1 || true
      fi
    fi
    sleep 10
  done
  echo "[grade] docker daemon NOT ready after ~300s — cannot grade" >&2; return 1
}
ensure_docker || exit 4

# CH-036 RESOLVED: SWE-bench-Live grades via its OWN evaluation/ pipeline (+ the RepoLaunch `launch` git
# submodule), NOT swebench.harness. Root cause of the long obstacle chain: `launch/` is a submodule that a
# --depth-1 clone leaves empty (see Dockerfile.live). Build the dedicated image, convert predictions to the
# DICT format the Live grader expects ({instance_id:{model_patch}}), and run each instance in the
# contamination-resistant starryzhang/sweb.eval.* image over the docker socket. The grader prints
# "Success:" (resolved) / "Submitted:" (attempted).
DIR="$(dirname "$0")"
if echo "$DATASET" | grep -qi "Live"; then
  LIVEIMG=df-swebench-live
  echo "[grade] SWE-bench-Live: building $LIVEIMG (first build pulls the RepoLaunch/langchain tree; cached after)…" >&2
  docker build -q -f "$DIR/Dockerfile.live" -t "$LIVEIMG" "$DIR" >/dev/null
  mkdir -p "$REPORTDIR"
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${PRED}:/work/predictions.jsonl:ro" \
    -v "${REPORTDIR}:/work/out" \
    "$LIVEIMG" \
    sh -c "python /usr/local/bin/preds_to_dict.py /work/predictions.jsonl /work/out/preds-dict.json && \
      cd /opt/swebench-live && python -m evaluation.evaluation \
        --dataset '$DATASET' --split '$SPLIT' --platform linux \
        --patch_dir /work/out/preds-dict.json \
        --output_dir /work/out --workers 1 --overwrite 1 \
        --instance_ids $IDS"
  exit $?
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
