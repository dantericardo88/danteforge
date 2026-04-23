#!/usr/bin/env node
// Canvas code fidelity measurement — tests that canvas-defaults generates
// correct CSS custom properties and HTML preview for 5 diverse configurations.
// Metric: number of missing token checks (target: 0).
// Run via: node scripts/measure-canvas-code-fidelity.mjs

import { existsSync } from 'fs';
const sdkPath = new URL('../dist/sdk.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
if (!existsSync(sdkPath)) {
  process.stderr.write('ERROR: dist/sdk.js not found. Run: npm run build\n');
  process.exit(1);
}
const { getCanvasSeedDocument } = await import('../dist/sdk.js');
const { extractTokensFromDocument, tokensToCSS } = await import('../src/harvested/openpencil/token-extractor.ts').catch(() => {
  process.stderr.write('ERROR: token-extractor.ts not loadable. Run with: npx tsx scripts/measure-canvas-code-fidelity.mjs\n');
  process.exit(1);
});
const { renderToHTML } = await import('../src/harvested/openpencil/headless-renderer.ts').catch(() => {
  process.stderr.write('ERROR: headless-renderer.ts not loadable.\n');
  process.exit(1);
});

const PROMPTS = [
  { label: 'default', opts: { projectName: 'Dashboard' } },
  { label: 'fintech', opts: { projectName: 'Apex Finance', primaryColor: '#0D1B2A', accentColor: '#00F5D4', fontHeading: 'DM Serif Display', fontBody: 'Inter' } },
  { label: 'health', opts: { projectName: 'Vital Health', primaryColor: '#3D1A00', accentColor: '#FF8C42', fontHeading: 'Lora', fontBody: 'Nunito' } },
  { label: 'saas', opts: { projectName: 'Clarity SaaS', primaryColor: '#1B1F3B', accentColor: '#7B61FF', fontHeading: 'Fraunces', fontBody: 'Plus Jakarta Sans' } },
  { label: 'analytics', opts: { projectName: 'DataPulse', primaryColor: '#001F3F', accentColor: '#39D0FF', fontHeading: 'Cormorant Garamond', fontBody: 'Manrope' } },
];

// Token checks per prompt:
// 8 color CSS vars + 6 spacing CSS vars in generated CSS = 14 checks
// HTML: must be non-empty, contain project name, contain primary color
// Total per prompt: 17 checks

// tokensToCSS generates --color-<name> for colors, --<name> for spacing
// Variable names in canvas-defaults strip the type prefix to avoid double-prefix
const EXPECTED_COLOR_VARS = [
  '--color-bg-primary', '--color-accent', '--color-surface',
  '--color-text-primary', '--color-text-muted', '--color-border',
  '--color-violet', '--color-nav-text',
];
const EXPECTED_SPACING_VARS = [
  '--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl', '--space-2xl',
];

let totalMissing = 0;

for (const { label, opts } of PROMPTS) {
  const doc = getCanvasSeedDocument(opts);
  const tokens = extractTokensFromDocument(doc);
  const css = tokensToCSS(tokens);
  const html = renderToHTML(doc);

  const missing = [];

  // Check CSS vars (already include -- prefix)
  for (const varName of EXPECTED_COLOR_VARS) {
    if (!css.includes(varName)) missing.push(`CSS missing ${varName}`);
  }
  for (const varName of EXPECTED_SPACING_VARS) {
    if (!css.includes(varName)) missing.push(`CSS missing ${varName}`);
  }
  // Check HTML quality
  if (!html || html.length < 200) missing.push('HTML too short (<200 chars)');
  if (opts.projectName && !html.includes(opts.projectName)) missing.push(`HTML missing project name "${opts.projectName}"`);
  if (opts.primaryColor && !html.toLowerCase().includes(opts.primaryColor.toLowerCase())) {
    missing.push(`HTML missing primary color ${opts.primaryColor}`);
  }

  totalMissing += missing.length;
  const status = missing.length === 0 ? 'OK' : `FAIL(${missing.length})`;
  process.stderr.write(`[${label}] CSS vars: ${Object.keys(tokens.colors).length} colors, ${Object.keys(tokens.spacing).length} spacing | HTML: ${html.length}ch | ${status}\n`);
  if (missing.length > 0) {
    for (const m of missing) process.stderr.write(`  ← ${m}\n`);
  }
}

process.stderr.write(`\ntotalMissing: ${totalMissing} (target: 0)\n`);
process.stdout.write(String(totalMissing) + '\n');
