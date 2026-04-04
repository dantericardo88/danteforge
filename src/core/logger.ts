// Audit logger with log level control and spinner integration.
// When a spinner is active (via progress.ts), info/success/warn messages
// update the spinner text instead of printing new lines.
import chalk from 'chalk';
import { getActiveSpinner } from './progress.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  verbose: 4,
};

let currentLevel: LogLevel = 'info';

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
      console.error(formatted);
    } else {
      console.log(formatted);
    }
  }
}

export const logger = {
  setLevel(level: LogLevel) { currentLevel = level; },
  getLevel(): LogLevel { return currentLevel; },
  verbose: (msg: string) => {
    if (shouldLog('verbose')) console.log(chalk.gray(`[DBG] ${msg}`));
  },
  info: (msg: string) => logOrSpin(chalk.blue(`[INFO] ${msg}`), msg, 'info'),
  success: (msg: string) => logOrSpin(chalk.green(`[OK] ${msg}`), msg, 'info'),
  warn: (msg: string) => logOrSpin(chalk.yellow(`[WARN] ${msg}`), msg, 'warn'),
  error: (msg: string) => { if (shouldLog('error')) console.error(chalk.red(`[ERR] ${msg}`)); },
};
