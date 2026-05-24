#!/usr/bin/env bash
# orphan_audit.sh — Three Pillars P2 capability test.
#
# Proves the orphan-audit gate detects an orphan dim (capability_callsite
# imported only from tests) and caps it at 6.0 — while letting a real dim
# (capability_callsite imported from production code) pass through.
#
# Usage: from DanteForge repo root: bash .danteforge/capability-tests/orphan_audit.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
FIXTURE_DIR="$REPO_ROOT/.danteforge/capability-tests/fixtures/orphan-audit"

# Stage 1: build the fixture
node tests/fixtures/orphan-audit-fixture-setup.mjs

# Stage 2: run audit-orphans against the fixture project. Build first if dist is stale.
if [ ! -f "$REPO_ROOT/dist/index.js" ]; then
  npm run build > /dev/null
fi

output=$(node "$REPO_ROOT/dist/index.js" harden audit-orphans --cwd "$FIXTURE_DIR" --json)

# Stage 3: assertions
echo "$output" | node -e "
  const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const errors = [];
  if (data.totalDimensions !== 2) errors.push('expected 2 dims, got ' + data.totalDimensions);
  const orphans = data.orphans ?? [];
  if (orphans.length !== 1) errors.push('expected 1 orphan, got ' + orphans.length);
  const orphan = orphans[0];
  if (orphan && orphan.dimensionId !== 'dim_orphan') errors.push('expected dim_orphan to be flagged, got ' + orphan.dimensionId);
  if (orphan && orphan.cap !== 6.0) errors.push('expected cap=6.0, got cap=' + orphan.cap);
  if (data.clean !== 1) errors.push('expected clean=1 (dim_real passes), got ' + data.clean);
  if (errors.length > 0) {
    console.error('FAIL: orphan_audit capability test');
    for (const e of errors) console.error('  - ' + e);
    console.error('Raw output:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log('PASS: orphan-audit detected dim_orphan (cap=6.0); dim_real passed');
"

# Stage 4: cleanup
node tests/fixtures/orphan-audit-fixture-teardown.mjs

echo "PASS: orphan_audit capability test"
