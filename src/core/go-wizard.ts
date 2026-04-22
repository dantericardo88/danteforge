// go-wizard.ts - lightweight onboarding wizard for new DanteForge projects.
// Reused by both `danteforge go` (first-run path) and `danteforge init --guided`.

export type LLMProvider = 'ollama' | 'claude' | 'openai' | 'grok';
export type ProjectType = 'CLI';
export type QualityTarget = 9.0;
export type StartMode = 'offline' | 'live' | 'later';
export type PreferredLevel = 'spark' | 'magic' | 'inferno';

export interface WizardAnswers {
  description: string;
  projectType: ProjectType;
  competitors: string[];
  provider: LLMProvider;
  qualityTarget: QualityTarget;
  startMode: StartMode;
  preferredLevel: PreferredLevel;
}

export interface GoWizardOptions {
  _isTTY?: boolean;
  _askQuestion?: (question: string) => Promise<string>;
  _stdout?: (line: string) => void;
}

function parsePreferredLevel(input: string): PreferredLevel {
  const trimmed = input.trim();
  if (trimmed === '1') return 'spark';
  if (trimmed === '3') return 'inferno';
  return 'magic';
}

function parseStartMode(input: string): StartMode {
  const trimmed = input.trim();
  if (trimmed === '2') return 'live';
  if (trimmed === '3') return 'later';
  return 'offline';
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
  emit('  DanteForge - New Project Setup (under 2 min)');
  emit('  -------------------------------------------------');
  emit('');

  emit('  1/3  What does this project do?');
  const description = await ask('       > ');

  emit('');
  emit('  2/3  How do you want to work?');
  emit('       1. Plan first            2. Improve one thing            3. Full autonomous push');
  const preferredLevel = parsePreferredLevel(await ask('       > [2] '));

  emit('');
  emit('  3/3  How do you want to start?');
  emit('       1. Offline first         2. Live AI is ready            3. Set up AI later');
  const startMode = parseStartMode(await ask('       > [1] '));

  emit('');
  emit('  -------------------------------------------------');
  emit('');
  emit('  Thanks - saving setup and running your first score.');

  return {
    description,
    projectType: 'CLI',
    competitors: [],
    provider: 'ollama',
    qualityTarget: 9.0,
    startMode,
    preferredLevel,
  };
}
