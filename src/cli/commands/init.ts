// init - interactive first-run wizard for new DanteForge projects
// Keeps default setup minimal, with advanced options behind --advanced.
import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { detectProjectType } from '../../core/completion-tracker.js';
import { isLLMAvailable } from '../../core/llm.js';
import { loadConfig, saveConfig, setDefaultProvider, type LLMProvider, type DanteConfig } from '../../core/config.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { AssistantRegistry } from '../../core/assistant-installer.js';

type BasicReadline = {
  question: (prompt: string, cb: (answer: string) => void) => void;
  close: () => void;
};

export interface InitOptions {
  prompt?: boolean;
  nonInteractive?: boolean;
  guided?: boolean;
  advanced?: boolean;
  provider?: LLMProvider;
  projectDescription?: string;
  preferredLevel?: string;
  preferLive?: boolean;
  cwd?: string;
  _isTTY?: boolean;
  _readline?: BasicReadline;
  _isLLMAvailable?: () => Promise<boolean>;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _detectIDE?: () => AssistantRegistry | null;
  _loadConfig?: () => Promise<DanteConfig>;
  _saveConfig?: (config: DanteConfig) => Promise<void>;
  _defineUniverse?: (opts: { cwd: string; interactive: boolean }) => Promise<unknown>;
}

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

