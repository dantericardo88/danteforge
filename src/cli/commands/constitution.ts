// Constitution command — establish project principles and constraints
import readline from 'node:readline';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { handoff } from '../../core/handoff.js';
import { writeArtifact } from '../../core/local-artifacts.js';

export interface ConstitutionReadlineLike {
  question(prompt: string, cb: (answer: string) => void): void;
}

export interface ConstitutionOptions {
  nonInteractive?: boolean;
  principles?: string[];   // injection for non-interactive / test paths
  cwd?: string;
  _isTTY?: boolean;
  _readline?: ConstitutionReadlineLike;
  _writeArtifact?: (name: string, content: string, cwd?: string) => Promise<string>;
  _handoff?: typeof handoff;
}

const DEFAULT_PRINCIPLES = [
  'Always prioritize zero ambiguity',
  'Local-first & PIPEDA compliant',
  'Atomic commits only',
  'Always verify before commit',
  'Scale-adaptive: solo -> party mode automatically',
];

export async function constitution(options: ConstitutionOptions = {}): Promise<void> {
  return withErrorBoundary('constitution', async () => {
    const isInteractive = (options._isTTY ?? process.stdout.isTTY) && !options.nonInteractive;
    const writeArtifactFn = options._writeArtifact ?? writeArtifact;
    const handoffFn = options._handoff ?? handoff;

    logger.success('Creating DanteForge project constitution...');

    let principles: string[];

    if (options.principles) {
      // Injected directly (tests, non-interactive callers)
      principles = options.principles;
    } else if (isInteractive) {
      // Prompt for 3 custom principles with defaults
      logger.info('');
      logger.info('Define up to 3 project principles (press Enter to keep default):');
      logger.info('');
      principles = [];
      for (let i = 0; i < 3; i++) {
        const def = DEFAULT_PRINCIPLES[i] ?? '';
        const answer = await askQuestion(
          `  Principle ${i + 1} [${def}]: `,
          options._readline,
        );
        principles.push(answer.trim() || def);
      }
      // Append remaining defaults
      for (let i = 3; i < DEFAULT_PRINCIPLES.length; i++) {
        principles.push(DEFAULT_PRINCIPLES[i]);
      }
    } else {
      // Non-interactive: use defaults
      principles = [...DEFAULT_PRINCIPLES];
    }

    const constitutionText = [
      '# DanteForge Constitution',
      ...principles.map((p) => `- ${p}`),
    ].join('\n');

    await writeArtifactFn('CONSTITUTION.md', constitutionText, options.cwd);
    await handoffFn('constitution', { constitution: constitutionText });
    logger.success('Constitution ready – run "danteforge specify <idea>" next');
  });
}

function askQuestion(
  prompt: string,
  mockReadline?: ConstitutionReadlineLike,
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
