// Completion Target — manages the user's definition of "done"
// Persists to .danteforge/completion-target.json
// Prompts interactively (readline) when not yet defined.
//
// Priority: load from file → prompt user → return default

import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompletionMode = 'feature-universe' | 'dimension-based' | 'custom';

export interface CompletionTarget {
  mode: CompletionMode;
  minScore: number;              // 0-10, default: 9.0
  featureCoverage?: number;      // % of features to implement, default: 90 (mode=feature-universe)
  customCriteria?: string[];     // user-defined text items (mode=custom)
  description: string;           // Human-readable summary of what "done" means
  definedAt: string;
  definedBy: 'user-prompted' | 'default' | 'preset';
}

const TARGET_FILE = 'completion-target.json';

const DEFAULT_TARGET: CompletionTarget = {
  mode: 'feature-universe',
  minScore: 9.0,
  featureCoverage: 90,
  description: 'Feature universe scoring: 9+/10 avg on 90% of competitor feature universe',
  definedAt: new Date().toISOString(),
  definedBy: 'default',
};

// ── Injection seams for testing ────────────────────────────────────────────────

export interface CompletionTargetOptions {
  cwd?: string;
  _readFile?: (filePath: string) => Promise<string>;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  _now?: () => string;
  // Readline injection for testing (avoids real stdin)
  _readline?: {
    question: (prompt: string, callback: (answer: string) => void) => void;
    close: () => void;
  };
}

// ── Load / Save ───────────────────────────────────────────────────────────────

export async function loadCompletionTarget(
  cwd: string,
  _readFile?: (filePath: string) => Promise<string>,
): Promise<CompletionTarget | null> {
  const readFn = _readFile ?? ((p: string) => fs.readFile(p, 'utf-8'));
  try {
    const content = await readFn(path.join(cwd, '.danteforge', TARGET_FILE));
    return JSON.parse(content) as CompletionTarget;
  } catch {
    return null;
  }
}

export async function saveCompletionTarget(
  target: CompletionTarget,
  cwd: string,
  _writeFile?: (filePath: string, content: string) => Promise<void>,
): Promise<void> {
  const writeFn = _writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf-8'));
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await writeFn(path.join(dir, TARGET_FILE), JSON.stringify(target, null, 2));
}

// ── Interactive prompt ────────────────────────────────────────────────────────

