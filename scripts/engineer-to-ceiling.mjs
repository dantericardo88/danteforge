#!/usr/bin/env node
// engineer-to-ceiling.mjs — the autonomous, honest finish loop (council 2026-06-23).
//
// Drives every dimension to its HONEST engineering ceiling (8.0 BUILD-COMPLETE for no-demand dims) using the
// proven primitives — ground-outcomes -> author a genuine product-run -> validate -> re-derive — and STOPS at the
// honest fixpoint, emitting a WORKLIST for the judgment seams. It NEVER fakes:
//   - it only authors product-runs from the hand-authored, court-auditable .danteforge/engineer-registry.json
//     (the loop NEVER invents a command/callsite — semantic fit is human judgment);
//   - the author-outcome guardrail independently refuses test-runners / help-screens / volatile output;
//   - dims with no honest product-run command (orphans needing wiring, shared-receipts needing per-dim tests)
//     are SURFACED in the worklist, not forced. "Ceiling" includes "honestly capped with a reason."
//
// Usage: node scripts/engineer-to-ceiling.mjs   (re-run after expanding the registry to lift more)

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REG = JSON.parse(readFileSync('.danteforge/engineer-registry.json', 'utf8')).registry;

function sh(cmd, inherit = false) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return (e.stdout ?? '') + (e.stderr ?? ''); }
}
function finishStatus() {
  const out = sh('node dist/index.js finish --json');
  const s = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
  try { return JSON.parse(s); } catch { return { perDim: [], finished: false }; }
}

console.log('engineer-to-ceiling — drive every dim to its HONEST ceiling, stop at the fixpoint\n');

// 1. ground-outcomes: honest callsite re-authoring + downgrades (the proven first move).
console.log('[1/3] ground-outcomes --apply …');
sh('node dist/index.js ground-outcomes --apply');

// 2. per-dim: author a genuine product-run from the registry where one exists, then validate.
const before = finishStatus();
const capped = before.perDim.filter(d => !d.finished);
const authored = [], worklist = [];
for (const d of capped) {
  const entry = REG[d.dimId];
  if (!entry) {
    worklist.push({ dim: d.dimId, score: d.score, reason: 'no product-run command in registry — needs a human-authored command, orphan wiring, or a per-dim behavioral test' });
    continue;
  }
  console.log(`[2/3] ${d.dimId}: author-outcome "${entry.command}" …`);
  const a = sh(`node dist/index.js author-outcome ${d.dimId} --command "${entry.command}" --callsite ${entry.callsite} --write`);
  if (/REFUSED/i.test(a)) {
    worklist.push({ dim: d.dimId, score: d.score, reason: `author-outcome REFUSED (guardrail) — ${(a.split('REFUSED')[1] ?? '').split('\n')[0].trim()}` });
    continue;
  }
  sh(`node dist/index.js validate ${d.dimId}`);
  authored.push(d.dimId);
}

// 3. re-derive + report the honest fixpoint + the worklist.
const after = finishStatus();
const doneBefore = before.perDim.filter(d => d.finished).length;
const doneAfter = after.perDim.filter(d => d.finished).length;
console.log(`\n[3/3] FINISHED ${doneAfter}/${after.perDim.length}  (was ${doneBefore})`);
if (authored.length) console.log(`  lifted via authored product-runs: ${authored.join(', ')}`);
console.log('\nWORKLIST — dims at an honest cap needing JUDGMENT (surfaced, never faked):');
if (!worklist.length) console.log('  (none — every dim is at its honest ceiling)');
for (const w of worklist) console.log(`  • ${w.dim} (${w.score.toFixed(1)}) — ${w.reason}`);
console.log(`\nSTOP at honest fixpoint. ${after.finished ? 'PROJECT FINISHED.' : `${worklist.length} dim(s) need human-authored commands / wiring / per-dim tests; add genuine commands to the registry and re-run to lift more.`}`);
