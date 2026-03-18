// Audit logger with log level control
import chalk from 'chalk';

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

export const logger = {
  setLevel(level: LogLevel) { currentLevel = level; },
  getLevel(): LogLevel { return currentLevel; },
  verbose: (msg: string) => { if (shouldLog('verbose')) console.log(chalk.gray(`[DBG] ${msg}`)); },
  info: (msg: string) => { if (shouldLog('info')) console.log(chalk.blue(`[INFO] ${msg}`)); },
  success: (msg: string) => { if (shouldLog('info')) console.log(chalk.green(`[OK] ${msg}`)); },
  warn: (msg: string) => { if (shouldLog('warn')) console.log(chalk.yellow(`[WARN] ${msg}`)); },
  error: (msg: string) => { if (shouldLog('error')) console.error(chalk.red(`[ERR] ${msg}`)); },
};
