// problem-solving-contract.ts — the INTAKE half of DanteForge's problem-solving DNA (DFPP-001, council 2026-06-24).
//
// DanteForge already owns the SOLVE half (obstacle-registry / obstacle-solve-or-decompose / no-walls): it handles
// obstacles that arise MID-WORK. This module is the FRONT DOOR — it reigns in lazy verbs at task entry (t=0),
// resolves-then-proceeds (NEVER a hard ask-gate), and frames the goal so large problems get decomposed into small
// ones before the first cycle. Validated against the leaked Claude Code (Opus 4.8) + Codex (GPT-5.5) system prompts
// AND DanteForge's own CLAUDE.md/AGENTS.md, all of which encode the same disposition.
//
// Design constraints (council risks, honored):
//   - THIN. Prompt bloat is the #1 risk — only load-bearing invariants, single-sourced.
//   - FIELD-based, not verb-regex-based: a terse-but-complete goal ("fix typo in README") must NOT be blocked.
//     We block on missing CONTEXT/DONE/SCOPE, not on the verb alone.
//   - The 7 role-lenses are DATA (one line each), never 10 persona files.
//   - The resolution ladder reuses the existing blast-radius gating (deriveRadius) on the effect side — this module
//     only frames intake; it never re-implements the >=3-solution execution that obstacle-registry already owns.

/**
 * Layer 1 — the persistent Operating Contract. Prepend to a DISPATCHED prompt (a sub-agent/LLM task), NOT to a
 * code-output prompt whose parser expects only NEW_FILE/SEARCH-REPLACE blocks. Kept ~25 lines by design.
 */
export const OPERATING_CONTRACT = `## OPERATING CONTRACT (holds for every task, overrides casual phrasing)
1. INVESTIGATE before you mutate: reconstruct what the code ACTUALLY does before changing it; trace the real root
   cause; label anything you have not read or run as an assumption, never as a finding.
2. RESOLVE then proceed (bias to action): on an under-specified task, resolve from context -> sensible defaults ->
   proceed STATING the assumption. Stop and ask ONLY when the choice is genuinely the user's AND hard to reverse or
   outward-facing. A clarifying question is the exception, not the reflex.
3. PRESERVE behavior unless told otherwise; name the blast radius (what you touched / deliberately did NOT).
4. PROVE it: a task is done when there is EVIDENCE (a reproduction that now passes, a test, a run, an output diff) —
   not because the code looks right. For bugs: reproduce -> fix -> prove the reproduction passes.
5. SHIP discipline: no stubs/placeholders/TODOs in code presented as complete; follow existing conventions over your
   defaults; do not assume a library/framework is available — verify it is in use first.
6. Lead with the conclusion + the evidence. Disagree when warranted: reason + alternative + the specific risk.`;

/** The structured deliverable contract (Layer 2). Append to /ps + sub-agent FINAL replies — NOT code-output prompts. */
export const OUTPUT_CONTRACT = `## Output (end every substantive reply with these, in order)
FINDINGS — what the code/system actually does (grounded) + root cause/rationale.
CHANGE — what changed and why; blast radius (touched / deliberately untouched).
EVIDENCE — the proof the done-criteria are met (test/run/repro); anything NOT yet proven, named.
RISKS & ASSUMPTIONS — open assumptions taken (proceed-on-assumptions) + residual risk + the scenario that triggers it.
NEXT — one line, only if genuinely out of current scope.`;

/** Prepend the Operating Contract to a dispatched (LLM/sub-agent) prompt. */
export function wrapWithOperatingContract(prompt: string): string {
  return `${OPERATING_CONTRACT}\n\n${prompt}`;
}

/**
 * The 7 role-lenses as DATA — an analysis FRAME, not a costume. A lens resolves into concrete actions/checks
 * (which is the whole lever: each line maps to something the model can DO), never decorative persona prose.
 */
export const ROLE_LENSES: Record<string, string> = {
  debugging:
    'Reconstruct actual behavior, trace the true root cause, name hidden edge cases, propose the most robust fix. Do not guess.',
  architecture:
    'Reverse-engineer the architecture + data flow; name bad decisions, duplication, bottlenecks, scaling/maintainability risks; propose a BEHAVIOR-PRESERVING refactor.',
  performance:
    'Find the real bottlenecks for the stated metric + baseline; propose changes with expected impact; do not regress the named constraints.',
  security:
    'Audit for the named threat classes (auth, injection, data exposure, infra); output findings with severity, attack scenario, and a concrete fix each.',
  devops:
    'Design deployment / CI-CD / observability for the stated reliability + scale targets; output an actionable checklist, not prose.',
  frontend:
    'Build reusable, accessible components handling loading/empty/error/edge states; provide component API + usage + the production implementation.',
  'tech-lead':
    'Before code: surface clarifying questions, challenge weak decisions, name scaling risks, recommend the simplest viable approach; then tradeoff analysis + decision + plan.',
};

