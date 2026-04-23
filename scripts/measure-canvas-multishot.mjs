#!/usr/bin/env node
// Measurement script for multi-prompt canvas quality autoresearch loop.
// Scores canvas-defaults across 5 diverse design configurations.
// Target: average composite >=95 AND no single dimension below 90 across all prompts.
// Metric output: number of failing dims (0 = target achieved).
// Run via: node scripts/measure-canvas-multishot.mjs

import { existsSync } from 'fs';

// Load scorer and seed from SDK
const sdkPath = new URL('../dist/sdk.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
if (!existsSync(sdkPath)) {
  process.stderr.write('ERROR: dist/sdk.js not found. Run: npm run build\n');
  process.exit(1);
}
const { getCanvasSeedDocument, scoreCanvasQuality } = await import('../dist/sdk.js');

// 5 diverse design configurations — different palettes, sectors, aesthetics
const PROMPTS = [
  {
    label: 'default-dashboard',
    opts: { projectName: 'Dashboard' },
  },
  {
    label: 'fintech-dark',
    opts: { projectName: 'Apex Finance', primaryColor: '#0D1B2A', accentColor: '#00F5D4', fontHeading: 'DM Serif Display', fontBody: 'Inter' },
  },
  {
    label: 'health-warm',
    opts: { projectName: 'Vital Health', primaryColor: '#3D1A00', accentColor: '#FF8C42', fontHeading: 'Lora', fontBody: 'Nunito' },
  },
  {
    label: 'saas-minimal',
    opts: { projectName: 'Clarity SaaS', primaryColor: '#1B1F3B', accentColor: '#7B61FF', fontHeading: 'Fraunces', fontBody: 'Plus Jakarta Sans' },
  },
  {
    label: 'analytics-cool',
    opts: { projectName: 'DataPulse', primaryColor: '#001F3F', accentColor: '#39D0FF', fontHeading: 'Cormorant Garamond', fontBody: 'Manrope' },
  },
];

const COMPOSITE_FLOOR = 95;
const DIM_FLOOR = 90;

let totalFailing = 0;
const results = [];

for (const { label, opts } of PROMPTS) {
  const doc = getCanvasSeedDocument(opts);
  const score = scoreCanvasQuality(doc);
  const dims = score.dimensions;

  const failingDims = Object.entries(dims)
    .filter(([, v]) => v < DIM_FLOOR)
    .map(([k, v]) => `${k}=${v}`);
  const compositeFail = score.composite < COMPOSITE_FLOOR ? 1 : 0;

  totalFailing += failingDims.length + compositeFail;
  results.push({ label, composite: score.composite, passingCount: score.passingCount, dims, failingDims, compositeFail });

  process.stderr.write(`[${label}] composite=${score.composite} pass=${score.passingCount}/7${failingDims.length > 0 || compositeFail ? ' FAIL:' + [...failingDims, ...(compositeFail ? [`composite<${COMPOSITE_FLOOR}`] : [])].join(',') : ' OK'}\n`);
  for (const [k, v] of Object.entries(dims)) {
    process.stderr.write(`  ${k.padEnd(22)}: ${v}${v < DIM_FLOOR ? ' ← below floor' : ''}\n`);
  }
}

const avgComposite = Math.round(results.reduce((s, r) => s + r.composite, 0) / results.length);
process.stderr.write(`\navg composite: ${avgComposite}/${COMPOSITE_FLOOR} floor | totalFailing: ${totalFailing}\n`);
process.stderr.write(`target: 0 failing dims (all composites >=${COMPOSITE_FLOOR}, all dims >=${DIM_FLOOR})\n`);

// Metric: total number of failing checks (0 = all prompts meet both floors)
process.stdout.write(String(totalFailing) + '\n');
