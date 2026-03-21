#!/usr/bin/env node
// Coverage threshold enforcement for DanteForge v0.8.1
// Reads c8 JSON summary and enforces minimum thresholds
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const THRESHOLDS = {
  lines: 70,
  branches: 75,
};

const summaryPath = resolve('coverage/coverage-summary.json');

if (!existsSync(summaryPath)) {
  console.log('[check-coverage] No coverage report found. Run "npm run test:coverage" first.');
  console.log('[check-coverage] Skipping coverage check.');
  process.exit(0);  // Don't fail if no report exists yet
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
const total = summary.total;

let failed = false;
for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
  const actual = total[metric]?.pct ?? 0;
  if (actual < threshold) {
    console.error(`[check-coverage] FAIL: ${metric} coverage ${actual}% < ${threshold}% threshold`);
    failed = true;
  } else {
    console.log(`[check-coverage] PASS: ${metric} coverage ${actual}% >= ${threshold}%`);
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('[check-coverage] All coverage thresholds met.');
}
