#!/usr/bin/env node
// Measurement script for autoresearch canvas quality loop.
// Scores the canvas quality of the .op document at DESIGN.op (or a fallback fixture).
// Output: a single integer on stdout — the gapFromTarget (0 = all 7 dims pass >= 70).

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cwd = process.cwd();

// ── Load scorer from compiled dist ────────────────────────────────────────────

let scoreCanvasQuality;
try {
  const mod = await import('../dist/index.js');
  scoreCanvasQuality = mod.scoreCanvasQuality;
} catch {
  // Fall back to tsx-compiled source for dev
  try {
    const { createServer } = await import('node:http');
    void createServer; // suppress unused
    const { register } = await import('node:module');
    register('tsx/esm', import.meta.url);
    const mod = await import('../src/core/canvas-quality-scorer.ts');
    scoreCanvasQuality = mod.scoreCanvasQuality;
  } catch {
    console.error('Could not load canvas-quality-scorer — run npm run build first');
    process.exit(1);
  }
}

// ── Find or construct a test design ──────────────────────────────────────────

const designPath = join(cwd, '.danteforge', 'DESIGN.op');
const fixturePath = join(cwd, 'tests', 'fixtures', 'canvas-baseline.op.json');

let doc;
if (existsSync(designPath)) {
  doc = JSON.parse(readFileSync(designPath, 'utf8'));
} else if (existsSync(fixturePath)) {
  doc = JSON.parse(readFileSync(fixturePath, 'utf8'));
} else {
  // Synthesize a minimal representative design to score
  doc = {
    formatVersion: '1.0.0',
    generator: 'autoresearch-baseline',
    created: new Date().toISOString(),
    document: { name: 'Baseline', pages: [] },
    nodes: [{
      id: 'root', type: 'frame', name: 'App', width: 1440, height: 900,
      fills: [{ type: 'solid', color: '#f8f9fa' }],
      children: [
        { id: 't1', type: 'text', name: 'Title', characters: 'Dashboard', fontSize: 24, fontFamily: 'Arial', fills: [{ type: 'solid', color: '#343a40' }] },
        { id: 't2', type: 'text', name: 'Body', characters: 'Welcome', fontSize: 16, fontFamily: 'Arial', fills: [{ type: 'solid', color: '#6c757d' }] },
      ],
    }],
  };
}

// ── Score and report ──────────────────────────────────────────────────────────

const result = scoreCanvasQuality(doc);

// Write detailed breakdown to stderr for human review
const dims = result.dimensions;
process.stderr.write(`canvas-quality: composite=${result.composite} passing=${result.passingCount}/7 gap=${result.gapFromTarget}\n`);
process.stderr.write(`  artifactQuality:      ${dims.artifactQuality}\n`);
process.stderr.write(`  antiGeneric:          ${dims.antiGeneric}\n`);
process.stderr.write(`  colorDistinctiveness: ${dims.colorDistinctiveness}\n`);
process.stderr.write(`  typographyQuality:    ${dims.typographyQuality}\n`);
process.stderr.write(`  tokenCoherence:       ${dims.tokenCoherence}\n`);
process.stderr.write(`  responsiveness:       ${dims.responsiveness}\n`);
process.stderr.write(`  accessibility:        ${dims.accessibility}\n`);

// Metric output: gapFromTarget (0 = all pass, target for autoresearch)
process.stdout.write(String(result.gapFromTarget) + '\n');
