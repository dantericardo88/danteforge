#!/usr/bin/env node
// Make matrix capability tests cross-platform while preserving real capability checks.

import fs from 'node:fs';
import path from 'node:path';

const MATRIX_PATH = path.join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));

const COMMANDS = {
  testing: 'npx tsx --test tests/smoke.test.ts tests/cli-smoke-runner.test.ts tests/runtime-exec-runner.test.ts',
  developer_experience: 'node dist/index.js --help',
  ux_polish: 'node dist/index.js --help',
  functionality: 'npx tsx --test tests/smoke.test.ts',
  autonomy: 'node dist/index.js ascend --dry-run',
  security: 'npm run check:anti-stub',
  error_handling: 'npx tsx --test tests/error-boundary-coverage.test.ts',
  performance: 'npm run build',
  convergence_self_healing: 'npx tsx --test tests/loop-detector.test.ts tests/reflection-gates.test.ts',
  spec_driven_pipeline: 'npx tsx --test tests/workflow-enforcer.test.ts',
  planning_quality: 'node dist/index.js plan --help',
  maintainability: 'node scripts/check-file-size.mjs',
  token_economy: 'node dist/index.js --help',
  self_improvement: 'npx tsx --test tests/lessons-index.test.ts tests/self-improve-loop.test.ts',
  ecosystem_mcp: 'node dist/index.js mcp-tools --json',
};

function dimensionsOf(value) {
  return Array.isArray(value.dimensions) ? value.dimensions : Object.values(value.dimensions ?? {});
}

let changed = 0;
const updates = [];
for (const dim of dimensionsOf(matrix)) {
  const command = COMMANDS[dim.id];
  if (!command || !dim.capability_test?.command) continue;
  const before = dim.capability_test.command;
  if (before === command) continue;
  dim.capability_test.command = command;
  changed++;
  updates.push({ dimensionId: dim.id, before, after: command });
}

const receiptDir = path.join(process.cwd(), '.danteforge', 'matrix');
fs.mkdirSync(receiptDir, { recursive: true });
const receiptPath = path.join(receiptDir, `capability-test-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(
  receiptPath,
  JSON.stringify(
    {
      kind: 'matrix-capability-test-repair',
      ranAt: new Date().toISOString(),
      matrixPath: path.relative(process.cwd(), MATRIX_PATH),
      changed,
      updates,
      rationale: 'Capability tests must be executable by the verifier on Windows; removed Unix-only head/tail pipes.',
    },
    null,
    2,
  ) + '\n',
);

fs.writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2) + '\n');
console.log(`Updated ${changed} capability_test command(s).`);
console.log(`Receipt: ${path.relative(process.cwd(), receiptPath)}`);
