/**
 * Sean Lippay outreach with real two-critic debate-mode (Pilot 3 proper).
 *
 * Implements PRD-MASTER §5.8 Pilot 3 literally:
 * - Two critics with role assignment
 * - Round 1: each critic produces a draft for assigned role(s); 3 drafts total
 * - Round 2: each critic sees all drafts and produces critique + ranking
 * - Synthesis: select winner from aggregate ranking + reasoning
 *
 * The two critics in this implementation are two distinct Ollama models
 * acting as Codex-like and Claude-like personas (since real Codex+Claude API
 * access is gated on the founder; Ollama models running locally provide
 * a verifiable two-critic shape).
 */

import type { OutreachBrief } from './sean_lippay_outreach.js';
import { SEAN_LIPPAY_BRIEF } from './sean_lippay_outreach.js';

export type Role = 'persuasive' | 'concise' | 'technically-grounded';

export interface DebateLLM {
  name: string;
  persona: 'codex_like' | 'claude_like';
  call: (prompt: string) => Promise<string>;
}

export interface DebateRound1Draft {
  role: Role;
  authoredBy: string;
  draft: string;
  durationMs: number;
}

export interface DebateRound2Critique {
  critic: string;
  critique: string;
  ranking: { role: Role; rank: 1 | 2 | 3 }[];
  durationMs: number;
}

export interface DebateSynthesis {
  winner: Role;
  rationale: string;
  aggregateRankings: Record<Role, number>;
  consensusLevel: 'unanimous' | 'majority' | 'split';
}

export interface DebateResult {
  brief: OutreachBrief;
  round1Drafts: DebateRound1Draft[];
  round2Critiques: DebateRound2Critique[];
  synthesis: DebateSynthesis;
  timing: {
    startedAt: string;
    endedAt: string;
    totalMs: number;
    round1Ms: number;
    round2Ms: number;
    synthesisMs: number;
  };
  modelUsage: { name: string; persona: string; calls: number }[];
}

const ROLE_PROMPTS: Record<Role, string> = {
  persuasive: 'Write a warmer, rapport-driven outreach email. Open with a reference to the prior in-person conversation. Move into capacity, GFSI, pricing topics. Close with a low-friction next-step offer.',
  concise: 'Write a maximally concise outreach email. Three short blocks: capacity facts, GFSI status, pricing intent. Close with one clear next-step ask. No throat-clearing.',
  'technically-grounded': 'Write a dense, technically-detailed outreach email. List equipment specs, certification audit body and timeline, pricing tiers (placeholders ok). Close with a technical-call offer.'
};

export async function runDebateMode(
  brief: OutreachBrief,
  critic1: DebateLLM,
  critic2: DebateLLM
): Promise<DebateResult> {
  const startedAt = new Date();
  const startMs = Date.now();
  const calls = new Map<string, number>();
  const callTracker = (model: DebateLLM) => {
    return async (prompt: string) => {
      calls.set(model.name, (calls.get(model.name) ?? 0) + 1);
      return model.call(prompt);
    };
  };
  const c1 = { ...critic1, call: callTracker(critic1) };
  const c2 = { ...critic2, call: callTracker(critic2) };

  // Round 1: each critic produces a draft for an assigned role
  const round1Start = Date.now();
  const round1: DebateRound1Draft[] = [];

  // critic1 → persuasive
  {
    const t = Date.now();
    const draft = await c1.call(buildDraftPrompt('persuasive', brief, c1.persona));
    round1.push({ role: 'persuasive', authoredBy: c1.name, draft, durationMs: Date.now() - t });
  }
  // critic2 → concise
  {
    const t = Date.now();
    const draft = await c2.call(buildDraftPrompt('concise', brief, c2.persona));
    round1.push({ role: 'concise', authoredBy: c2.name, draft, durationMs: Date.now() - t });
  }
  // critic1 (technical persona) → technically-grounded
  {
    const t = Date.now();
    const draft = await c1.call(buildDraftPrompt('technically-grounded', brief, c1.persona));
    round1.push({ role: 'technically-grounded', authoredBy: c1.name, draft, durationMs: Date.now() - t });
  }
  const round1Ms = Date.now() - round1Start;

  // Round 2: each critic sees ALL drafts + produces critique with ranking
  const round2Start = Date.now();
  const round2: DebateRound2Critique[] = [];

  for (const critic of [c1, c2]) {
    const t = Date.now();
    const prompt = buildRound2Prompt(round1, critic.persona);
    const response = await critic.call(prompt);
    const ranking = extractRanking(response);
    round2.push({
      critic: critic.name,
      critique: response,
      ranking,
      durationMs: Date.now() - t
    });
  }
  const round2Ms = Date.now() - round2Start;

  // Synthesis: aggregate rankings, select winner with reasoning
  const synthStart = Date.now();
  const aggregate: Record<Role, number> = { persuasive: 0, concise: 0, 'technically-grounded': 0 };
  for (const c of round2) {
    for (const r of c.ranking) {
      aggregate[r.role] += (4 - r.rank);  // rank 1 = 3pts, rank 2 = 2pts, rank 3 = 1pt
    }
  }
  const sorted = (Object.entries(aggregate) as [Role, number][]).sort((a, b) => b[1] - a[1]);
  const winner = sorted[0]![0];
  const consensusLevel: DebateSynthesis['consensusLevel'] =
    sorted[0]![1] === 6 ? 'unanimous' :
    sorted[0]![1] >= 4 ? 'majority' :
    'split';
  const synthesis: DebateSynthesis = {
    winner,
    rationale: `Aggregated rank-based scoring across both critics: ${sorted.map(([r, p]) => `${r}=${p}`).join(', ')}. Winner: ${winner} (${consensusLevel} consensus).`,
    aggregateRankings: aggregate,
    consensusLevel
  };
  const synthesisMs = Date.now() - synthStart;

  const endedAt = new Date();
  const totalMs = Date.now() - startMs;

  return {
    brief,
    round1Drafts: round1,
    round2Critiques: round2,
    synthesis,
    timing: { startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), totalMs, round1Ms, round2Ms, synthesisMs },
    modelUsage: [
      { name: critic1.name, persona: critic1.persona, calls: calls.get(critic1.name) ?? 0 },
      { name: critic2.name, persona: critic2.persona, calls: calls.get(critic2.name) ?? 0 }
    ]
  };
}