export async function promptUserForCompletionTarget(
  opts: CompletionTargetOptions = {},
): Promise<CompletionTarget> {
  const now = opts._now ?? (() => new Date().toISOString());

  logger.info('');
  logger.info('┌─────────────────────────────────────────────────────────────┐');
  logger.info('│  No completion target defined. How should "done" be defined? │');
  logger.info('└─────────────────────────────────────────────────────────────┘');
  logger.info('');
  logger.info('  1. Feature Universe (recommended)');
  logger.info('     Analyze competitors → extract all unique function-level capabilities');
  logger.info('     Build the union across all competitors (40-100 feature line items)');
  logger.info('     Score: how well we implement each feature in the universe');
  logger.info('     "Done" = 9+/10 avg on 90% of all unique features');
  logger.info('');
  logger.info('  2. Standard Dimensions');
  logger.info('     Use 18-dimension quality scoring (functionality, testing, security, etc.)');
  logger.info('     "Done" = all 20 dimensions score 9+/10');
  logger.info('');
  logger.info('  3. Custom Criteria');
  logger.info('     You define what "done" looks like in plain text');
  logger.info('');

  const choice = await askQuestion('Enter choice (1/2/3) [1]: ', opts._readline);
  const trimmed = choice.trim() || '1';

  if (trimmed === '2') {
    const minScoreStr = await askQuestion('Minimum score required (0-10) [9.0]: ', opts._readline);
    const minScore = parseFloat(minScoreStr.trim() || '9.0');
    const target: CompletionTarget = {
      mode: 'dimension-based',
      minScore: isFinite(minScore) ? Math.max(0, Math.min(10, minScore)) : 9.0,
      description: `Standard 18-dimension scoring: all dimensions ≥ ${minScore}/10`,
      definedAt: now(),
      definedBy: 'user-prompted',
    };
    return target;
  }

  if (trimmed === '3') {
    logger.info('Enter your completion criteria (one per line, blank line to finish):');
    const criteria: string[] = [];
    let collecting = true;
    while (collecting) {
      const line = await askQuestion('  > ', opts._readline);
      if (!line.trim()) { collecting = false; continue; }
      criteria.push(line.trim());
      if (criteria.length >= 20) collecting = false;
    }
    const minScoreStr = await askQuestion('Minimum score to stop loop (0-10) [9.0]: ', opts._readline);
    const minScore = parseFloat(minScoreStr.trim() || '9.0');
    const target: CompletionTarget = {
      mode: 'custom',
      minScore: isFinite(minScore) ? Math.max(0, Math.min(10, minScore)) : 9.0,
      customCriteria: criteria.length > 0 ? criteria : ['All key features implemented and tested'],
      description: `Custom: ${criteria.slice(0, 2).join('; ')}${criteria.length > 2 ? '...' : ''}`,
      definedAt: now(),
      definedBy: 'user-prompted',
    };
    return target;
  }

  // Default: feature-universe (choice 1 or invalid)
  const minScoreStr = await askQuestion('Minimum feature score (0-10) [9.0]: ', opts._readline);
  const coverageStr = await askQuestion('Minimum coverage % (0-100) [90]: ', opts._readline);
  const minScore = parseFloat(minScoreStr.trim() || '9.0');
  const coverage = parseInt(coverageStr.trim() || '90', 10);

  return {
    mode: 'feature-universe',
    minScore: isFinite(minScore) ? Math.max(0, Math.min(10, minScore)) : 9.0,
    featureCoverage: isFinite(coverage) ? Math.max(0, Math.min(100, coverage)) : 90,
    description: `Feature universe: ${minScore}/10 avg on ${coverage}% of competitor features`,
    definedAt: now(),
    definedBy: 'user-prompted',
  };
}

// ── Load or prompt ────────────────────────────────────────────────────────────

export async function getOrPromptCompletionTarget(
  cwd: string,
  isInteractive = false,
  opts: CompletionTargetOptions = {},
): Promise<CompletionTarget> {
  // Check file first
  const existing = await loadCompletionTarget(cwd, opts._readFile);
  if (existing) return existing;

  // Interactive prompt if TTY
  if (isInteractive) {
    const target = await promptUserForCompletionTarget(opts);
    // Save so we don't prompt again
    await saveCompletionTarget(target, cwd, opts._writeFile).catch(() => {});
    return target;
  }

  // Non-interactive default
  return { ...DEFAULT_TARGET, definedAt: (opts._now ?? (() => new Date().toISOString()))() };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatCompletionTarget(target: CompletionTarget): string {
  switch (target.mode) {
    case 'feature-universe':
      return [
        `Mode: Feature Universe`,
        `Target: ${target.minScore}/10 average score`,
        `Coverage: ${target.featureCoverage ?? 90}% of feature universe must be implemented`,
        `Description: ${target.description}`,
      ].join('\n');

    case 'dimension-based':
      return [
        `Mode: Standard 18-Dimension Scoring`,
        `Target: ${target.minScore}/10 across all dimensions`,
        `Description: ${target.description}`,
      ].join('\n');

    case 'custom':
      return [
        `Mode: Custom Criteria`,
        `Target: ${target.minScore}/10`,
        `Criteria:`,
        ...(target.customCriteria ?? []).map((c) => `  - ${c}`),
      ].join('\n');
  }
}

export function checkPassesTarget(
  overallScore: number,
  target: CompletionTarget,
  coveragePercent?: number,
): boolean {
  if (overallScore < target.minScore) return false;
  if (target.mode === 'feature-universe' && coveragePercent !== undefined) {
    return coveragePercent >= (target.featureCoverage ?? 90);
  }
  return true;
}

// ── Readline helper ───────────────────────────────────────────────────────────

function askQuestion(
  prompt: string,
  mockReadline?: CompletionTargetOptions['_readline'],
): Promise<string> {
  if (mockReadline) {
    return new Promise<string>((resolve) => {
      mockReadline.question(prompt, (answer) => resolve(answer));
    });
  }

  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
