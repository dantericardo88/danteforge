// go-wizard.ts — 5-question onboarding wizard for new DanteForge projects.
// Reused by both `danteforge go` (first-run path) and `danteforge init --guided`.
// Non-TTY: skips wizard, prints setup instruction.

import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LLMProvider = 'ollama' | 'claude' | 'openai' | 'grok';
export type ProjectType = 'CLI' | 'API' | 'Web' | 'Library' | 'Agent';
export type QualityTarget = 8.0 | 8.5 | 9.0;

export interface WizardAnswers {
  description: string;
  projectType: ProjectType;
  competitors: string[];
  provider: LLMProvider;
  qualityTarget: QualityTarget;
}

export interface GoWizardOptions {
  /** Whether we're running in an interactive terminal (default: process.stdout.isTTY) */
  _isTTY?: boolean;
  /** Inject a readline question function for testing */
  _askQuestion?: (question: string) => Promise<string>;
  /** Inject a stdout emitter for testing */
  _stdout?: (line: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseProjectType(input: string): ProjectType {
  const trimmed = input.trim().toUpperCase();
  const map: Record<string, ProjectType> = {
    '1': 'CLI', 'CLI': 'CLI',
    '2': 'API', 'API': 'API',
    '3': 'Web', 'WEB': 'Web',
    '4': 'Library', 'LIB': 'Library', 'LIBRARY': 'Library',
    '5': 'Agent', 'AGENT': 'Agent',
  };
  return map[trimmed] ?? 'CLI';
}

function parseQualityTarget(input: string): QualityTarget {
  const trimmed = input.trim();
  if (trimmed === '2' || trimmed === '8.5') return 8.5;
  if (trimmed === '3' || trimmed === '9.0' || trimmed === '9') return 9.0;
  return 8.0;
}

function parseProvider(input: string): LLMProvider {
  const trimmed = input.trim().toLowerCase();
  const map: Record<string, LLMProvider> = {
    '1': 'ollama', 'ollama': 'ollama',
    '2': 'claude', 'claude': 'claude',
    '3': 'openai', 'openai': 'openai',
    '4': 'grok', 'grok': 'grok',
  };
  return map[trimmed] ?? 'ollama';
}

async function defaultAskQuestion(question: string): Promise<string> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Main wizard ───────────────────────────────────────────────────────────────

/**
 * Run the 5-question onboarding wizard. Returns answers or null if non-TTY.
 * Non-TTY: emits a helpful message and returns null without blocking.
 */
export async function runGoWizard(options: GoWizardOptions = {}): Promise<WizardAnswers | null> {
  const isTTY = options._isTTY ?? (process.stdout.isTTY === true);
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const ask = options._askQuestion ?? defaultAskQuestion;

  if (!isTTY) {
    emit('');
    emit('  Non-interactive environment detected.');
    emit('  Run `danteforge init --guided` in a terminal for the interactive setup wizard.');
    emit('');
    return null;
  }

  emit('');
  emit('  DanteForge — New Project Setup (2 min)');
  emit('  ─────────────────────────────────────────────────');
  emit('');

  // Q1: What does this project do?
  emit('  1/5  What does this project do?');
  const description = await ask('       > ');

  // Q2: Project type
  emit('');
  emit('  2/5  Project type:');
  emit('       1. CLI      2. API      3. Web      4. Library      5. Agent');
  const typeRaw = await ask('       > [1] ');
  const projectType = parseProjectType(typeRaw || '1');

  // Q3: Competitors
  emit('');
  emit('  3/5  Main competitors? (comma-separated, e.g. "aider, gpt-engineer")');
  const competitorsRaw = await ask('       > ');
  const competitors = competitorsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Q4: LLM provider
  emit('');
  emit('  4/5  LLM provider:');
  emit('       1. ollama (local)   2. claude   3. openai   4. grok');
  const providerRaw = await ask('       > [1] ');
  const provider = parseProvider(providerRaw || '1');

  // Q5: Quality target
  emit('');
  emit('  5/5  Quality target:');
  emit('       1. 8.0 (good)   2. 8.5 (great)   3. 9.0 (best-in-class)');
  const targetRaw = await ask('       > [3] ');
  const qualityTarget = parseQualityTarget(targetRaw || '3');

  emit('');
  emit('  ─────────────────────────────────────────────────');
  emit('');

  logger.success('Setup complete. Running your first quality score…');

  return { description, projectType, competitors, provider, qualityTarget };
}
