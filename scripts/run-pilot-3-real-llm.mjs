// Phase I -- Pilot 3 with real LLM. Probes Ollama; if available, runs the
// Sean Lippay outreach grilling step against a real model and captures
// real assumptions surfaced by debate-mode round 2.
//
// Falls back gracefully with a clear status when Ollama is not reachable.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/esm';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

async function probeOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { up: false, reason: `HTTP ${res.status}` };
    const json = await res.json();
    const models = (json.models ?? []).map(m => m.name);
    return { up: true, models };
  } catch (e) {
    return { up: false, reason: e.message?.slice(0, 200) ?? String(e) };
  }
}

async function callOllama(model, prompt) {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  return json.message?.content ?? '';
}

const probe = await probeOllama();
const evidenceDir = resolve(process.cwd(), '.danteforge/evidence');
mkdirSync(evidenceDir, { recursive: true });

if (!probe.up) {
  const skip = {
    runAt: new Date().toISOString(),
    status: 'skipped',
    reason: probe.reason,
    nextStep: 'Start Ollama (`ollama serve`) or set OLLAMA_HOST then re-run `node scripts/run-pilot-3-real-llm.mjs`'
  };
  writeFileSync(resolve(evidenceDir, 'pilot-3-real-llm.json'), JSON.stringify(skip, null, 2) + '\n', 'utf-8');
  console.log(`Pilot 3 skipped: Ollama not reachable at ${OLLAMA_HOST} (${probe.reason})`);
  console.log(`Next step: ${skip.nextStep}`);
  process.exit(0);
}

console.log(`Ollama up at ${OLLAMA_HOST} with ${probe.models.length} models: ${probe.models.slice(0, 3).join(', ')}...`);

// Pick a small fast model for the pilot
const PREFERRED = ['qwen2.5-coder:7b', 'llama3.1:8b', 'mistral:7b', 'gemma2:9b'];
const model = PREFERRED.find(m => probe.models.includes(m)) ?? probe.models[0];
console.log(`Using model: ${model}`);

const { runOutreachWorkflow, SEAN_LIPPAY_BRIEF } = await import('../src/spine/validation/sean_lippay_outreach.js');
const { danteGrillMeExecutor } = await import('../src/spine/skill_runner/executors/dante-grill-me-executor.js');

// Inject _llmCaller into the grill executor by wrapping it
const realLlmGrillExecutor = async (inputs) => {
  // Add the LLM caller before passing through
  const enhanced = { ...inputs, _llmCaller: (prompt) => callOllama(model, prompt) };
  return danteGrillMeExecutor(enhanced);
};

console.log(`\nRunning Sean Lippay outreach with real LLM grilling...`);
const result = await runOutreachWorkflow({
  repo: process.cwd(),
  brief: SEAN_LIPPAY_BRIEF,
  grillExecutor: realLlmGrillExecutor
});

const summary = {
  runAt: new Date().toISOString(),
  status: 'completed',
  ollamaHost: OLLAMA_HOST,
  model,
  outputDir: result.outDir,
  grillVerdict: {
    finalStatus: result.grillVerdict.finalStatus,
    score: result.grillVerdict.score,
    supportedClaims: result.grillVerdict.supportedClaims?.length ?? 0,
    opinionClaims: result.grillVerdict.opinionClaims?.length ?? 0
  },
  designVerdict: {
    finalStatus: result.designVerdict.finalStatus,
    score: result.designVerdict.score
  },
  humanGate: {
    status: result.humanGate.status,
    reason: result.humanGate.reason
  },
  finalEmailLength: result.finalEmailDraft.length
};

writeFileSync(resolve(evidenceDir, 'pilot-3-real-llm.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');

console.log(`\nPilot 3 (real LLM) complete:`);
console.log(`  grill: ${summary.grillVerdict.finalStatus} score=${summary.grillVerdict.score.toFixed(2)} (opinions=${summary.grillVerdict.opinionClaims})`);
console.log(`  design: ${summary.designVerdict.finalStatus} score=${summary.designVerdict.score.toFixed(2)}`);
console.log(`  human gate: ${summary.humanGate.status}`);
console.log(`  output: ${summary.outputDir}`);
console.log(`Written to ${resolve(evidenceDir, 'pilot-3-real-llm.json')}`);
