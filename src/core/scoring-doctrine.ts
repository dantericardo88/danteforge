/**
 * Scoring Doctrine — the canonical rules for ALL scoring surfaces in DanteForge.
 *
 * Every command, loop, and prompt that produces or influences a score MUST
 * reference this module. This ensures consistent, evidence-based scoring
 * across: compete, ascend, crusade, goal-loop, autoforge, score, honest-rescore,
 * adversarial-scorer, and any future scoring surface.
 *
 * These rules apply regardless of which project DanteForge is scoring
 * (DanteForge, DanteCode, DanteAgents, DanteSecurity, etc.).
 */

export const SCORING_DOCTRINE = `
SCORING DOCTRINE — MANDATORY RULES FOR ALL SCORING

1. EVIDENCE ONLY — Scores MUST come from outcome evidence (capability tests,
   code existence checks, integration proofs) — never from opinions, gut
   feelings, or hardcoded numbers. If an evidence-rescore script exists, run it.
   If not, verify claims by checking that the code actually exists and works.

2. CORRECT COMPETITOR TAXONOMY — Compare ONLY against actual competitors
   defined in positioning.md (or the project's competitor taxonomy). Downstream
   consumers, adjacent tools, and products in a different category belong in a
   reference tier — scored for context but EXCLUDED from gap and priority
   calculations. Test: "Does this tool solve the same problem for the same
   user?" If no, it's reference tier.

3. GAP-TO-LEADER — Show gap-to-leader against actual competitors for every
   dimension. If gap=0, verify we genuinely lead — audit the evidence, don't
   hand-wave it. A zero gap must be earned, not assumed.

4. NO ADOPTION PENALTY — NEVER penalize for adoption metrics (users, downloads,
   stars, community size) on a pre-release or unreleased product. Score what the
   tool CAN DO end-to-end, not how many people are using it yet.

5. THE GAP IS THE VALUE — Finding real gaps means finding what to build next.
   Surface where competitors genuinely beat us on capability — that's actionable.
   Inflating our scores or hiding gaps helps no one.

6. "HARSH" MEANS EVIDENCE-BASED — It does NOT mean: penalize for no public
   users, compare against tools in a different category, or override
   evidence-derived scores with lower opinion numbers. If the evidence says 9.0,
   the score is 9.0. If the evidence says 4.0, the score is 4.0. Trust the
   evidence system.

7. RECEIPTS REQUIRED — Never write a score that cannot be traced back to a
   specific artifact: a file that exists, a test that passes, a command that
   runs, an integration that's wired. Code without a receipt is a hypothesis,
   not a feature.

8. RUNTIME VERIFICATION ABOVE 7.0 — Structural checks (file exists, function
   defined, string contains pattern) are capped at T4/7.0. Scores above 7.0
   require runtime execution evidence: the real CLI spawned and verified
   (cli-smoke), the real tests run (runtime-exec), or a multi-step workflow
   exercised (e2e-workflow). A 9.0 means "this feature works when you use it,"
   not just "the code is there."
`.trim();

export const SCORING_DOCTRINE_SHORT = `Evidence-based scoring only. Compare against actual competitors (not downstream consumers). No adoption penalties on pre-release tools. The gap is the value. "Harsh" = evidence-based, not opinion-based. Scores above 7.0 require runtime execution evidence.`;

export const SCORING_RULES_FOR_LLM_PROMPT = `
MANDATORY SCORING RULES (violating these produces invalid scores):
- Scores derive from outcome evidence and verifiable artifacts, never opinions
- Compare only against the project's declared actual competitors (see positioning.md)
- Downstream consumers / adjacent-category tools are reference tier only
- NEVER penalize for: no public users, no web UI, no community, being pre-release
- Score end-to-end CAPABILITY — what the tool can actually do, proven by evidence
- If evidence passes, the score stands. Do not override evidence with "gut feel"
- gap=0 must be audited: verify we genuinely lead, don't hand-wave
- Every score must trace to an artifact (file, test, command, integration)
- Scores above 7.0 require RUNTIME evidence (cli-smoke, runtime-exec, e2e-workflow)
- Structural file checks (readFileSync/includes) cap at T4/7.0 regardless of declared tier
`.trim();

export function buildScoringDoctrineHeader(): string {
  return `\n${'━'.repeat(72)}\n${SCORING_DOCTRINE}\n${'━'.repeat(72)}\n`;
}

export function wrapPromptWithDoctrine(prompt: string): string {
  return `${SCORING_RULES_FOR_LLM_PROMPT}\n\n${prompt}`;
}
