#!/usr/bin/env node
// One-shot: scaffold the `code_generation` dimension for the first DanteForge-on-DanteForge grounded
// receipt (operator-ratified 2026-06-16: open SWE-bench-lite frontier, HumanEval chain-proof first).
// Idempotent — re-running leaves an existing dim untouched. Structural add only; validate writes the score.

import { readFileSync, writeFileSync } from 'node:fs';

const PATH = '.danteforge/compete/matrix.json';
const m = JSON.parse(readFileSync(PATH, 'utf8'));
m.dimensions ??= [];

if (m.dimensions.some(d => d.id === 'code_generation')) {
  console.log('[add-dim] code_generation already exists — no change.');
  process.exit(0);
}

const dataPath = process.env['HUMANEVAL_DATA'] ?? 'X:/tmp/HumanEval.jsonl.gz';

const dim = {
  id: 'code_generation',
  name: 'Code generation (agentic SWE)',
  weight: 1.5,
  // Competitor scores = published SWE-bench-lite resolved-rate x 10 (the honest external frontier).
  // Only VERIFIED leaderboard numbers (SWE-bench Feb 2026 update): Globant Code Fixer 46.33%, devlo 46.0%.
  scores: {
    'Globant Code Fixer Agent': 4.6,
    'devlo': 4.6,
    self: 0,
    derived: 0,
  },
  // Gate the merge court (Fix A): the runner itself must work (verify-gold = zero-compute proof).
  capability_test: {
    command: `node scripts/run-humaneval-grounding.mjs --data ${dataPath} --verify-gold --limit 5`,
    expected_exit: 0,
    timeout_ms: 120000,
  },
  outcomes: [
    {
      id: 'cg_humaneval_chainproof',
      tier: 'T5',
      kind: 'external-benchmark',
      benchmark: 'humaneval',
      // CH-029 pipeline solver — measures DanteForge's iterate-to-green orchestration, not raw claude.
      command: `node scripts/run-humaneval-grounding.mjs --data ${dataPath} --limit 10 --solver-mode pipeline --max-iterations 2`,
      min_pass_rate: 0.4,
      timeout_ms: 1800000,
      input_source: { type: 'external-benchmark', suite: 'humaneval' },
      description: 'CHAIN-PROOF, not the honest frontier: DanteForge pipeline solver on a HumanEval sample (HumanEval is saturated). Proves the grounding chain end-to-end (harvest->bar->solver->signed receipt). The real bar is SWE-bench-lite (top open agent ~46%, operator-ratified 2026-06-16).',
    },
  ],
};

m.dimensions.push(dim);
writeFileSync(PATH, JSON.stringify(m, null, 2) + '\n', 'utf8');
console.log(`[add-dim] added code_generation (${m.dimensions.length} dims). Leader: Globant Code Fixer Agent @4.6 (SWE-bench-lite 46.33%).`);
console.log('[add-dim] next: danteforge validate code_generation  → mints the HumanEval chain-proof receipt.');
