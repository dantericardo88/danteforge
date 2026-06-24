// ps.ts — `danteforge ps <goal>` (a.k.a. /ps "problem solve") — the explicit INTAKE front door.
//
// Takes a simple/lazy command ("fix the bug", "optimize this") and reigns it in: classifies it, attaches the best
// role-lens, and renders a resolve-then-proceed task contract — the structured task the agent (or an autonomy loop)
// then executes. It does NOT hard-block: per the resolution ladder, missing fields are flagged as "resolve from
// context" (proceed + state the assumption), and only genuinely-unresolvable + irreversible choices become a stop.
//
// Pure render (runPs) is dependency-free + unit-tested; the thin CLI wrapper prints it. Decomposition into ledger
// sub-problems reuses the existing solveOrDecompose/recordDecomposition engine (the SOLVE half) — never re-implemented.

import {
  classifyIntake,
  wrapWithOperatingContract,
  OUTPUT_CONTRACT,
  ROLE_LENSES,
  type IntakeFields,
  type RoleLens,
} from '../../core/problem-solving-contract.js';

export interface PsOptions {
  goal: string;
  symptom?: string;
  done?: string;
  scope?: string;
  lens?: string;
}

export interface PsResult {
  goal: string;
  lazy: boolean;
  underSpecified: boolean;
  missingFields: string[];
  lens?: RoleLens;
  /** The reigned-in task contract — paste this where "fix the bug" would have gone. */
  contract: string;
}

/** Pure: classify a raw goal and render the resolve-then-proceed task contract. */
export function runPs(opts: PsOptions): PsResult {
  const fields: IntakeFields = { symptom: opts.symptom, doneCriteria: opts.done, scope: opts.scope };
  const c = classifyIntake(opts.goal, fields);
  const lens: RoleLens | undefined =
    opts.lens && opts.lens in ROLE_LENSES ? (opts.lens as RoleLens) : c.suggestedLens;
  return {
    goal: opts.goal,
    lazy: c.lazy,
    underSpecified: c.underSpecified,
    missingFields: c.missingFields,
    lens,
    contract: renderContract(opts.goal, fields, lens),
  };
}

function fieldLine(label: string, value: string | undefined): string {
  return value ? `- [x] ${label}: ${value}` : `- [ ] ${label}: RESOLVE FROM CONTEXT (then state the assumption)`;
}

function renderContract(goal: string, fields: IntakeFields, lens: RoleLens | undefined): string {
  const lensLine = lens ? `## Role lens: ${lens}\n${ROLE_LENSES[lens]}\n\n` : '';
  const body = `# TASK (intake-normalized): ${goal}

${lensLine}## Resolution ladder (fill from context BEFORE acting; ask ONLY on unresolvable + irreversible)
${fieldLine('symptom/goal (what is wrong, from the user POV)', fields.symptom)}
${fieldLine('definition of done (what PROVES it is resolved)', fields.doneCriteria)}
${fieldLine('scope boundary (what must NOT change)', fields.scope)}

If a field above is unresolved but the work is reversible: take the sensible default, proceed, and surface the
assumption in RISKS & ASSUMPTIONS. Stop and ask only when a choice is genuinely the user's AND hard to undo.

${OUTPUT_CONTRACT}`;
  return wrapWithOperatingContract(body);
}

/** Thin CLI action: print the reigned-in contract for a goal. */
export async function psCommand(opts: PsOptions, log: (s: string) => void = console.log): Promise<PsResult> {
  const r = runPs(opts);
  if (r.underSpecified) {
    log(`[ps] "${r.goal}" is a lazy verb missing ${r.missingFields.length} field(s) — reigned in via the resolution`);
    log(`[ps] ladder (resolve-then-proceed, not a hard ask-gate). Suggested lens: ${r.lens ?? '(none)'}\n`);
  } else {
    log(`[ps] "${r.goal}" is well-formed${r.lens ? ` (lens: ${r.lens})` : ''} — contract below.\n`);
  }
  log(r.contract);
  return r;
}
