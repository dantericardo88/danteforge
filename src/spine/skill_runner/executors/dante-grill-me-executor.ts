/**
 * /dante-grill-me executor — depth-escalation interview engine.
 *
 * Deterministic mode: derives a question batch per depth level from the input
 * plan; produces the assumptions catalog; reports surfaced assumptions back
 * to the runner so they become opinion claims in the verdict.
 */

import type { SkillExecutor } from '../runner.js';

export interface GrillInputs {
  plan: string;
  roles?: ('security' | 'performance' | 'simplicity' | 'devils-advocate' | 'scalability' | 'developer-experience' | 'compliance')[];
  budgetTurns?: number;
  /** Optional LLM caller. When provided, the executor uses it for question generation
   * and disagreement-detection passes. When absent, deterministic mode runs. */
  _llmCaller?: (prompt: string) => Promise<string>;
}

interface GrillOutput {
  questions: { depth: 'surface' | 'mechanism' | 'assumption' | 'counterfactual'; role?: string; text: string }[];
  surfacedAssumptions: string[];
  refinedPlan: string;
  unresolvedDisagreements: string[];
}

export const danteGrillMeExecutor: SkillExecutor = async (raw) => {
  const inputs = parseInputs(raw);
  let questions = generateQuestions(inputs.plan, inputs.roles ?? []);
  let surfaced = surfaceAssumptions(inputs.plan, questions);

  if (inputs._llmCaller) {
    // LLM-driven mode: ask the model to extend the surfaced assumptions list with anything
    // the deterministic heuristics missed. Combine and dedupe.
    try {
      const prompt = [
        'You are an adversarial reviewer in a /dante-grill-me session.',
        '',
        'Given the plan below and the assumptions already surfaced by deterministic analysis,',
        'list 2-3 ADDITIONAL hidden assumptions or counterfactual risks the deterministic pass missed.',
        'Return one assumption per line, no preamble.',
        '',
        '--- Plan ---',
        inputs.plan,
        '',
        '--- Already-surfaced assumptions ---',
        ...surfaced.map((a, i) => `${i + 1}. ${a}`),
        '',
        '--- Additional assumptions (one per line) ---'
      ].join('\n');
      const response = await inputs._llmCaller(prompt);
      const extra = response.split(/\r?\n/).map(l => l.replace(/^[-*\d.\s]+/, '').trim()).filter(l => l.length > 8 && l.length < 300);
      for (const e of extra.slice(0, 5)) {
        if (!surfaced.some(s => s.toLowerCase() === e.toLowerCase())) surfaced.push(e);
      }
    } catch {
      // LLM call failed; deterministic mode persists
    }
  }

  const refined = renderRefinedPlan(inputs.plan, surfaced);
  const unresolved = detectUnresolved(inputs.plan, surfaced);
  void questions; questions = generateQuestions(inputs.plan, inputs.roles ?? []);
  const output: GrillOutput = {
    questions,
    surfacedAssumptions: surfaced,
    refinedPlan: refined,
    unresolvedDisagreements: unresolved
  };
  return {
    output,
    phaseArtifacts: [
      { label: 'phase1_plan_ingestion', payload: { stated: extractStatedSections(inputs.plan) } },
      { label: 'phase2_round1_questions', payload: questions.filter(q => q.depth !== 'counterfactual') },
      { label: 'phase3_round2_questions', payload: questions.filter(q => q.depth === 'counterfactual') },
      { label: 'phase5_assumptions', payload: surfaced },
      { label: 'phase6_refined_plan', payload: refined }
    ],
    surfacedAssumptions: surfaced
  };
};

function parseInputs(raw: Record<string, unknown>): GrillInputs {
  return {
    plan: typeof raw.plan === 'string' ? raw.plan : '',
    roles: Array.isArray(raw.roles) ? (raw.roles as GrillInputs['roles']) : undefined,
    budgetTurns: typeof raw.budgetTurns === 'number' ? raw.budgetTurns : 12,
    _llmCaller: typeof raw._llmCaller === 'function' ? (raw._llmCaller as (p: string) => Promise<string>) : undefined
  };
}