function buildDraftPrompt(role: Role, brief: OutreachBrief, persona: string): string {
  return [
    `You are a ${persona === 'codex_like' ? 'technical, code-focused' : 'business-writing-focused'} reviewer drafting an outreach email.`,
    '',
    `Recipient: ${brief.recipient.name} at ${brief.recipient.company}.`,
    `Topics: ${brief.topics.join(', ')}.`,
    `Capacity facts: ${brief.capacityFacts.join(', ')}.`,
    `GFSI status: ${brief.certificationFacts[0] ?? '[founder will fill in]'}`,
    `Pricing: ${brief.pricingFacts[0] ?? '[founder will fill in]'}`,
    '',
    `Style: ${ROLE_PROMPTS[role]}`,
    '',
    `Output ONLY the email body. No preamble, no explanation. Maximum 200 words.`
  ].join('\n');
}

function buildRound2Prompt(drafts: DebateRound1Draft[], persona: string): string {
  return [
    `You are a ${persona === 'codex_like' ? 'technical' : 'business-writing'} reviewer critiquing three outreach email drafts.`,
    '',
    `Three drafts authored in round 1:`,
    '',
    ...drafts.map((d, i) => [`### Draft ${i + 1} (role: ${d.role}, by ${d.authoredBy})`, d.draft, ''].join('\n')),
    '',
    `Tasks:`,
    `1. Critique each draft in 1-2 sentences (what works, what doesn't).`,
    `2. Rank the drafts 1 (best) → 3 (worst) on the criterion: "Most likely to get a useful reply from the recipient given the prior in-person rapport."`,
    '',
    `Output your critique as plain text. Then on the LAST line write:`,
    `RANKING: <best-role>, <middle-role>, <worst-role>`,
    `(Use the exact role names: persuasive, concise, technically-grounded.)`
  ].join('\n');
}

function extractRanking(response: string): { role: Role; rank: 1 | 2 | 3 }[] {
  const m = /RANKING\s*:\s*([^\n]+)/i.exec(response);
  if (!m) {
    return [
      { role: 'persuasive', rank: 1 },
      { role: 'concise', rank: 2 },
      { role: 'technically-grounded', rank: 3 }
    ];
  }
  const parts = (m[1] ?? '').split(/[,;]/).map(p => p.trim().toLowerCase());
  const out: { role: Role; rank: 1 | 2 | 3 }[] = [];
  for (let i = 0; i < parts.length && i < 3; i++) {
    const p = parts[i] ?? '';
    let role: Role | null = null;
    if (/persuasive/.test(p)) role = 'persuasive';
    else if (/concise/.test(p)) role = 'concise';
    else if (/technical/.test(p) || /grounded/.test(p)) role = 'technically-grounded';
    if (role) out.push({ role, rank: (i + 1) as 1 | 2 | 3 });
  }
  // Fill gaps if extraction was incomplete
  const seen = new Set(out.map(o => o.role));
  let nextRank = (out.length + 1) as 1 | 2 | 3;
  for (const r of ['persuasive', 'concise', 'technically-grounded'] as Role[]) {
    if (!seen.has(r) && nextRank <= 3) {
      out.push({ role: r, rank: nextRank });
      nextRank = (nextRank + 1) as 1 | 2 | 3;
    }
  }
  return out;
}

export { SEAN_LIPPAY_BRIEF };
