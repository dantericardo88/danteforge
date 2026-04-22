// quickstart — guided 5-minute path: init → constitution → spark → PDSE score
import path from 'node:path';
import readline from 'node:readline';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { createStepTracker } from '../../core/progress.js';
import type { InitOptions } from './init.js';
import type { DanteState } from '../../core/state.js';

export const SIMPLE_CONSTITUTION_TEMPLATE = (projectName: string): string =>
  `# Project Constitution — ${projectName}

## Core Principles
- Write tests for all new code before implementing
- Handle errors explicitly — no silent failures
- Keep functions small and focused on one responsibility
- Document public APIs with comments
- Review code before committing

## Quality Standards
- Minimum test coverage: 80%
- No console.log in production code
- All functions must have explicit return types

## Development Workflow
- Use feature branches for all changes
- Run tests before committing
- Keep commits small and focused
`;

export interface QuickstartReadlineLike {
  question(prompt: string, cb: (answer: string) => void): void;
  close?(): void;
}

export interface QuickstartOptions {
  idea?: string;
  nonInteractive?: boolean;
  simple?: boolean;
  projectName?: string;
  cwd?: string;
  _isTTY?: boolean;
  _readline?: QuickstartReadlineLike;
  _runInit?: (opts: InitOptions) => Promise<void>;
  _runConstitution?: () => Promise<void>;
  _runSpark?: (goal: string) => Promise<void>;
  _isLLMAvailable?: () => Promise<boolean>;
  _readFile?: (p: string) => Promise<string>;
  _scoreArtifacts?: (cwd: string, state: DanteState) => Promise<number>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _stdout?: (line: string) => void;
}

export async function quickstart(options: QuickstartOptions = {}): Promise<void> {
  return withErrorBoundary('quickstart', async () => {
    const cwd = options.cwd ?? process.cwd();

    // ── Simple mode: 0 LLM calls, template-based, <90 seconds ───────────────
    if (options.simple) {
      const print = options._stdout ?? ((line: string) => logger.info(line));
      const projectName = options.projectName ?? options.idea ?? 'My Project';
      const constitutionContent = SIMPLE_CONSTITUTION_TEMPLATE(projectName);
      const constitutionPath = path.join(cwd, '.danteforge', 'CONSTITUTION.md');

      // Write constitution
      const writeFile = options._writeFile ?? (async (p: string, content: string) => {
        const { mkdir, writeFile: fsWrite } = await import('fs/promises');
        await mkdir(path.dirname(p), { recursive: true });
        await fsWrite(p, content, 'utf-8');
      });
      try {
        await writeFile(constitutionPath, constitutionContent);
        print('Constitution written to .danteforge/CONSTITUTION.md');
      } catch {
        print('Could not write constitution — continuing...');
      }

      // Score artifacts
      let score = 0;
      try {
        if (options._scoreArtifacts) {
          const { loadState } = await import('../../core/state.js');
          const state = await loadState({ cwd });
          score = await options._scoreArtifacts(cwd, state);
        } else {
          const { scoreAllArtifacts } = await import('../../core/pdse.js');
          const { loadState } = await import('../../core/state.js');
          const state = await loadState({ cwd });
          const scores = await scoreAllArtifacts(cwd, state);
          score = typeof scores === 'number' ? scores : (scores as { avgScore?: number }).avgScore ?? 0;
        }
        print(`Quality Score: ${score}/100`);
      } catch {
        print('Quality Score: — (no artifacts yet)');
      }

      print('');
      print('Next steps:');
      print('  danteforge specify');
      print('  danteforge autoforge');
      print('  danteforge verify');
      return;
    }

    const isInteractive = (options._isTTY ?? process.stdout.isTTY) && !options.nonInteractive;
    const tracker = createStepTracker(4, { _isTTY: options._isTTY ?? process.stdout.isTTY });

    logger.success('DanteForge Quickstart — Guided 5-Minute Setup');
    logger.info('');

    // Capture idea upfront
    let idea = options.idea ?? '';
    if (!idea && isInteractive) {
      idea = await askQuestion(
        '  What are you building? (idea for your first spark): ',
        options._readline,
      );
      idea = idea.trim();
    }

    // ── [1/4] Init ────────────────────────────────────────────────────────────
    tracker.step('Setting up project...');
    const runInit = options._runInit ?? (async (opts: InitOptions) => {
      const { init } = await import('./init.js');
      await init(opts);
    });
    try {
      // Adapt QuickstartReadlineLike → InitOptions _readline (which needs close())
      const initReadline = options._readline
        ? { question: options._readline.question.bind(options._readline), close: () => {} }
        : undefined;
      await runInit({
        nonInteractive: options.nonInteractive,
        cwd,
        _isTTY: options._isTTY,
        _readline: initReadline,
        _isLLMAvailable: options._isLLMAvailable,
      });
    } catch (err) {
      logger.warn('Init step had issues — continuing...');
    }

    // ── [2/4] Constitution ────────────────────────────────────────────────────
    tracker.step(options.simple ? 'Defining your project rules...' : 'Defining project constitution...');
    const runConstitution = options._runConstitution ?? (async () => {
      const { constitution } = await import('./constitution.js');
      await constitution();
    });
    try {
      await runConstitution();
    } catch (err) {
      logger.warn('Constitution step had issues — continuing...');
    }

    // ── [3/4] Spark ───────────────────────────────────────────────────────────
    if (idea) {
      tracker.step(options.simple ? `Running quick plan: "${idea}"...` : `Running spark: "${idea}"...`);
      const runSpark = options._runSpark ?? (async (goal: string) => {
        const { magic } = await import('./magic.js');
        await magic(goal, { level: 'spark' });
      });
      try {
        await runSpark(idea);
      } catch (err) {
        logger.warn('Spark step had issues — your planning artifacts may be partial.');
      }
    } else {
      tracker.step('Skipping spark (no idea provided)');
      logger.info('  Tip: run "danteforge spark \\"your idea\\"" to generate planning artifacts.');
    }

    // ── [4/4] Show PDSE score ─────────────────────────────────────────────────
    tracker.step(options.simple ? 'Reading quality score...' : 'Reading PDSE score...');
    try {
      const readFile = options._readFile ?? (async (p: string) => {
        const { readFile: fsRead } = await import('fs/promises');
        return fsRead(p, 'utf8');
      });
      const snapshotPath = path.join(cwd, '.danteforge', 'latest-pdse.json');
      const raw = await readFile(snapshotPath);
      const snapshot = JSON.parse(raw) as { avgScore: number };
      logger.success(options.simple ? `Quality Score: ${snapshot.avgScore}/100` : `PDSE Score: ${snapshot.avgScore}/100`);
    } catch {
      logger.info(
        options.simple
          ? '  No quality snapshot yet — run "danteforge autoforge --score-only to score your work".'
          : '  No PDSE snapshot yet — run "danteforge autoforge --score-only" to score your artifacts.',
      );
    }

    logger.info('');
    logger.success('Quickstart complete!');
    logger.info('');
    logger.info('Next steps:');
    if (idea) {
      logger.info(`  danteforge magic "${idea}"    — full pipeline with LLM`);
    }
    logger.info(
      options.simple
        ? '  danteforge verify              — check your work quality'
        : '  danteforge verify              — check artifact quality',
    );
    logger.info('  danteforge doctor              — full diagnostics');
  });
}

function askQuestion(
  prompt: string,
  mockReadline?: QuickstartReadlineLike,
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
