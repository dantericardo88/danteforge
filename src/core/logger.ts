// Audit logger with log level control and spinner integration.
// When a spinner is active (via progress.ts), info/success/warn messages
// update the spinner text instead of printing new lines.
import chalk from 'chalk';
import { getActiveSpinner } from './progress.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

const SECRET_PATTERNS: RegExp[] = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
];

export function registerSecretPattern(pattern: RegExp): void {
  SECRET_PATTERNS.push(pattern);
}

export function maskSecrets(input: string): string {
  try {
    if (SECRET_PATTERNS.length === 0) return input;
    let result = input;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  } catch (error) {
    // If masking fails, return original but log error
    console.error(`Secret masking failed: ${error}`);
    return input;
  }
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

/** Write to a stream, silently ignoring broken-pipe / closed-fd errors.
 *  Exported for direct testing without monkey-patching process streams. */
export function safeWrite(stream: { write(s: string): void }, text: string): void {
  try {
    stream.write(text);
  } catch (error) {
    // Silent failure for broken pipes - prevents crashes
    // This is important for UX as it prevents CLI crashes on pipe errors
  }
}

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
    if (level === 'error') {
      safeWrite(process.stderr, formatted + '\n');
    } else if (useStderr) {
      safeWrite(process.stderr, formatted + '\n');
    } else {
      safeWrite(process.stdout, formatted + '\n');
    }
  }
}

export const logger = {
  setLevel(level: LogLevel) { currentLevel = level; },
  getLevel(): LogLevel { return currentLevel; },
  setStderr(value: boolean) { useStderr = value; },
  verbose: (msg: string) => {
    const safe = maskSecrets(msg);
    if (shouldLog('verbose')) {
      safeWrite(useStderr ? process.stderr : process.stdout, chalk.gray(`[DBG] ${safe}`) + '\n');
    }
  },
  info: (msg: string) => { const safe = maskSecrets(msg); logOrSpin(chalk.blue(`[INFO] ${safe}`), safe, 'info'); },
  success: (msg: string) => { const safe = maskSecrets(msg); logOrSpin(chalk.green(`[OK] ${safe}`), safe, 'info'); },
  warn: (msg: string) => { const safe = maskSecrets(msg); logOrSpin(chalk.yellow(`[WARN] ${safe}`), safe, 'warn'); },
  error: (msg: string) => { if (shouldLog('error')) safeWrite(process.stderr, chalk.red(`[ERR] ${maskSecrets(msg)}`) + '\n'); },
  errorWithRemedy: (msg: string, remedy?: string) => {
    if (shouldLog('error')) {
      safeWrite(process.stderr, chalk.red(`[ERR] ${maskSecrets(msg)}`) + '\n');
      if (remedy) safeWrite(process.stderr, chalk.yellow(`      Remedy: ${maskSecrets(remedy)}`) + '\n');
    }
  },
};
