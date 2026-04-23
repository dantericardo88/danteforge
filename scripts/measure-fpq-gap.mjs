#!/usr/bin/env node
/**
 * Metric: gap to 10.0 for the displayScore from danteforge measure.
 * Outputs (100 - score*10), so LOWER is better (matches autoresearch CLI direction).
 * Baseline: 100 - 88 = 12
 * Target:   100 - 90 = 10
 *
 * AUTORESEARCH INVARIANT: Do NOT modify this script during the loop.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let out = '';
try {
  out = execSync('danteforge measure --full', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  out = e.stdout ?? '';
}
// Parse "[INFO]   8.8/10  — ..."
const match = out.match(/(\d+\.\d+)\/10/);
const score = match ? parseFloat(match[1]) : 0;
const gap = Math.round((10 - score) * 10);
process.stdout.write(String(gap));