export type RoleLens = keyof typeof ROLE_LENSES;

/** Lazy verbs (informational `lazy` flag). Presence alone does NOT block — see VAGUE_* for the actual gate. */
const LAZY_VERB_RE =
  /\b(fix|find|solve|debug|optimi[sz]e|improve|clean[\s-]?up|refactor|review|audit|make\s+it\s+work|is\s+this\s+(good|ok|okay|right))\b/i;

// A goal is UNDER-SPECIFIED only when a lazy verb takes a VAGUE object ("the bug", "it", "this") — never a specific
// one ("typo in README:42"). This is the council's false-decomposition guard: terse-but-complete goals pass through.
const VAGUE_OBJECT_RE =
  /\b(fix|find|solve|debug|optimi[sz]e|improve|clean[\s-]?up|refactor|review|audit)\s+(it|this|that|the\s+(bug|problem|issue|error|code|app|thing|stuff|whole\s+thing))\b/i;
const VAGUE_PHRASE_RE =
  /^\s*(make\s+it\s+work|clean\s+it\s+up|fix\s+it|fix\s+the\s+bug|is\s+this\s+(good|ok|okay|right)|optimi[sz]e\s+this)\s*[.!?]?\s*$/i;

/** Fields the resolution ladder must fill (from context) before acting on a lazy verb. */
export interface IntakeFields {
  /** What's wrong / the goal, from the user's POV. */
  symptom?: string;
  /** What "done" looks like, concretely — how we PROVE it. */
  doneCriteria?: string;
  /** What must NOT change / the scope boundary. */
  scope?: string;
}

export interface IntakeClassification {
  /** Carries a lazy verb as its sole/leading instruction. */
  lazy: boolean;
  /** Required fields not yet resolvable from the goal text — the resolution ladder fills these from context first. */
  missingFields: string[];
  /** Whether the gate considers this under-specified (lazy AND missing >=2 required fields). */
  underSpecified: boolean;
  /** Best-guess analysis frame, from the goal text. */
  suggestedLens?: RoleLens;
}

/**
 * Classify a raw goal at intake. FIELD-based (per the council's false-decomposition risk): a goal is under-specified
 * only when it leads with a lazy verb AND lacks the context/done/scope fields. "fix typo in README:42" is terse but
 * complete (no missing fields) and passes straight through. Pure + dependency-free so every surface can call it.
 */
export function classifyIntake(goal: string, fields: IntakeFields = {}): IntakeClassification {
  const lazy = LAZY_VERB_RE.test(goal);
  const vague = VAGUE_OBJECT_RE.test(goal) || VAGUE_PHRASE_RE.test(goal);
  const missingFields: string[] = [];
  if (!fields.symptom) missingFields.push('symptom/goal — what is wrong, from your point of view');
  if (!fields.doneCriteria) missingFields.push('definition of done — what concretely PROVES it is resolved');
  if (!fields.scope) missingFields.push('scope boundary — what must NOT change');
  // Under-specified ONLY when the verb has a vague object AND the resolving fields are absent. A terse-but-complete
  // goal (specific object, or fields supplied) passes straight through — bias to action, never block the obvious.
  return { lazy, missingFields, underSpecified: vague && missingFields.length >= 2, suggestedLens: suggestLens(goal) };
}

function suggestLens(goal: string): RoleLens | undefined {
  // Prefix-match (\b at the start, word may continue): "injection" matches inject, "crashes" matches crash. This is
  // a best-guess HINT, not a gate — a rare false positive (auth→author) is acceptable; missing the obvious is not.
  const g = goal.toLowerCase();
  if (/\b(secur|auth|inject|vuln|exploit|csrf|xss)/.test(g)) return 'security';
  if (/\b(perf|slow|latenc|memory|speed|throughput|bottleneck)/.test(g)) return 'performance';
  if (/\b(architect|refactor|coupl|modular|structure|scal)/.test(g)) return 'architecture';
  if (/\b(deploy|docker|k8s|kubernetes|monitor|observab)/.test(g) || /\b(ci|cd)\b/.test(g)) return 'devops';
  if (/\b(component|render|frontend|css|a11y|accessib)/.test(g) || /\bui\b/.test(g)) return 'frontend';
  if (/\b(bug|error|crash|fail|broken|exception|stack)/.test(g)) return 'debugging';
  if (/\b(should we|trade.?off|approach|decide|plan|design)/.test(g)) return 'tech-lead';
  return undefined;
}
