// gov-demo.ts — three GENUINELY-DISTINCT live demonstrations of constitutional_governance's policy engine,
// each a real product run (`danteforge gov-demo <surface>`) that exercises a DIFFERENT governance module and
// writes a judge-inspectable artifact. Built (council 2026-06-23) so the evidence-ladder author can assemble a
// court-ready T7 ladder autonomously from genuine, varied evidence — not three wrappers around one script.
//
//   receipt-integrity      → src/core/frontier-spec.ts     (kernel-signed receipts: forgery + content-tamper rejected)
//   score-surface-ownership→ src/matrix/types/agent-evidence.ts (agents structurally forbidden from writing the score surface)
//   judge-independence     → src/cli/commands/frontier-review.ts (builders excluded from judging their own work)
//
// Exit 0 only when EVERY governance check holds; a non-zero exit is a real governance regression.

import fs from 'node:fs';
import { logger } from '../../core/logger.js';
import { signClaim, verifyClaim, signBuilderProvenance, verifyBuilderProvenance } from '../../core/frontier-spec.js';
import { computeExcludedJudges } from './frontier-review.js';
import { MATRIX_SCORE_SURFACE_PATTERNS } from '../../matrix/types/agent-evidence.js';
import { matchesGlob } from '../../matrix/util/glob.js';
import type { CouncilMemberId } from './council.js';

type Check = [string, boolean];

const ROSTER = [
  { id: 'codex' as CouncilMemberId },
  { id: 'claude-code' as CouncilMemberId },
  { id: 'grok-build' as CouncilMemberId, judgeOnly: true },
  { id: 'gemini-cli' as CouncilMemberId },
  { id: 'dantecode' as CouncilMemberId },
];

/** Surface 1 — kernel-signed receipt integrity (frontier-spec.ts). An AI cannot forge a receipt, reuse one for
 *  a different claim, or sign off on its own work. */
function receiptIntegrity(): Check[] {
  return [
    ['real_receipt_verifies', verifyClaim('cg', signClaim('cg'))],
    ['forged_receipt_rejected', !verifyClaim('cg', 'f'.repeat(32))],
    ['content_binding_holds', !verifyClaim('cg_other', signClaim('cg'))],
    ['real_provenance_verifies', verifyBuilderProvenance('cg', ['codex'], signBuilderProvenance('cg', ['codex']))],
    ['forged_provenance_rejected', !verifyBuilderProvenance('cg', ['codex'], 'f'.repeat(32))],
    ['provenance_dimension_bound', !verifyBuilderProvenance('cg_other', ['codex'], signBuilderProvenance('cg', ['codex']))],
    ['provenance_builder_bound', !verifyBuilderProvenance('cg', ['codex'], signBuilderProvenance('cg', ['claude-code']))],
  ];
}

/** Surface 2 — score-surface ownership (agent-evidence.ts). The kernel-owned score surface is structurally
 *  forbidden to build workers; ordinary source is not (governance is targeted, not a blanket ban). */
function scoreSurfaceOwnership(): Check[] {
  const forbidden = (p: string) => MATRIX_SCORE_SURFACE_PATTERNS.some(g => matchesGlob(p, g));
  return [
    ['matrix_json_forbidden', forbidden('.danteforge/compete/matrix.json')],
    ['score_proposals_forbidden', forbidden('.danteforge/score-proposals/cg.json')],
    ['outcome_evidence_forbidden', forbidden('.danteforge/outcome-evidence/cg.json')],
    ['universe_bar_forbidden', forbidden('.danteforge/compete/universe/constitutional_governance.md')],
    ['ordinary_src_allowed', !forbidden('src/core/gates.ts')],
  ];
}

/** Surface 3 — judge independence (frontier-review.ts). A builder cannot judge its own dim; a kernel-signed
 *  token seats a PEER; a forged token falls to the safe floor; the token is dimension-bound. */
function judgeIndependence(): Check[] {
  const tok = signBuilderProvenance('cg', ['codex']);
  const exNoToken = computeExcludedJudges('cg', ['codex'], undefined, undefined, ROSTER);
  const exToken = computeExcludedJudges('cg', ['codex'], undefined, tok, ROSTER);
  const exForged = computeExcludedJudges('cg', ['codex'], undefined, 'f'.repeat(32), ROSTER);
  return [
    ['builder_excluded_without_token', exNoToken.has('codex' as CouncilMemberId)],
    ['peer_seated_with_valid_token', !exToken.has('claude-code' as CouncilMemberId)],
    ['builder_still_excluded_with_token', exToken.has('codex' as CouncilMemberId)],
    ['forged_token_falls_to_floor', exForged.has('codex' as CouncilMemberId)],
    ['token_is_dimension_bound', !verifyBuilderProvenance('cg_other', ['codex'], tok)],
  ];
}

const SURFACES: Record<string, { module: string; run: () => Check[] }> = {
  'receipt-integrity': { module: 'src/core/frontier-spec.ts', run: receiptIntegrity },
  'score-surface-ownership': { module: 'src/matrix/types/agent-evidence.ts', run: scoreSurfaceOwnership },
  'judge-independence': { module: 'src/cli/commands/frontier-review.ts', run: judgeIndependence },
};

export interface GovDemoCliOptions { surface: string; out?: string; json?: boolean; }

export async function runGovDemoCli(opts: GovDemoCliOptions): Promise<void> {
  const def = SURFACES[opts.surface];
  if (!def) {
    logger.error(`unknown surface "${opts.surface}" — one of: ${Object.keys(SURFACES).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const checks = def.run();
  const held = checks.filter(c => c[1]).length;
  const allHold = held === checks.length;
  const artifact = {
    surface: opts.surface,
    module: def.module,
    governed: allHold,
    held,
    of: checks.length,
    baseline_trust_the_agent_holds: 0,
    checks: checks.map(([name, ok]) => ({ check: name, holds: ok })),
  };
  const out = opts.out ?? `out/gov-${opts.surface}.json`;
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync(out, JSON.stringify(artifact, null, 2) + '\n');

  if (opts.json) {
    process.stdout.write(JSON.stringify({ surface: opts.surface, module: def.module, held, of: checks.length, allHold, artifact: out }) + '\n');
  } else {
    logger.info(`gov-demo ${opts.surface} (${def.module}): ${held}/${checks.length} governance checks hold — ${allHold ? 'GOVERNED' : 'REGRESSION'} (artifact: ${out})`);
  }
  if (!allHold) process.exitCode = 1;
}
