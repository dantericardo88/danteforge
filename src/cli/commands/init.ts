// init — interactive first-run wizard for new DanteForge projects
// Asks 3 questions to personalize next steps, then runs health checks.
import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { detectProjectType } from '../../core/completion-tracker.js';
import { isLLMAvailable } from '../../core/llm.js';
import { loadConfig } from '../../core/config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InitOptions {
  prompt?: boolean;
  nonInteractive?: boolean;
  cwd?: string;
  // Injection seams for testing
  _isTTY?: boolean;
  _readline?: {
    question: (prompt: string, callback: (answer: string) => void) => void;
    close: () => void;
  };
  _isLLMAvailable?: () => Promise<boolean>;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const timestamp = new Date().toISOString();
  const isInteractive = (options._isTTY ?? process.stdout.isTTY) && !options.nonInteractive;
  const loadStateFn = options._loadState ?? loadState;
  const saveStateFn = options._saveState ?? saveState;
  const llmAvailableFn = options._isLLMAvailable ?? isLLMAvailable;

  logger.success('DanteForge Init — Project Setup Wizard');
  logger.info('');

  // ── Step 1: Wizard questions (TTY only) ──────────────────────────────────
  let projectDescription = '';
  let experienceLevel = 1;  // 1=new, 2=used before, 3=power user
  let preferredLevel = 'magic';

  if (isInteractive) {
    logger.info('Welcome to DanteForge! Let me personalize your setup.');
    logger.info('');

    projectDescription = await askQuestion(
      '  What are you building? (brief description, Enter to skip)\n  > ',
      options._readline,
    );

    logger.info('');
    logger.info('  Your experience with DanteForge:');
    logger.info('    1. New to DanteForge');
    logger.info('    2. Used it before');
    logger.info('    3. Power user');
    const expChoice = await askQuestion('  Enter choice [1]: ', options._readline);
    experienceLevel = parseInt(expChoice.trim() || '1', 10);
    if (![1, 2, 3].includes(experienceLevel)) experienceLevel = 1;

    logger.info('');
    logger.info('  How much automation do you want by default?');
    logger.info('    1. Just planning (spark)  — zero tokens, safe to try');
    logger.info('    2. Balanced (magic)       — recommended for most work');
    logger.info('    3. Full power (inferno)   — maximum quality push');
    const levelChoice = await askQuestion('  Enter choice [2]: ', options._readline);
    const levelNum = parseInt(levelChoice.trim() || '2', 10);
    preferredLevel = levelNum === 1 ? 'spark' : levelNum === 3 ? 'inferno' : 'magic';

    logger.info('');
  }

  // ── Step 2: Detect project type ───────────────────────────────────────────
  const projectType = await detectProjectType(cwd);
  logger.info(`Detected project type: ${projectType}`);

  // ── Step 3: Check if .danteforge/ already exists ──────────────────────────
  const stateDir = path.join(cwd, '.danteforge');
  let isExisting = false;
  try {
    await fs.access(stateDir);
    isExisting = true;
    logger.warn('.danteforge/ already exists — refreshing configuration.');
  } catch {
    logger.info('No existing DanteForge project — starting fresh.');
  }

  // ── Step 4: Health checks ─────────────────────────────────────────────────
  logger.info('');
  logger.info('Health checks:');

  const checks: { name: string; ok: boolean; message: string }[] = [];

  const major = parseInt(process.version.slice(1), 10);
  checks.push({
    name: 'Node.js',
    ok: major >= 18,
    message: major >= 18
      ? `${process.version} (compatible)`
      : `${process.version} — requires Node 18+`,
  });

  try {
    const config = await loadConfig();
    const hasKey = Object.values(config.providers).some((p) => p?.apiKey);
    checks.push({
      name: 'API key',
      ok: hasKey,
      message: hasKey
        ? `Provider: ${config.defaultProvider} (key configured)`
        : 'No API key — run "danteforge config --set-key" to add one.',
    });
  } catch {
    checks.push({ name: 'API key', ok: false, message: 'No config found — local-only mode.' });
  }

  const llmReady = await llmAvailableFn();
  checks.push({
    name: 'LLM provider',
    ok: llmReady,
    message: llmReady
      ? 'Live LLM provider available.'
      : 'No live LLM — use --prompt mode for offline operation.',
  });

  for (const check of checks) {
    logger[check.ok ? 'success' : 'warn'](`  ${check.ok ? '[OK]  ' : '[WARN]'} ${check.name}: ${check.message}`);
  }

  // ── Step 5: Save state ────────────────────────────────────────────────────
  const state = await loadStateFn({ cwd });
  state.projectType = projectType;
  if (projectDescription) state.constitution = projectDescription;
  state.preferredLevel = preferredLevel;
  state.auditLog.push(
    `${timestamp} | init: type=${projectType}, level=${preferredLevel}, existing=${isExisting}`,
  );
  await saveStateFn(state, { cwd });

  // ── Step 6: Personalized guidance ─────────────────────────────────────────
  logger.info('');
  logger.success('Setup complete!');
  logger.info('');

  if (isInteractive && experienceLevel === 1) {
    // New user — hand-hold
    logger.info('Since you\'re new, here\'s the recommended path:');
    logger.info('');
    logger.info(`  1. danteforge ${preferredLevel} "${projectDescription || 'your idea here'}"`);
    logger.info('     ↑ This single command runs the full pipeline.');
    logger.info('');
    logger.info('  Or step-by-step to learn how it works:');
    logger.info('    danteforge spark "your idea"  — planning only, zero tokens');
    logger.info('    danteforge help               — context-aware guidance');
    logger.info('');
    logger.info('  → Tip: run "danteforge define-done" to set your quality target.');
  } else if (isInteractive && experienceLevel === 3) {
    // Power user — show the power commands
    logger.info('Power user commands:');
    logger.info(`  danteforge ${preferredLevel} "goal"   — run at preferred level`);
    logger.info('  danteforge assess                — score vs competitive universe');
    logger.info('  danteforge self-improve          — autonomous quality loop');
    logger.info('  danteforge universe              — view feature universe');
    logger.info('  danteforge define-done           — set completion target');
  } else {
    // Default guidance
    if (llmReady) {
      logger.info('  Quick start:  danteforge magic "Your idea here"');
    }
    logger.info('  Step-by-step: danteforge spark "Your idea here"');
    logger.info('  Help:         danteforge help');
  }

  logger.info('');
  logger.info('Run "danteforge doctor" for full system diagnostics.');
}

// ── readline helper (same pattern as completion-target.ts) ────────────────────

function askQuestion(
  prompt: string,
  mockReadline?: InitOptions['_readline'],
): Promise<string> {
  if (mockReadline) {
    return new Promise<string>((resolve) => {
      mockReadline.question(prompt, (answer) => resolve(answer));
    });
  }
  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
  });
}
