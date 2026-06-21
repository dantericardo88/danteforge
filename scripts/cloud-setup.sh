#!/usr/bin/env bash
# cloud-setup.sh — Phase 0 of the maximal-autonomy plan: provision a CLOUD LINUX box to run the SWE-bench
# Docker grading safely. The grade step crashed the operator's primary Windows machine TWICE (RAM/WSL2
# pressure) — it must run here, on a dedicated/ephemeral Linux VM, NEVER on the workstation.
#
# Usage (on a fresh Ubuntu 22.04+ VM with ≥16GB RAM, run as a sudo-capable user):
#   curl -fsSL <repo>/scripts/cloud-setup.sh | bash            # or: bash scripts/cloud-setup.sh
#
# Idempotent: safe to re-run. Tears nothing down — spin the VM as spot/ephemeral and destroy it after the run.
set -euo pipefail

REPO_URL="${DANTEFORGE_REPO_URL:-https://github.com/your-org/DanteForge.git}"  # override via env
REPO_DIR="${DANTEFORGE_DIR:-$HOME/DanteForge}"

log() { printf '\n\033[1;36m[cloud-setup]\033[0m %s\n' "$*"; }

# 1) Docker (the grade step's only hard dependency). Skip if already present.
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker…"
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  log "Docker installed — if 'docker ps' fails with a permission error, log out/in (group change) and re-run."
fi
docker --version
# Ensure the daemon is actually RUNNING — grade.sh needs `docker info` to succeed; a fresh install may not
# auto-start it, and the workstation's Docker-Desktop self-heal does not apply here.
if command -v systemctl >/dev/null 2>&1; then sudo systemctl enable --now docker >/dev/null 2>&1 || true; fi
docker info >/dev/null 2>&1 && log "docker daemon is up" || log "WARNING: docker daemon not ready — start it before grading"

# 2) Node 20+ (DanteForge is ESM/tsx). Skip if a recent node is present.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  log "installing Node 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

# 3) git + clone (or pull).
sudo apt-get install -y git >/dev/null 2>&1 || true
if [ ! -d "$REPO_DIR/.git" ]; then
  log "cloning DanteForge → $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
else
  log "DanteForge present — pulling latest"
  git -C "$REPO_DIR" pull --ff-only || true
fi
cd "$REPO_DIR"

# 4) Deterministic install + build.
log "npm ci + build…"
npm ci
npm run build

# 5) Claude CLI auth (the solver). The A/B needs `claude -p` working under your key.
if ! command -v claude >/dev/null 2>&1; then
  log "WARNING: the 'claude' CLI is not installed. Install + authenticate it before the A/B (the solver uses it)."
else
  log "claude CLI present: $(command -v claude)"
fi

# 6) Sanity: prove the harness path is healthy WITHOUT running a heavy grade (no Docker pull here).
log "sanity tests (harness path)…"
npx tsx --test tests/swe-bench-real.test.ts tests/external-benchmark-runner.test.ts tests/danteforge-solver-steps.test.ts

log "Phase 0 complete. THE GREEN-LIT STEP (faithful-oracle validation — does the grader-env regression"
log "oracle turn a fixed-but-regressed instance into a RESOLVE? a single resolve = the first CR receipt):"
cat <<'NEXT'
  # PRIMARY — the faithful oracle on the closest case (cfn-lint-3798: target 26/26 fixed, only 4 regressions
  # away). Per-iteration Docker grading is SAFE here (native Linux, not the WSL2 workstation that crashed):
  node scripts/run-swebench-grounding.mjs --dataset live --grade-in-loop \
    --instances cfn-lint-3798 --max-grade-iterations 2 --run-id faithful_oracle_validate

  # If it RESOLVES → the env-fidelity thesis is proven; widen to all 4 fixed-but-regressed:
  node scripts/run-swebench-grounding.mjs --dataset live --grade-in-loop \
    --instances "cfn-lint-3798 cfn-lint-3856 xarray-9974 pylint-10240" --max-grade-iterations 2 \
    --run-id faithful_oracle_batch
  # The resolve rate from this batch IS the honest code_generation contamination-resistant receipt.

  # BROADER (Phase 1 A/B — measures the solver scaffold vs a budget-matched control across repos):
  #   node scripts/run-swebench-grounding.mjs --dataset live --spread 40 --regression-gate --solver "claude -p" --run-id ab_treat
  #   npx tsx scripts/analyze-swebench-results.mjs <report-dir>   # Wilson CIs — treatment − control = the verdict
NEXT
