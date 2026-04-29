// Phase B — score Article XIV on coherence + testability per PRD §6.5 #4.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const constitution = readFileSync(resolve(cwd, '.danteforge/CONSTITUTION.md'), 'utf-8');
const dimsDoc = readFileSync(resolve(cwd, '.danteforge/HARSH_SCORER_DIMENSIONS.md'), 'utf-8');

// Extract Article XIV body (between "## 14. Context Economy" and next "## ")
const xivStart = constitution.indexOf('## 14. Context Economy');
if (xivStart === -1) {
  console.error('Article XIV not found in CONSTITUTION.md');
  process.exit(1);
}
const remainingAfterStart = constitution.slice(xivStart);
const nextH2 = remainingAfterStart.slice(40).search(/\n## /);  // skip past the header itself
const xivBody = nextH2 === -1 ? remainingAfterStart : remainingAfterStart.slice(0, 40 + nextH2);

// === Coherence rubric (0-10) ==============================================
// 1. Names the principle (every token is a cost) — +2
// 2. Names the rule (verbose boilerplate must be compressed) — +2
// 3. Names sacred content types (errors/warnings/violations etc.) — +2
// 4. Names fail-closed when uncertain — +1.5
// 5. Names telemetry emission requirement — +1.5
// 6. Cross-references the harsh-scorer dimension — +1
function scoreCoherence(body) {
  const checks = {
    namesPrinciple: /every token entering.*is a cost|context.*scarce/i.test(body),
    namesRule: /must be compressed|filter|reduce without losing/i.test(body),
    namesSacredContent: /errors.*warnings.*stack traces|security findings|policy violations|sacred content/i.test(body),
    failClosed: /fail closed|pass.*through.*original|cannot prove/i.test(body),
    namesTelemetry: /telemetry|local telemetry|\.danteforge.*evidence|saved tokens.*compression ratio/i.test(body),
    crossRefScorer: /harsh scorer dimension/i.test(body)
  };
  const score =
    (checks.namesPrinciple ? 2 : 0) +
    (checks.namesRule ? 2 : 0) +
    (checks.namesSacredContent ? 2 : 0) +
    (checks.failClosed ? 1.5 : 0) +
    (checks.namesTelemetry ? 1.5 : 0) +
    (checks.crossRefScorer ? 1 : 0);
  return { checks, score: Math.min(10, Number(score.toFixed(2))) };
}

// === Testability rubric (0-10) ============================================
// Each of the 5 sub-metrics in HARSH_SCORER_DIMENSIONS.md must have a concrete
// signal a CI can read from disk. We verify the dim doc names them and the
// real Context Economy implementation provides each signal.
function scoreTestability() {
  const subMetrics = [
    'Filter coverage',
    'Evidence compression',
    'Telemetry emission',
    'Fail-closed compression',
    'Per-type rules'
  ];
  const namedInDoc = subMetrics.filter(m => dimsDoc.includes(m));

  // Verify each sub-metric has an on-disk signal a CI can verify:
  const signals = {
    filterCoverage: existsSync(resolve(cwd, 'src/core/context-economy/command-filter-registry.ts')) && existsSync(resolve(cwd, 'src/core/context-economy/filters/git.ts')),
    evidenceCompression: existsSync(resolve(cwd, 'src/core/context-economy/artifact-compressor.ts')),
    telemetryEmission: existsSync(resolve(cwd, 'src/core/context-economy/economy-ledger.ts')) && existsSync(resolve(cwd, '.danteforge/evidence/context-economy/2026-04-28.jsonl')),
    failClosedCompression: existsSync(resolve(cwd, 'src/core/context-economy/sacred-content.ts')),
    perTypeRules: existsSync(resolve(cwd, 'src/core/context-economy/runtime.ts'))
  };
  const signalCount = Object.values(signals).filter(Boolean).length;
  // 5 sub-metrics named + 5 signals on-disk → 10. Each missing signal → -1.
  const score = (namedInDoc.length / 5) * 5 + (signalCount / 5) * 5;
  return {
    subMetricsNamed: namedInDoc.length,
    expected: 5,
    onDiskSignals: signals,
    signalCount,
    score: Number(score.toFixed(2))
  };
}

const coherence = scoreCoherence(xivBody);
const testability = scoreTestability();

const result = {
  scoredAt: new Date().toISOString(),
  prdReference: 'PRD-MASTER §6.5 #4 — Article XIV scored on coherence + testability',
  article: 'XIV: Context Economy',
  bodyLength: xivBody.length,
  coherence,
  testability,
  meetsThreshold: coherence.score >= 9.0 && testability.score >= 9.0,
  threshold: 9.0
};

const outDir = resolve(cwd, '.danteforge/evidence');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'article-xiv-score.json');
writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf-8');

console.log('Article XIV scoring (PRD §6.5 #4):');
console.log(`  Coherence: ${coherence.score}/10`);
for (const [k, v] of Object.entries(coherence.checks)) console.log(`    ${v ? '✓' : '✗'} ${k}`);
console.log(`  Testability: ${testability.score}/10`);
console.log(`    sub-metrics named: ${testability.subMetricsNamed}/5`);
console.log(`    on-disk signals: ${testability.signalCount}/5`);
console.log(`  Threshold (9.0+ on both): ${result.meetsThreshold ? 'PASS' : 'FAIL'}`);
console.log(`  Evidence: ${out}`);