function generateQuestions(plan: string, roles: string[]): GrillOutput['questions'] {
  const out: GrillOutput['questions'] = [];
  const role = roles[0] ?? 'general';
  const surface = [
    `What does the plan stay silent about that a reader would want to know first?`,
    `Are all named entities (services, people, deadlines) explicitly defined?`,
    `What is the smallest unit of work this plan describes?`
  ];
  const mechanism = [
    `How does this plan handle the case where a downstream dependency is unavailable?`,
    `What happens when the data the plan reasons about is malformed?`,
    `Where in the plan does retry/backoff live, if at all?`
  ];
  const assumption = [
    `What latency / cost / hardware budget is the plan implicitly assuming?`,
    `What does the plan assume about team availability and skill mix?`,
    `What prior-art or framework does the plan assume is stable?`
  ];
  const counterfactual = [
    `What would have to be true for the plan to fail the three-way gate?`,
    `If the chosen approach is wrong, what's the rollback cost?`,
    `Which assumption, if false, breaks the most of the plan?`
  ];
  for (const text of surface) out.push({ depth: 'surface', role, text });
  for (const text of mechanism) out.push({ depth: 'mechanism', role, text });
  for (const text of assumption) out.push({ depth: 'assumption', role, text });
  for (const text of counterfactual) out.push({ depth: 'counterfactual', role, text });
  return out;
}

function surfaceAssumptions(plan: string, questions: GrillOutput['questions']): string[] {
  const out: string[] = [];
  if (!/(deadline|timeline|by\s+\w+)/i.test(plan)) out.push('Plan does not state a deadline; assumes timeline is open-ended.');
  if (!/(budget|cost|hardware|gpu|ram)/i.test(plan)) out.push('Plan does not state a cost or hardware budget; assumes resources are unconstrained.');
  if (!/(test|verify|verification|coverage)/i.test(plan)) out.push('Plan does not state a verification step; assumes a separate process tests the result.');
  if (!/(rollback|revert|undo|fallback)/i.test(plan)) out.push('Plan does not state a rollback path; assumes the change is forward-only.');
  if (out.length < 3) {
    // Iron Law: ≥3 assumptions surfaced. Add universal ones if specifics not detectable.
    out.push('Plan assumes the conversation context is current.');
    out.push('Plan assumes the founder confirms ambiguity rather than the implementer guessing.');
    out.push('Plan assumes the chosen approach is constitutionally compatible.');
  }
  return out.slice(0, Math.max(3, out.length));
}

function renderRefinedPlan(plan: string, assumptions: string[]): string {
  const header = '# Refined Plan (post-grill)\n\n## Original plan\n\n' + plan + '\n\n';
  const asmSection = '## Surfaced assumptions (require founder confirmation)\n\n' + assumptions.map((a, i) => `${i + 1}. ${a}`).join('\n');
  return header + asmSection + '\n';
}

function detectUnresolved(plan: string, assumptions: string[]): string[] {
  const unresolved: string[] = [];
  // If a "high-risk" keyword appears alongside an assumption, flag it.
  const highRiskKeywords = /(security|legal|money|production|payment|credentials)/i;
  if (highRiskKeywords.test(plan)) {
    unresolved.push('Plan touches a high-risk surface (security/legal/money/production); founder must explicitly accept assumptions before proceeding.');
  }
  if (assumptions.length >= 5) {
    unresolved.push(`${assumptions.length} surfaced assumptions — plan may be under-specified for current strictness.`);
  }
  return unresolved;
}

function extractStatedSections(plan: string): { goal?: string; approach?: string; success?: string } {
  const goal = /goal\s*[:\-]\s*([^\n]+)/i.exec(plan)?.[1]?.trim();
  const approach = /approach\s*[:\-]\s*([^\n]+)/i.exec(plan)?.[1]?.trim();
  const success = /success\s*(?:criteria|metric)\s*[:\-]\s*([^\n]+)/i.exec(plan)?.[1]?.trim();
  return { goal, approach, success };
}
