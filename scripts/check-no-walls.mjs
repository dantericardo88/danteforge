#!/usr/bin/env node
// check-no-walls — the operator doctrine made mechanical: every DanteForge LOOP must problem-solve at its
// hard points, not hit a wall. This surfaces curated loops/drivers that have NO problem-solving wiring
// (solveOrDecompose / solveObstacle / decomposeOrEscalate / solveProblemTree / resolveStall / recoverSpawnFailure),
// so a stall/ceiling there is a silent WALL rather than a decomposition into smaller tracked sub-problems.
//
// Warn-mode by default (reports the worklist, exits 0) per the council's "wire one path first, don't over-fire".
// Run `node scripts/check-no-walls.mjs --strict` to FAIL when any curated loop is unwired (flip on once the
// fleet is wired). Score-cap files (market/ontological caps) are deliberately excluded — those caps are
// legitimate terminals, not walls.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');

// Loops/drivers that SHOULD decompose-or-escalate at their hard points. Extend as new loops land.
const LOOP_FILES = [
  'src/core/autonomous-loop-runner.ts',
  'src/core/ascend-engine-cycle.ts',
  'src/core/autoforge-loop.ts',
  'src/matrix/engines/council-frontier-loop.ts',
  'src/core/harden-crusade.ts',
  'src/core/frontier-course-corrector.ts',
  'src/core/autoresearch-engine.ts',
  'scripts/run-swebench-grounding.mjs',
];
const WIRING = /solveOrDecompose|solveObstacle|decomposeOrEscalate|solveProblemTree|resolveStall|recoverSpawnFailure/;

const present = LOOP_FILES.filter(f => existsSync(join(ROOT, f)));
const unwired = present.filter(f => !WIRING.test(readFileSync(join(ROOT, f), 'utf8')));
const wired = present.length - unwired.length;

console.error(`[no-walls] ${wired}/${present.length} curated loops are wired to problem-solving (decompose/escalate).`);
if (unwired.length) {
  console.error('[no-walls] loops with NO problem-solving wiring — a hard point here is a WALL, not a worklist:');
  for (const f of unwired) console.error(`  - ${f}`);
  console.error('[no-walls] fix: call solveOrDecompose() at each loop\'s ceiling/stall point so it breaks the');
  console.error('[no-walls]      problem into tracked sub-problems instead of giving up.');
}
if (STRICT && unwired.length) process.exit(1);
process.exit(0);
