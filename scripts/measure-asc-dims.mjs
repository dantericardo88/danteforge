#!/usr/bin/env node
/**
 * Metric: sum of autonomy + selfImprovement + convergenceSelfHealing STRICT signals (raw 0-300).
 * Exact port of computeStrictDimensions() from src/core/harsh-scorer.ts for these 3 dims.
 * Baseline: 282 (autonomy=100, selfImprovement=97, convergenceSelfHealing=85).
 *
 * AUTORESEARCH INVARIANT: This script and computeStrictDimensions MUST stay in sync.
 * Experiments that add a new signal add it here AND in harsh-scorer.ts simultaneously.
 *
 * Outputs a single integer to stdout — no logging, no prefixes.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const listDir = async (p) => { try { return await fs.readdir(p); } catch { return []; } };
const checkExists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
const gitLog = (args) => {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { return ''; }
};

// ── autonomy ──────────────────────────────────────────────────────────────────
let autonomy = 20;
const commitLog = gitLog('log --oneline --no-merges');
const commitCount = commitLog.trim() === '' ? 0 : commitLog.trim().split('\n').length;
if (commitCount >= 100) autonomy += 30;
else if (commitCount >= 30) autonomy += 20;
else if (commitCount >= 10) autonomy += 10;
else if (commitCount >= 1) autonomy += 5;

const verifyFiles = await listDir(path.join(cwd, '.danteforge', 'evidence', 'verify'));
if (verifyFiles.length >= 5) autonomy += 25;
else if (verifyFiles.length >= 2) autonomy += 15;
else if (verifyFiles.length >= 1) autonomy += 8;

if (await checkExists(path.join(cwd, '.danteforge', 'evidence', 'autoforge'))) autonomy += 15;
if (await checkExists(path.join(cwd, '.danteforge', 'evidence', 'oss-harvest.json'))) autonomy += 10;
autonomy = Math.max(0, Math.min(100, autonomy));

// ── selfImprovement ───────────────────────────────────────────────────────────
let selfImprovement = 20;
const retroLog = gitLog('log --oneline --grep=retro --no-merges');
const retroCount = retroLog.trim() === '' ? 0 : retroLog.trim().split('\n').length;
if (retroCount >= 10) selfImprovement += 25;
else if (retroCount >= 3) selfImprovement += 15;
else if (retroCount >= 1) selfImprovement += 8;

const lessonLog = gitLog('log --oneline --grep=lesson --no-merges');
const lessonCount = lessonLog.trim() === '' ? 0 : lessonLog.trim().split('\n').length;
if (lessonCount >= 10) selfImprovement += 20;
else if (lessonCount >= 3) selfImprovement += 12;
else if (lessonCount >= 1) selfImprovement += 5;

const retroEvidenceFiles = await listDir(path.join(cwd, '.danteforge', 'evidence', 'retro'));
if (retroEvidenceFiles.length >= 5) selfImprovement += 20;
else if (retroEvidenceFiles.length >= 2) selfImprovement += 12;
else if (retroEvidenceFiles.length >= 1) selfImprovement += 6;

if (await checkExists(path.join(cwd, '.danteforge', 'lessons.md'))) selfImprovement += 15;

const retrosOutputFiles = await listDir(path.join(cwd, '.danteforge', 'retros'));
if (retrosOutputFiles.length >= 10) selfImprovement += 15;
else if (retrosOutputFiles.length >= 3) selfImprovement += 8;
else if (retrosOutputFiles.length >= 1) selfImprovement += 3;
selfImprovement = Math.max(0, Math.min(100, selfImprovement));

// ── convergenceSelfHealing ────────────────────────────────────────────────────
let convergenceSelfHealing = 15;
if (await checkExists(path.join(cwd, 'src', 'core', 'circuit-breaker.ts'))) convergenceSelfHealing += 25;
if (await checkExists(path.join(cwd, 'src', 'core', 'context-compressor.ts'))) convergenceSelfHealing += 20;

const autoforgeEvidenceFiles = await listDir(path.join(cwd, '.danteforge', 'evidence', 'autoforge'));
if (autoforgeEvidenceFiles.length >= 3) convergenceSelfHealing += 15;
else if (autoforgeEvidenceFiles.length >= 1) convergenceSelfHealing += 8;

const convergenceProof = await checkExists(path.join(cwd, '.danteforge', 'evidence', 'convergence-proof.json'))
  || await checkExists(path.join(cwd, 'examples', 'todo-app', 'evidence', 'convergence-proof.json'));
if (convergenceProof) convergenceSelfHealing += 10;
convergenceSelfHealing = Math.max(0, Math.min(100, convergenceSelfHealing));

// ── output ────────────────────────────────────────────────────────────────────
process.stdout.write(String(autonomy + selfImprovement + convergenceSelfHealing));
