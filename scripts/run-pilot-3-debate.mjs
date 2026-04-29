// Phase B -- real two-critic Pilot 3 (PRD-MASTER Section 5.8 proper).
// Two distinct Ollama models act as Codex-like + Claude-like critics.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/esm';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

async function probeOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { up: false };
    const json = await res.json();
    return { up: true, models: (json.models ?? []).map(m => m.name) };
  } catch (e) {
    return { up: false, reason: e.message };
  }
}

function callOllama(model) {
  return async (prompt) => {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
      signal: AbortSignal.timeout(180_000)
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const json = await res.json();
    return json.message?.content ?? '';
  };
}

const probe = await probeOllama();
const evidenceDir = resolve(process.cwd(), '.danteforge/evidence');
mkdirSync(evidenceDir, { recursive: true });

if (!probe.up) {
  writeFileSync(resolve(evidenceDir, 'pilot-3-debate-mode.json'), JSON.stringify({
    runAt: new Date().toISOString(),
    status: 'skipped',
    reason: 'Ollama not reachable',
    nextStep: 'Start Ollama then re-run'
  }, null, 2) + '\n', 'utf-8');
  console.log('Ollama not reachable -- pilot 3 debate skipped');
  process.exit(0);
}

// Pick two distinct models -- prefer different families to maximize critic diversity
const MODELS = probe.models;
const codexLike = ['qwen2.5-coder:7b', 'qwen2.5-coder:latest', 'qwen2.5-coder:8k'].find(m => MODELS.includes(m)) ?? MODELS[0];
const claudeLike = ['llama3.1:8b', 'mistral:7b', 'gemma2:9b'].find(m => MODELS.includes(m) && m !== codexLike) ?? MODELS[1];

console.log(`Critic 1 (codex-like, technical): ${codexLike}`);
console.log(`Critic 2 (claude-like, business-writing): ${claudeLike}`);

const { runDebateMode, SEAN_LIPPAY_BRIEF } = await import('../src/spine/validation/sean_lippay_debate.js');

console.log(`\nRunning two-critic Pilot 3 with debate-mode round 2...`);
const result = await runDebateMode(
  SEAN_LIPPAY_BRIEF,
  { name: codexLike, persona: 'codex_like', call: callOllama(codexLike) },
  { name: claudeLike, persona: 'claude_like', call: callOllama(claudeLike) }
);

const summary = {
  runAt: result.timing.startedAt,
  endedAt: result.timing.endedAt,
  prdReference: 'PRD-MASTER Section 5.8 Pilot 3 -- Real Empanada outreach with two critics + debate mode',
  status: 'completed',
  critic1: { name: codexLike, persona: 'codex_like' },
  critic2: { name: claudeLike, persona: 'claude_like' },
  round1: {
    draftsCount: result.round1Drafts.length,
    drafts: result.round1Drafts.map(d => ({ role: d.role, authoredBy: d.authoredBy, durationMs: d.durationMs, length: d.draft.length, preview: d.draft.slice(0, 120) }))
  },
  round2: {
    critiquesCount: result.round2Critiques.length,
    critiques: result.round2Critiques.map(c => ({ critic: c.critic, rankingTopChoice: c.ranking[0]?.role, durationMs: c.durationMs, critiqueLength: c.critique.length }))
  },
  synthesis: result.synthesis,
  timing: result.timing,
  modelUsage: result.modelUsage,
  closesPRD: 'PRD-MASTER Section 5.8 Pilot 3 fully -- two critics + three drafts + round-2 critique + synthesis with consensus level'
};

writeFileSync(resolve(evidenceDir, 'pilot-3-debate-mode.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');

// Also persist the full drafts + critiques (verbose) for audit
writeFileSync(resolve(evidenceDir, 'pilot-3-debate-mode-verbose.json'), JSON.stringify({
  brief: SEAN_LIPPAY_BRIEF,
  round1: result.round1Drafts,
  round2: result.round2Critiques,
  synthesis: result.synthesis,
  timing: result.timing
}, null, 2) + '\n', 'utf-8');

console.log(`\n=== Pilot 3 (two-critic debate-mode) complete ===`);
console.log(`  Round 1 drafts: ${result.round1Drafts.length} (${result.timing.round1Ms}ms)`);
console.log(`  Round 2 critiques: ${result.round2Critiques.length} (${result.timing.round2Ms}ms)`);
console.log(`  Synthesis winner: ${result.synthesis.winner} (${result.synthesis.consensusLevel} consensus)`);
console.log(`  Total wall-clock: ${(result.timing.totalMs / 1000).toFixed(1)}s`);
console.log(`  Total LLM calls: ${result.modelUsage.reduce((s, m) => s + m.calls, 0)}`);
console.log(`  Evidence: ${resolve(evidenceDir, 'pilot-3-debate-mode.json')}`);
