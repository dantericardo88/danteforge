// Audit logger with log level control and spinner integration.
// When a spinner is active (via progress.ts), info/success/warn messages
// update the spinner text instead of printing new lines.
import chalk from 'chalk';
import { getActiveSpinner } from './progress.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

const SECRET_PATTERNS: RegExp[] = [];

export function registerSecretPattern(pattern: RegExp): void {
  SECRET_PATTERNS.push(pattern);
}

export function maskSecrets(input: string): string {
  if (SECRET_PATTERNS.length === 0) return input;
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  verbose: 4,
};

let currentLevel: LogLevel = 'info';
let useStderr = false;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

function logOrSpin(formatted: string, plainText: string, level: LogLevel): void {
  if (!shouldLog(level)) return;
  const spinner = getActiveSpinner();
  if (spinner && level !== 'error') {
    // Update spinner text so it reflects latest activity without adding new lines
    spinner.update(plainText);
  } else {
    if (level === 'error' || useStderr) {
      process.stderr.write(formatted + '\n');
    } else {
      process.stdout.write(formatted + '\n');
    }
  }
}

export const logger = {
  setLevel(level: LogLevel) { currentLevel = level; },
  getLevel(): LogLevel { return currentLevel; },
  setStderr(flag: boolean) { useStderr = flag; },
  verbose: (msg: string) => {
    const safe = maskSecrets(msg);
    if (shouldLog('verbose')) console.log(chalk.gray(`[DBG] ${safe}`));
  },
  info: (msg: string) => { const safe = maskSecrets(msg); logOrSpin(chalk.blue(`[INFO] ${safe}`), safe, 'info'); },
  success: (msg: string) => { const safe = maskSecrets(msg); logOrSpin(chalk.green(`[OK] ${safe}`), safe, 'info'); },
  warn: (msg: string) => { const safe = maskSecrets(msg); logOrSpin(chalk.yellow(`[WARN] ${safe}`), safe, 'warn'); },
  error: (msg: string) => { if (shouldLog('error')) console.error(chalk.red(`[ERR] ${maskSecrets(msg)}`)); },
  errorWithRemedy: (msg: string, remedy?: string) => {
    if (shouldLog('error')) {
      console.error(chalk.red(`[ERR] ${maskSecrets(msg)}`));
      if (remedy) console.error(chalk.yellow(`      Remedy: ${maskSecrets(remedy)}`));
    }
  },
};
