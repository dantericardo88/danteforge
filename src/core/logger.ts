// Audit logger with log level control and spinner integration.
// When a spinner is active (via progress.ts), info/success/warn messages
// update the spinner text instead of printing new lines.
import chalk from 'chalk';
import { getActiveSpinner } from './progress.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

const SECRET_PATTERNS: RegExp[] = [];

// Built-in API key patterns always applied (registered once at module load)
const BUILTIN_SECRET_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // OpenAI / Anthropic / generic sk- keys
  { re: /sk-[A-Za-z0-9]{20,}/g, replacement: 'sk-****' },
  // Bearer tokens in Authorization headers
  { re: /Bearer [A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer ****' },
  // key= or key: followed by 16+ alphanumeric chars
  { re: /key[=:][A-Za-z0-9]{16,}/g, replacement: 'key=****' },
  // GitHub PATs (ghp_ + at least 35 chars, total token ~39+)
  { re: /ghp_[A-Za-z0-9]{35,}/g, replacement: 'ghp_****' },
  // xAI / Grok keys
  { re: /xai-[A-Za-z0-9]{20,}/g, replacement: 'xai-****' },
];

export function registerSecretPattern(pattern: RegExp): void {
  SECRET_PATTERNS.push(pattern);
}

export function maskSecrets(input: string): string {
  let result = input;

  // Apply built-in patterns first
  for (const { re, replacement } of BUILTIN_SECRET_PATTERNS) {
    // Reset lastIndex because patterns are global regexes reused across calls
    re.lastIndex = 0;
    result = result.replace(re, replacement);
  }

  // Then caller-registered patterns
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
