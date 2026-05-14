// Shared contracts for the DanteForge Context Economy Layer (PRD-26 / Article XIV).

export type FilterStatus =
  | 'filtered'
  | 'passthrough'
  | 'low-yield'
  | 'sacred-bypass'
  | 'filter-failed';

export type RuleSource = 'built-in' | 'user' | 'trusted-project';

export interface FilterResult {
  output: string;
  status: FilterStatus;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savingsPercent: number;
  sacredSpanCount: number;
  filterId: string;
}

export interface CommandFilter {
  readonly filterId: string;
  detect(command: string, args: string[]): boolean;
  filter(output: string, command: string, args: string[]): FilterResult;
}

export interface LedgerRecord {
  timestamp: string;
  organ: string;
  command: string;
  filterId: string;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savingsPercent: number;
  sacredSpanCount: number;
  status: FilterStatus;
  ruleSource: RuleSource;
  rawEvidenceHash?: string;
}

export interface LedgerSummary {
  totalRecords: number;
  filtered: number;
  passthrough: number;
  lowYield: number;
  sacredBypass: number;
  filterFailed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSavedTokens: number;
  averageSavingsPercent: number;
  topFilters: Array<{ filterId: string; count: number; savedTokens: number }>;
  topPassthroughs: Array<{ command: string; count: number }>;
}

export interface ArtifactCompressionRule {
  artifactType: string;
  maxInjectedBytes: number;
  expectedRatio: number;
  sacred: string[];
}

export interface CompressionResult {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  /** Ratio of compressedSize to originalSize (0.0–1.0). Lower is better. 1.0 = no compression. */
  compressionRatio: number;
  sacredSpans: string[];
  rawHash?: string;
}

/** Per-command token cost entry for spend reporting. */
export interface CommandCostRecord {
  timestamp: string;
  command: string;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  outcomeQuality?: number;
}

/** Aggregated spend report keyed by command name. */
export interface CommandSpendReport {
  generatedAt: string;
  commands: Array<{
    command: string;
    callCount: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalTokens: number;
    avgOutcomeQuality?: number;
  }>;
  grandTotalTokensIn: number;
  grandTotalTokensOut: number;
  grandTotalTokens: number;
}

/** A single entry in the economy ledger (alias for LedgerRecord). */
export type LedgerEntry = LedgerRecord;

/**
 * In-memory economy ledger — a collection of ledger entries for the current
 * session / analysis window plus optional metadata.
 */
export interface EconomyLedger {
  /** Ordered list of filter outcome entries (oldest first). */
  entries: LedgerEntry[];
  /** ISO timestamp of ledger creation (for age-based pruning). */
  createdAt: string;
  /** ISO timestamp of last modification. */
  updatedAt: string;
}

/** Computed stats derived from an EconomyLedger. */
export interface LedgerStats {
  /** Total number of ledger entries. */
  entryCount: number;
  /** Total tokens filtered (saved) across all entries. */
  totalFiltered: number;
  /** Average savings percentage across all entries (0–100). */
  avgSavingsPct: number;
  /** Top filter IDs ordered by total tokens saved (descending), up to 5. */
  topFilters: string[];
}
