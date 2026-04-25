#!/usr/bin/env node
// Measurement script for autoresearch canvas quality loop.
// Scores the canvas quality of the .op document at DESIGN.op (or a synthetic baseline).
// Output: gapFromTarget on stdout (0 = all 7 dims pass >= 70, target for autoresearch).
// Run via: npx tsx scripts/measure-canvas-quality.mjs

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load scorer via tsx (dev) or compiled SDK (prod)
let scoreCanvasQuality;
try {
  // Try compiled SDK first (faster)
  const sdkPath = new URL('../dist/sdk.js', import.meta.url).pathname;
  if (existsSync(sdkPath.replace(/^\/([A-Z]:)/, '$1'))) {
    const mod = await import('../dist/sdk.js');
    scoreCanvasQuality = mod.scoreCanvasQuality;
  }
} catch { /* fall through to source */ }

if (!scoreCanvasQuality) {
  // Use the TypeScript source directly (tsx must be in PATH)
  // tsx registers ts extensions in the current process via --loader
  try {
    scoreCanvasQuality = (await import('../src/core/canvas-quality-scorer.ts')).scoreCanvasQuality;
  } catch {
    process.stderr.write('ERROR: could not load canvas-quality-scorer. Run: npm run build\n');
    process.exit(1);
  }
}

// ── Find or construct test design ─────────────────────────────────────────────

const cwd = process.cwd();
const designPath = join(cwd, '.danteforge', 'DESIGN.op');
const fixturePath = join(cwd, 'tests', 'fixtures', 'canvas-baseline.op.json');

let doc;
if (existsSync(designPath)) {
  try {
    doc = JSON.parse(readFileSync(designPath, 'utf8'));
  } catch { /* malformed .op — fall through to fixture/baseline */ }
}
if (!doc && existsSync(fixturePath)) {
  try { doc = JSON.parse(readFileSync(fixturePath, 'utf8')); } catch { /* ignored */ }
}
if (!doc) {
  // Use canvas-defaults seed document as the measurement target.
  // Experiments improve canvas-defaults.ts; measurement reflects those changes.
  try {
    const { getCanvasSeedDocument } = await import('../dist/sdk.js');
    doc = getCanvasSeedDocument({ projectName: 'Dashboard' });
  } catch {
    // Fallback if SDK not built yet
    doc = {
      formatVersion: '1.0.0',
      generator: 'autoresearch-fallback',
      created: new Date().toISOString(),
      document: { name: 'Baseline', pages: [] },
      nodes: [{
        id: 'root', type: 'frame', name: 'App', width: 1440, height: 900,
        fills: [{ type: 'solid', color: '#f8f9fa' }],
        children: [
          { id: 'h1', type: 'text', name: 'Heading', characters: 'Dashboard', fontSize: 24, fontFamily: 'Arial', fills: [{ type: 'solid', color: '#343a40' }] },
          { id: 'p1', type: 'text', name: 'Body', characters: 'Welcome to the app', fontSize: 16, fontFamily: 'Arial', fills: [{ type: 'solid', color: '#6c757d' }] },
          { id: 'btn', type: 'frame', name: 'btn-primary', width: 120, height: 36, fills: [{ type: 'solid', color: '#007bff' }] },
        ],
      }],
    };
  }
}

// ── Score and report ──────────────────────────────────────────────────────────

const result = scoreCanvasQuality(doc);
const dims = result.dimensions;

process.stderr.write(`canvas-quality: composite=${result.composite} passing=${result.passingCount}/7 gap=${result.gapFromTarget}\n`);
process.stderr.write(`  artifactQuality:      ${dims.artifactQuality}\n`);
process.stderr.write(`  antiGeneric:          ${dims.antiGeneric}\n`);
process.stderr.write(`  colorDistinctiveness: ${dims.colorDistinctiveness}\n`);
process.stderr.write(`  typographyQuality:    ${dims.typographyQuality}\n`);
process.stderr.write(`  tokenCoherence:       ${dims.tokenCoherence}\n`);
process.stderr.write(`  responsiveness:       ${dims.responsiveness}\n`);
process.stderr.write(`  accessibility:        ${dims.accessibility}\n`);

// Single integer on stdout — autoresearch metric (target: 0)
process.stdout.write(String(result.gapFromTarget) + '\n');
