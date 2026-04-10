// init — interactive first-run wizard for new DanteForge projects
// Asks 3 questions to personalize next steps, then runs health checks.
import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { detectProjectType } from '../../core/completion-tracker.js';
import { isLLMAvailable } from '../../core/llm.js';
import { loadConfig, setDefaultProvider, type LLMProvider } from '../../core/config.js';
import { selectProvider } from '../../core/prompts.js';
import {
  getOrPromptCompletionTarget,
  type CompletionTarget,
  type CompletionTargetOptions,
} from '../../core/completion-target.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { ConstitutionOptions } from './constitution.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InitOptions {
  prompt?: boolean;
  nonInteractive?: boolean;
  simple?: boolean;
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
  // Chained step injections
  _setupAssistants?: () => Promise<void>;
  _constitution?: (opts: ConstitutionOptions) => Promise<void>;
  _configSetKey?: (provider: LLMProvider, key: string) => Promise<void>;
  // Simple-mode injection seams
  _stdout?: (line: string) => void;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdirp?: (p: string) => Promise<void>;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<void> {
  return withErrorBoundary('init', async () => {
  const cwd = options.cwd ?? process.cwd();
  const timestamp = new Date().toISOString();
  const isInteractive = (options._isTTY ?? process.stdout.isTTY) && !options.nonInteractive;
  const loadStateFn = options._loadState ?? loadState;
  const saveStateFn = options._saveState ?? saveState;
  const llmAvailableFn = options._isLLMAvailable ?? isLLMAvailable;

  logger.success('DanteForge Init — Project Setup Wizard');
  if (options.simple) {
    logger.info('Run \'danteforge explain\' to see the full glossary of DanteForge terms.');
  }
  logger.info('');

  // ── Simple mode: 2 prompts max, no LLM, sensible defaults ───────────────
  if (options.simple) {
    const print = options._stdout ?? ((line: string) => logger.info(line));
    let projectName = '';
    let projectDescription = '';

    if (isInteractive) {
      projectName = await askQuestion(
        '  Project name (Enter to use "My Project"): ',
        options._readline,
      );
      projectName = projectName.trim() || 'My Project';

      projectDescription = await askQuestion(
        '  One-sentence description (Enter to skip): ',
        options._readline,
      );
      projectDescription = projectDescription.trim();
    } else {
      projectName = 'My Project';
    }

    // Write STATE.yaml with sensible defaults
    const stateDir = path.join(cwd, '.danteforge');
    const statePath = path.join(stateDir, 'STATE.yaml');
    const stateContent = [
      `project: "${projectName}"`,
      `description: "${projectDescription}"`,
      `workflowStage: initialized`,
      `currentPhase: 0`,
      `tasks: {}`,
      `profile: default`,
      `automationLevel: guided`,
      `completionTarget: 70`,
      `auditLog: []`,
    ].join('\n') + '\n';

    try {
      const mkdirp = options._mkdirp ?? (async (p: string) => fs.mkdir(p, { recursive: true }));
      const writeFile = options._writeFile ?? (async (p: string, c: string) => fs.writeFile(p, c, 'utf-8'));
      await mkdirp(stateDir);
      await writeFile(statePath, stateContent);
      print(`Project "${projectName}" initialized.`);
    } catch {
      print('Could not write state — continuing...');
    }

    print('');
    print('Run "danteforge quickstart --simple" for the guided setup path.');
    return;
  }

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
    if (options.simple) {
      logger.info('  (Hint: "spark" = planning only, "magic" = recommended everyday use, "inferno" = maximum quality push)');
    }

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

    logger.info('');
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
      if (options.simple) {
        logger.info('  (This sets your quality bar for when the project is "done")');
      }
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

  // ── Step 6b: Chained optional setup steps ────────────────────────────────
  if (isInteractive) {
    // LLM key setup if no LLM available
    if (!llmReady) {
      const setupKey = await askQuestion(
        '  No LLM configured. Set up an API key now? [Y/n]: ',
        options._readline,
      );
      if (!setupKey.trim() || setupKey.trim().toLowerCase().startsWith('y')) {
        if (options._configSetKey) {
          try { await options._configSetKey('claude', ''); } catch { /* best-effort */ }
        } else {
          logger.info('  Run: danteforge config --set-key <provider:key>');
        }
      }
    }

    // Assistant integration
    const setupAssistants = await askQuestion(
      '  Set up Claude Code / Cursor integration? [Y/n]: ',
      options._readline,
    );
    if (!setupAssistants.trim() || setupAssistants.trim().toLowerCase().startsWith('y')) {
      if (options._setupAssistants) {
        try { await options._setupAssistants(); } catch { /* best-effort */ }
      } else {
        try {
          const { setupAssistants } = await import('./setup-assistants.js');
          await setupAssistants({});
        } catch { /* best-effort */ }
      }
    }

    // Constitution setup
    const setupConstitution = await askQuestion(
      '  Define your project constitution now? [Y/n]: ',
      options._readline,
    );
    if (!setupConstitution.trim() || setupConstitution.trim().toLowerCase().startsWith('y')) {
      const constitutionFn = options._constitution
        ?? (async (opts: ConstitutionOptions) => {
          const { constitution } = await import('./constitution.js');
          await constitution(opts);
        });
      try {
        await constitutionFn({ _readline: options._readline, cwd });
      } catch { /* best-effort */ }
    }
  }

  logger.info('');
  logger.info('Run "danteforge doctor" for full system diagnostics.');
  logger.info('Run "danteforge quickstart" for the guided 5-minute path.');
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
