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
let _stderrMode = false;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

// When _stderrMode is active, stdout-bound log messages are redirected to stderr
// so that --json callers receive clean JSON on stdout without log noise.
function _log(msg: string): void {
  if (_stderrMode) {
    process.stderr.write(msg + '\n');
  } else {
    process.stdout.write(msg + '\n');
  }
}

export const logger = {
  setLevel(level: LogLevel) { currentLevel = level; },
  getLevel(): LogLevel { return currentLevel; },
  /** Redirect non-error log output to stderr. Use when --json flag is active. */
  setStderr(enabled: boolean) { _stderrMode = enabled; },
  verbose: (msg: string) => { if (shouldLog('verbose')) _log(chalk.gray(`[DBG] ${msg}`)); },
  info: (msg: string) => { if (shouldLog('info')) _log(chalk.blue(`[INFO] ${msg}`)); },
  success: (msg: string) => { if (shouldLog('info')) _log(chalk.green(`[OK] ${msg}`)); },
  warn: (msg: string) => { if (shouldLog('warn')) _log(chalk.yellow(`[WARN] ${msg}`)); },
  error: (msg: string) => { if (shouldLog('error')) console.error(chalk.red(`[ERR] ${msg}`)); },
};
