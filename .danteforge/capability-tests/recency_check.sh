#!/usr/bin/env bash
# recency_check.sh — Three Pillars P3 capability test.
#
# Proves the recency-check gate detects a stale-pattern dim (importer doesn't
# trace to an entry point) and caps it at 7.0 — while letting a fresh +
# traceable dim pass.
#
# Usage: from DanteForge repo root: bash .danteforge/capability-tests/recency_check.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
FIXTURE_DIR="$REPO_ROOT/.danteforge/capability-tests/fixtures/recency-check"

# Stage 1: build the fixture (initializes git inside the fixture)
node tests/fixtures/recency-check-fixture-setup.mjs

# Stage 2: run audit-recency against the fixture project
if [ ! -f "$REPO_ROOT/dist/index.js" ]; then
  npm run build > /dev/null
fi

output=$(node "$REPO_ROOT/dist/index.js" harden audit-recency --cwd "$FIXTURE_DIR" --json)

# Stage 3: assertions
echo "$output" | node -e "
  const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const errors = [];
  if (data.totalDimensions !== 2) errors.push('expected 2 dims, got ' + data.totalDimensions);
  const stale = data.stale ?? [];
  if (stale.length !== 1) errors.push('expected 1 stale, got ' + stale.length);
  const s = stale[0];
  if (s && s.dimensionId !== 'dim_stale') errors.push('expected dim_stale to be flagged, got ' + s.dimensionId);
  if (s && s.cap !== 7.0) errors.push('expected cap=7.0, got cap=' + s.cap);
  if (data.fresh !== 1) errors.push('expected fresh=1 (dim_fresh passes), got ' + data.fresh);
  if (errors.length > 0) {
    console.error('FAIL: recency_check capability test');
    for (const e of errors) console.error('  - ' + e);
    console.error('Raw output:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log('PASS: recency-check detected dim_stale (cap=7.0); dim_fresh passed');
"

# Stage 4: cleanup
node tests/fixtures/recency-check-fixture-teardown.mjs

echo "PASS: recency_check capability test"
