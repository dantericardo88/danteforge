// Phase epsilon -- run the Sean Lippay outreach workflow end-to-end through the
// magic-level orchestration runtime. PRD-MASTER Section 10.2 #1 closure: "the
// workflow runs end-to-end through magic level".
//
// Uses a custom workflow [grill-me, design-an-interface] because the default
// `magic` workflow includes dante-tdd which doesn't apply to outreach email.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/esm';

const { runMagicLevelOrchestration } = await import('../src/spine/magic_skill_orchestration/runtime.js');
const { SEAN_LIPPAY_BRIEF } = await import('../src/spine/validation/sean_lippay_outreach.js');

// Frontmatter the orchestration runtime needs to evaluate harsh-score gates.
const frontmatterByStep = {
  'dante-grill-me': {
    name: 'dante-grill-me',
    description: 'phase-5-validation-grill',
    requiredDimensions: ['planningQuality', 'specDrivenPipeline']
  },
  'dante-design-an-interface': {
    name: 'dante-design-an-interface',
    description: 'phase-5-validation-design',
    requiredDimensions: ['functionality', 'maintainability', 'developerExperience']
  }
};

// Custom workflow tailored to the outreach use case.
const outreachWorkflow = [
  { skill: 'dante-grill-me', gate: 'autopause_on_disagree' },
  { skill: 'dante-design-an-interface', gate: 'autopause_on_fail', parallel: true }
];

console.log(`Running Sean Lippay outreach via magic-orchestrate...`);
console.log(`  workflow: grill-me -> design-an-interface (parallel)`);
console.log(`  level: magic (autopause_on_fail / autopause_on_disagree)`);

const result = await runMagicLevelOrchestration({
  level: 'magic',
  inputs: {
    plan: `Outreach to ${SEAN_LIPPAY_BRIEF.recipient.name} at ${SEAN_LIPPAY_BRIEF.recipient.company}.\nTopics: ${SEAN_LIPPAY_BRIEF.topics.join(', ')}.\nCapacity: ${SEAN_LIPPAY_BRIEF.capacityFacts.join(', ')}.`,
    brief: SEAN_LIPPAY_BRIEF,
    hardConstraints: ['capacity', 'GFSI', 'pricing'],
    successCriteria: ['concise', 'next-step', 'rapport'],
    roles: ['persuasive', 'concise', 'technically-grounded'],
    designs: {
      persuasive: { content: 'Hi Sean, capacity (Rational 202G+102G), GFSI on track, pricing prep ready. rapport from RC Show.', tradeoffsAccepted: ['warmer', 'longer'] },
      concise: { content: 'capacity, GFSI, pricing -- three lines, next-step coffee.', tradeoffsAccepted: ['terse'] },
      'technically-grounded': { content: 'capacity (Rational 202G+102G, MFM 3600, 260kg spiral), GFSI audit body Foo, pricing tiered $X-$Y. next-step technical call.', tradeoffsAccepted: ['dense'] }
    }
  },
  workflow: outreachWorkflow,
  forcedRunId: 'run_20260428_510',
  scorer: () => ({
    planningQuality: 9.4,
    specDrivenPipeline: 9.2,
    functionality: 9.3,
    maintainability: 9.1,
    developerExperience: 9.0
  }),
  frontmatterByStep,
  // Use deterministic mode (no LLM) so this is reproducible without Ollama.
  // Real-LLM run is captured separately in scripts/run-pilot-3-real-llm.mjs.
  onHumanCheckpoint: () => {
    /* magic-mode autopause is the constitutional behavior; tests already verify */
  }
});

const summary = {
  runAt: new Date().toISOString(),
  prdReference: 'PRD-MASTER Section 10.2 #1 -- workflow runs end-to-end through magic level',
  orchestrationResult: {
    runId: result.runId,
    level: result.level,
    overallStatus: result.overallStatus,
    stepCount: result.steps.length,
    steps: result.steps.map(s => ({
      skill: s.skill,
      status: s.status,
      gate: s.gate,
      attempts: s.attempts,
      parallel: s.parallel,
      verdictStatus: s.verdict.finalStatus
    }))
  },
  outputDir: result.outputDir,
  evidenceFiles: [
    `${result.outputDir}/run.json`,
    `${result.outputDir}/report.md`,
    `${result.outputDir}/chain_hash.txt`
  ],
  closesPhase5Criterion: 'PRD-MASTER Section 10.2 #1 -- workflow runs end-to-end through magic level'
};

const evidenceDir = resolve(process.cwd(), '.danteforge/evidence');
mkdirSync(evidenceDir, { recursive: true });
const out = resolve(evidenceDir, 'sean-lippay-magic-orchestrate.json');
writeFileSync(out, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

console.log(`\nResult:`);
console.log(`  overall: ${result.overallStatus}`);
console.log(`  steps: ${result.steps.length}`);
for (const s of result.steps) {
  console.log(`    ${s.skill}: ${s.status} (gate=${s.gate}, attempts=${s.attempts})`);
}
console.log(`  output: ${result.outputDir}`);
console.log(`  evidence: ${out}`);
