// Wiki Engine Schema — TypeScript types, interfaces, and constants for the Wiki Engine
// Three-tier knowledge architecture: T1 (immutable constitutional), T2 (compiled wiki), T3 (raw sources)
import path from 'node:path';
import os from 'node:os';

// ── Entity types ──────────────────────────────────────────────────────────────

export type WikiEntityType = 'module' | 'decision' | 'pattern' | 'tool' | 'concept';

export interface WikiFrontmatter {
  entity: string;
  type: WikiEntityType;
  created: string;           // ISO 8601
  updated: string;           // ISO 8601
  sources: string[];         // relative paths to raw/ files
  links: string[];           // entity IDs this page links to
  constitutionRefs: string[]; // constitutional invariant IDs referenced
  tags: string[];
  /** Confidence score 0–1 assigned by wiki-ingestor; used for federation threshold */
  confidence?: number;
  /** Source project directory at ingest time (for traceability) */
  sourceProject?: string;
}

export interface WikiEntityPage {
  frontmatter: WikiFrontmatter;
  /** Raw markdown body (everything after the frontmatter delimiter) */
  body: string;
  /** Absolute or cwd-relative path on disk */
  filePath: string;
}

// ── Index ─────────────────────────────────────────────────────────────────────

export interface WikiIndexEntry {
  entityId: string;
  type: WikiEntityType;
  filePath: string;
  tags: string[];
  inboundLinks: string[];    // entity IDs that link TO this page
  outboundLinks: string[];   // entity IDs this page links to
  lastUpdated: string;       // ISO 8601
}

export interface WikiIndex {
  entities: WikiIndexEntry[];
  lastBuilt: string;         // ISO 8601
  totalLinks: number;
  orphanCount: number;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export type WikiAuditEvent =
  | 'ingest'
  | 'upsert'
  | 'lint'
  | 'index-rebuild'
  | 'constitutional-check'
  | 'export'
  | 'bootstrap';

export interface WikiAuditEntry {
  timestamp: string;         // ISO 8601
  event: WikiAuditEvent;
  entityId?: string;
  triggeredBy: string;       // command name or 'autoforge-loop'
  summary: string;
  diff?: string;             // abbreviated diff for upsert events
}

// ── Raw manifest ──────────────────────────────────────────────────────────────

export interface RawManifestEntry {
  hash: string;              // SHA-256 hex of file content at last ingest
  ingestedAt: string;        // ISO 8601
  entityIds: string[];       // which wiki entities were extracted from this file
}

export interface RawManifest {
  files: Record<string, RawManifestEntry>;  // key = path relative to raw/
  lastUpdated: string;
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface WikiQueryResult {
  entityId: string;
  entityType: WikiEntityType;
  score: number;             // 0–1 relevance score
  excerpt: string;           // short summary from entity page body
  sources: string[];         // provenance: raw/ files that contributed
  tags: string[];
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface WikiHealth {
  pageCount: number;
  linkDensity: number;       // average links per page
  orphanRatio: number;       // 0–1 fraction of pages with zero inbound links
  stalenessScore: number;    // 0–1 fraction of pages older than STALENESS_DAYS
  lintPassRate: number;      // 0–1 fraction of pages with zero lint issues
  lastLint: string | null;   // ISO 8601 or null if never linted
  anomalyCount: number;      // active PDSE anomaly flags
}

// ── Lint ──────────────────────────────────────────────────────────────────────

export interface WikiContradiction {
  entityId: string;
  claimA: string;
  claimB: string;
  sourceA: string;
  sourceB: string;
  autoResolved: boolean;
  resolution?: string;
}

export interface WikiStalePage {
  entityId: string;
  lastUpdated: string;
  daysSinceUpdate: number;
  referencedByArtifacts: string[];
}

export interface WikiBrokenLink {
  sourceEntityId: string;
  targetEntityId: string;   // the unresolved link target
  skeletonCreated: boolean;
}

export interface WikiPatternSuggestion {
  suggestedEntity: string;
  rationale: string;
  sourceEntities: string[];
}

export interface WikiLintReport {
  timestamp: string;
  contradictions: WikiContradiction[];
  stalePages: WikiStalePage[];
  brokenLinks: WikiBrokenLink[];
  orphanPages: string[];    // entity IDs with zero inbound links
  patternSuggestions: WikiPatternSuggestion[];
  totalIssues: number;
  passRate: number;         // 0–1
}

// ── PDSE anomaly ──────────────────────────────────────────────────────────────

export interface PdseHistoryEntry {
  timestamp: string;
  artifact: string;
  score: number;
  dimensions: Record<string, number>;
  decision: string;
}

export interface AnomalyFlag {
  artifact: string;
  previousAvg: number;
  currentScore: number;
  delta: number;            // currentScore - previousAvg (signed)
  flaggedAt: string;        // ISO 8601
}

// ── Constitutional integrity ───────────────────────────────────────────────────

export interface ConstitutionalHashStore {
  hashes: Record<string, string>;  // filename → SHA-256 hex
  lockedAt: string;                // ISO 8601 when hashes were first recorded
}

export interface IntegrityCheckResult {
  ok: boolean;
  violations: string[];   // filenames whose hashes changed
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const WIKI_DIR = '.danteforge/wiki';
export const RAW_DIR = '.danteforge/raw';
export const CONSTITUTION_DIR = '.danteforge/constitution';
export const AUDIT_LOG_FILE = '.danteforge/wiki/.audit-log.jsonl';
export const RAW_MANIFEST_FILE = '.danteforge/raw/.manifest.json';
export const PDSE_HISTORY_FILE = '.danteforge/wiki/pdse-history.md';
export const WIKI_INDEX_FILE = '.danteforge/wiki/index.md';
export const CONSTITUTION_HASH_FILE = '.danteforge/constitution/.hashes.json';
export const LINT_REPORT_FILE = '.danteforge/wiki/LINT_REPORT.md';

/** Default delta threshold (points) above which a PDSE score change is anomalous */
export const ANOMALY_THRESHOLD = 15;

/** Pages older than this many days are considered stale */
export const STALENESS_DAYS = 30;

/** Wiki lint cycle fires every N autoforge cycles */
export const LINT_INTERVAL_CYCLES = 5;

/** Maximum tokens allocated to Tier 0 wiki context in context-injector */
export const WIKI_TIER0_TOKEN_BUDGET = 2000;

/** Trailing window for PDSE moving-average anomaly detection */
export const PDSE_HISTORY_WINDOW = 5;

/** Minimum Levenshtein similarity ratio (0–1) for fuzzy entity matching */
export const FUZZY_MATCH_THRESHOLD = 0.75;

/** Global wiki directory — knowledge federated across all projects */
export const GLOBAL_WIKI_DIR = path.join(os.homedir(), '.danteforge', 'global-wiki');

/** Minimum confidence for an entity to be federated to the global wiki */
export const GLOBAL_FEDERATION_THRESHOLD = 0.75;
