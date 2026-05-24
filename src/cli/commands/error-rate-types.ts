// Types for the error-rate command.

export interface ErrorRateOptions {
  /** Time window in minutes (default: 60) */
  window?: number;
  /** Output raw JSON */
  json?: boolean;
  /** Clear the error log */
  clear?: boolean;
  /** Tail the log live, polling every 2s */
  watch?: boolean;
  /**
   * Override the log file path — for testing only.
   * In production this is derived from process.cwd()/.danteforge/error-log.jsonl.
   */
  _logFilePath?: string;
}
