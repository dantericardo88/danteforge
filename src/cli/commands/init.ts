// init — interactive first-run wizard for new DanteForge projects
// Asks 3 questions to personalize next steps, then runs health checks.
import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { detectProjectType } from '../../core/completion-tracker.js';
import { isLLMAvailable } from '../../core/llm.js';
import { loadConfig, saveConfig, setDefaultProvider, type LLMProvider, type DanteConfig } from '../../core/config.js';
import { selectProvider } from '../../core/prompts.js';
import {
  getOrPromptCompletionTarget,
  type CompletionTarget,
  type CompletionTargetOptions,
} from '../../core/completion-target.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { AssistantRegistry } from '../../core/assistant-installer.js';

// ── IDE Detection ────────────────────────────────────────────────────────────

/** Detects the running IDE/assistant from environment variables. Returns null if unknown. */
export function detectRunningIDE(): AssistantRegistry | null {
  const env = process.env;
  if (env['CLAUDE_CODE'] || env['CLAUDE_SESSION_ID']) return 'claude';
  if (env['CURSOR_TRACE_ID'] || env['CURSOR_CHANNEL']) return 'cursor';
  if (env['WINDSURF_EXTENSION'] || env['WINDSURF_AUTH_TOKEN']) return 'windsurf';
  if (env['CODEX_DEPLOYMENT_ID']) return 'codex';
  if (env['GITHUB_COPILOT_TOKEN']) return 'copilot';
  if (env['CONTINUE_EXTENSION_INSTALLED']) return 'continue';
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InitOptions {
  prompt?: boolean;
  nonInteractive?: boolean;
  /** Force the full interactive wizard even when TTY detection is uncertain */
  guided?: boolean;
  provider?: LLMProvider;
  cwd?: string;
  // Injection seams for testing
  _isTTY?: boolean;
  _readline?: CompletionTargetOptions['_readline'];
  _now?: () => string;
  _isLLMAvailable?: () => Promise<boolean>;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _getOrPromptTarget?: typeof getOrPromptCompletionTarget;
  /** Injection seam: override IDE detection for testing */
  _detectIDE?: () => AssistantRegistry | null;
  /** Injection seam: load config for adversary setup (for testing) */
  _loadConfig?: () => Promise<DanteConfig>;
  /** Injection seam: save config for adversary setup (for testing) */
  _saveConfig?: (config: DanteConfig) => Promise<void>;
  /** Injection seam: override defineUniverse for testing */
  _defineUniverse?: (opts: { cwd: string; interactive: boolean }) => Promise<unknown>;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<void> {
  return withErrorBoundary('init', async () => {
  const cwd = options.cwd ?? process.cwd();
  const timestamp = new Date().toISOString();
  const isInteractive = ((options._isTTY ?? process.stdout.isTTY) || options.guided === true) && !options.nonInteractive;
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

    // Provider selection — use @inquirer/prompts in production, readline seam in tests
    if (!options.provider) {
      let selectedProvider: LLMProvider;
      if (options._readline) {
        logger.info('  Which LLM provider do you want to use?');
        logger.info('    1. Ollama (local, free)');
        logger.info('    2. Claude (Anthropic)');
        logger.info('    3. OpenAI (GPT-4o)');
        logger.info('    4. Grok (xAI)');
        logger.info('    5. Gemini (Google)');
        const provChoice = await askQuestion('  Enter choice [1]: ', options._readline);
        const provNum = parseInt(provChoice.trim() || '1', 10);
        const provMap: Record<number, LLMProvider> = { 1: 'ollama', 2: 'claude', 3: 'openai', 4: 'grok', 5: 'gemini' };
        selectedProvider = provMap[provNum] ?? 'ollama';
      } else {
        selectedProvider = await selectProvider();
      }
      try { await setDefaultProvider(selectedProvider); } catch { /* best-effort */ }
    }

    // IDE detection — suggest setup assistants for non-Claude IDEs
    const detectedIDE = options._detectIDE ? options._detectIDE() : detectRunningIDE();
    if (detectedIDE && detectedIDE !== 'claude') {
      logger.info(`Detected editor: ${detectedIDE}`);
      const ideChoice = await askQuestion(
        `  Set up DanteForge skills for ${detectedIDE}? [Y/n] `,
        options._readline,
      );
      if (ideChoice.trim().toLowerCase() !== 'n') {
        try {
          const { setupAssistants } = await import('./setup-assistants.js');
          await setupAssistants({ assistants: detectedIDE });
          logger.success(`✓ Skills installed for ${detectedIDE}`);
        } catch { /* best-effort — don't break init if setup fails */ }
      }
    }

    // Q6 — Adversarial scoring setup
    logger.info('');
    logger.info('  Adversarial scoring runs a second LLM to challenge your self-score.');
    logger.info('  It catches inflation: the same LLM that builds code tends to be lenient');
    logger.info('  on its own work. A second opinion — especially a different model —');
    logger.info('  produces scores you can actually trust.');
    logger.info('  → Ollama (local, free) is detected and used automatically.');
    logger.info('  → The better the adversary, the more honest the score.');
    const advAnswer = await askQuestion('  Enable adversarial scoring? [Y/n] ', options._readline);
    if (advAnswer.trim().toLowerCase() !== 'n') {
      try {
        const loadConfigFn = options._loadConfig ?? loadConfig;
        const saveConfigFn = options._saveConfig ?? saveConfig;
        const cfg = await loadConfigFn();
        cfg.adversary = { enabled: true };
        await saveConfigFn(cfg);
        logger.success('  Adversarial scoring enabled. Run `danteforge score --adversary` to try it.');
      } catch { /* best-effort — don't break init if config save fails */ }
    }

    logger.info('');

    // Q7: Define competitive universe now?
    const defineNow = await askQuestion('Define your competitive universe now? (helps ascend/compete target the right goals) [y/N]: ', options._readline);
    if (defineNow.toLowerCase() === 'y' || defineNow.toLowerCase() === 'yes') {
      try {
        const { defineUniverse } = await import('../../core/universe-definer.js');
        const defineUniverseFn = options._defineUniverse ?? defineUniverse;
        await defineUniverseFn({ cwd, interactive: true });
        logger.success('Competitive universe defined! Run `danteforge ascend` to start improving.');
      } catch (err) {
        logger.warn(`Universe definition skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── Step 1b: Completion target (interactive only, skip if already set) ───────
  let completionTarget: CompletionTarget | undefined;
  if (isInteractive) {
    try {
      const getTargetFn = options._getOrPromptTarget ?? getOrPromptCompletionTarget;
      completionTarget = await getTargetFn(cwd, true, {
        _readFile: async (p) => fs.readFile(p, 'utf-8'),
        _writeFile: async (p, c) => {
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, c, 'utf-8');
        },
        _readline: options._readline,
        _now: options._now,
      });
      logger.success('Completion target saved.');
      logger.info('');
    } catch {
      // Completion target prompt failed — continue without it
    }
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
  if (completionTarget) {
    state.completionTarget = {
      mode: completionTarget.mode,
      minScore: completionTarget.minScore,
      featureCoverage: completionTarget.featureCoverage,
      definedAt: completionTarget.definedAt,
    };
  }
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
  });
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
