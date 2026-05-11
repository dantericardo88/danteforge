// DanteSanitize — shared types and constants
export const SANITIZE_HARD_LOC = 750;
export const SANITIZE_IDEAL_LOC = 500;
export const SANITIZE_DEFAULT_MAX_CYCLES = 50;
export const SANITIZE_SESSION_DIR = '.danteforge/sanitize';
export const SANITIZE_BACKUP_DIR = '.danteforge/sanitize/backups';
export const SANITIZE_SESSION_FILE = '.danteforge/sanitize/session.json';
export const SANITIZE_REPORT_FILE = '.danteforge/sanitize/report.md';

export interface SanitizeQueueItem {
  path: string;   // relative to cwd
  loc: number;
  addedAt: string;
}

export interface SanitizeResult {
  originalPath: string;
  newFiles: string[];
  locBefore: number;
  locAfter: number;   // original file LOC after split
  splitAt: string;
}

export type SanitizeSkipReason = 'typecheck-failed' | 'llm-error' | 'no-split-found' | 'max-retries';

export interface SanitizeSkipItem {
  path: string;
  reason: SanitizeSkipReason;
  lastError?: string;
  attempts: number;
}

export interface SanitizeSession {
  startedAt: string;
  cwd: string;
  threshold: number;
  queue: SanitizeQueueItem[];
  completed: SanitizeResult[];
  skipped: SanitizeSkipItem[];
  cyclesRun: number;
}

export interface SplitPlanFile {
  name: string;       // e.g. "foo-types.ts"
  purpose: string;    // human description
  exports: string[];  // symbol names to move here
}

export interface SplitPlan {
  newFiles: SplitPlanFile[];
  retainInOriginal: string[];
  valid: boolean;
  reason?: string;    // why invalid if valid === false
}

export interface SanitizeEngineOptions {
  cwd?: string;
  threshold?: number;       // default SANITIZE_HARD_LOC
  maxCycles?: number;       // default SANITIZE_DEFAULT_MAX_CYCLES
  dryRun?: boolean;
  yes?: boolean;            // skip interactive prompts
  pattern?: string;         // only process files matching this glob pattern
  skipPattern?: string;     // skip files matching this glob pattern
  skipTypecheck?: boolean;
  // Injection seams for testing
  _callLLM?: (prompt: string) => Promise<string>;
  _runTypecheck?: (cwd: string) => Promise<{ success: boolean; output: string }>;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  _readFile?: (filePath: string) => Promise<string>;
  _removeFile?: (filePath: string) => Promise<void>;
  _inspect?: (cwd: string) => Promise<import('./file-size-hygiene.js').FileSizeReport>;
}

// ── Symbol graph (Sprint 2 — AST boundary selection) ────────────────────────

export type SymbolKind = 'interface' | 'type' | 'enum' | 'class' | 'function' | 'const' | 'let' | 'var';

export interface SymbolNode {
  id: string;              // exported symbol name
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  loc: number;             // endLine - startLine + 1
  references: Set<string>; // ids of other top-level symbols this node references
  exported: boolean;
}

export interface SymbolGraph {
  filePath: string;
  totalLoc: number;
  nodes: Map<string, SymbolNode>;
}

export interface SanitizeEngineResult {
  cyclesRun: number;
  filesProcessed: number;
  filesSplit: number;
  filesSkipped: number;
  remainingViolations: number;
  success: boolean;     // true if remainingViolations === 0
  sessionPath: string;
}