function askQuestion(prompt: string, mockReadline?: BasicReadline): Promise<string> {
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

function parsePreferredLevel(choice: string): 'spark' | 'magic' | 'inferno' {
  const levelNum = parseInt(choice.trim() || '2', 10);
  return levelNum === 1 ? 'spark' : levelNum === 3 ? 'inferno' : 'magic';
}

function shouldPreferLive(choice: string): boolean {
  const modeNum = parseInt(choice.trim() || '1', 10);
  return modeNum === 2;
}

export async function init(options: InitOptions = {}): Promise<void> {
  return withErrorBoundary('init', async () => {
    const cwd = options.cwd ?? process.cwd();
    const timestamp = new Date().toISOString();
    const isInteractive = ((options._isTTY ?? process.stdout.isTTY) || options.guided === true) && !options.nonInteractive;
    const loadStateFn = options._loadState ?? loadState;
    const saveStateFn = options._saveState ?? saveState;
    const llmAvailableFn = options._isLLMAvailable ?? isLLMAvailable;

    logger.success('DanteForge Init - Project Setup Wizard');
    logger.info('');

    let projectDescription = options.projectDescription ?? '';
    let preferredLevel: string = options.preferredLevel ?? 'magic';
    let preferLive = options.preferLive ?? false;

    if (isInteractive) {
      logger.info('Welcome to DanteForge! Three quick questions to personalize your setup.');
      logger.info('');

      projectDescription = await askQuestion(
        '  What are you building? (brief description, Enter to skip)\n  > ',
        options._readline,
      );

      logger.info('');
      logger.info('  How do you want to work?');
      logger.info('    1. Plan first            - light start, no AI required');
      logger.info('    2. Improve one thing     - recommended for most work');
      logger.info('    3. Full autonomous push  - deepest automation');
      preferredLevel = parsePreferredLevel(
        await askQuestion('  Enter choice [2]: ', options._readline),
      );

      logger.info('');
      logger.info('  How do you want to start?');
      logger.info('    1. Offline first        - score and plan with no API key');
      logger.info('    2. Live AI is ready     - I already configured a provider');
      logger.info('    3. Set up AI later      - show me the command after setup');
      preferLive = shouldPreferLive(
        await askQuestion('  Enter choice [1]: ', options._readline),
      );

      if (options.advanced) {
        if (!options.provider) {
          logger.info('');
          logger.info('  Which LLM provider do you want to configure?');
          logger.info('    1. Ollama (local, free)');
          logger.info('    2. Claude (Anthropic)');
          logger.info('    3. OpenAI (GPT-4o)');
          logger.info('    4. Grok (xAI)');
          logger.info('    5. Gemini (Google)');
          const provChoice = await askQuestion('  Enter choice [1]: ', options._readline);
          const provNum = parseInt(provChoice.trim() || '1', 10);
          const provMap: Record<number, LLMProvider> = {
            1: 'ollama',
            2: 'claude',
            3: 'openai',
            4: 'grok',
            5: 'gemini',
          };
          const selectedProvider = provMap[provNum] ?? 'ollama';
          try {
            await setDefaultProvider(selectedProvider);
          } catch {
            // best effort
          }
        }

        const detectedIDE = options._detectIDE ? options._detectIDE() : detectRunningIDE();
        if (detectedIDE && detectedIDE !== 'claude') {
          logger.info('');
          logger.info(`Detected editor: ${detectedIDE}`);
          const ideChoice = await askQuestion(
            `  Set up DanteForge skills for ${detectedIDE}? [Y/n] `,
            options._readline,
          );
          if (ideChoice.trim().toLowerCase() !== 'n') {
            try {
              const { setupAssistants } = await import('./setup-assistants.js');
              await setupAssistants({ assistants: detectedIDE });
              logger.success(`Skills installed for ${detectedIDE}`);
            } catch {
              // best effort
            }
          }
        }

        logger.info('');
        logger.info('  Adversarial scoring runs a second LLM to challenge your self-score,');
        logger.info('  catching inflation automatically. Recommended for honest quality tracking.');
        const advAnswer = await askQuestion('  Enable adversarial scoring? [Y/n] ', options._readline);
        if (advAnswer.trim().toLowerCase() !== 'n') {
          try {
            const loadConfigFn = options._loadConfig ?? loadConfig;
            const saveConfigFn = options._saveConfig ?? saveConfig;
            const cfg = await loadConfigFn();
            cfg.adversary = { enabled: true };
            await saveConfigFn(cfg);
            logger.success('  Adversarial scoring enabled. Run `danteforge score --adversary` to try it.');
          } catch {
            // best effort
          }
        }

        logger.info('');
        const defineNow = await askQuestion(
          '  Define your competitive universe now? (helps ascend/compete target the right goals) [y/N] ',
          options._readline,
        );
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
      } else {
        logger.info('');
        logger.info('  Tip: run `danteforge init --advanced` to configure editor setup,');
        logger.info('  provider defaults, adversarial scoring, and competitive targeting.');
      }
    }

    const projectType = await detectProjectType(cwd);
    logger.info(`Detected project type: ${projectType}`);

    const stateDir = path.join(cwd, '.danteforge');
    let isExisting = false;
    try {
      await fs.access(stateDir);
      isExisting = true;
      logger.warn('.danteforge/ already exists - refreshing configuration.');
    } catch {
      logger.info('No existing DanteForge project - starting fresh.');
    }

    logger.info('');
    logger.info('Health checks:');

    const checks: { name: string; ok: boolean; message: string }[] = [];
    let hasConfiguredKey = false;

    const major = parseInt(process.version.slice(1), 10);
    checks.push({
      name: 'Node.js',
      ok: major >= 18,
      message: major >= 18 ? `${process.version} (compatible)` : `${process.version} - requires Node 18+`,
    });

    try {
      const config = await loadConfig();
      hasConfiguredKey = Object.values(config.providers).some((p) => p?.apiKey);
      checks.push({
        name: 'API key',
        ok: hasConfiguredKey,
        message: hasConfiguredKey
          ? `Provider: ${config.defaultProvider} (key configured)`
          : 'No API key - run "danteforge config --set-key" to add one.',
      });
    } catch {
      checks.push({ name: 'API key', ok: false, message: 'No config found - local-only mode.' });
    }

    const llmReady = await llmAvailableFn();
    checks.push({
      name: 'LLM provider',
      ok: llmReady,
      message: llmReady
        ? 'Live LLM provider available.'
        : 'No live LLM - use offline scoring/planning until you add one.',
    });

    for (const check of checks) {
      logger[check.ok ? 'success' : 'warn'](`  ${check.ok ? '[OK]  ' : '[WARN]'} ${check.name}: ${check.message}`);
    }

    const state = await loadStateFn({ cwd });
    state.projectType = projectType;
    if (projectDescription) state.constitution = projectDescription;
    state.preferredLevel = preferredLevel;
    state.auditLog.push(`${timestamp} | init: type=${projectType}, level=${preferredLevel}, existing=${isExisting}`);
    await saveStateFn(state, { cwd });

    const idea = projectDescription || 'your idea here';
    logger.info('');
    logger.success('Setup complete!');
    logger.info('');
    logger.info('Your next command:');
    logger.info('');
    logger.info('  danteforge go');
    logger.info('  Shows your score, your top gap, and one recommended next step.');
    logger.info('');
    logger.info('Plain-English shortcuts:');
    logger.info('  danteforge start');
    logger.info('  danteforge measure');
    logger.info('  danteforge improve "your goal"');
    logger.info('');
    if (!preferLive || !hasConfiguredKey) {
      logger.info('  To add a provider: danteforge config --set-key "openai:<key>"');
      logger.info('');
    }
    logger.info('Or jump straight in:');
    logger.info(`  danteforge ${preferredLevel} "${idea}"`);
    logger.info('');
    logger.info('  Help: danteforge help');
    logger.info('');
    logger.info('Run "danteforge doctor" for full system diagnostics.');
  });
}
