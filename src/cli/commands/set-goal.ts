// Set Goal — interactive goal specification with oversight dial.
// Saves .danteforge/GOAL.json, then optionally runs universe-scan.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { type UniverseScanOptions, type UniverseScan } from './universe-scan.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoalConfig {
  version: '1.0.0';
  /** Software category, e.g. "agentic dev CLI" */
  category: string;
  /** Direct competitors, e.g. ["Cursor", "Aider", "Copilot"] */
  competitors: string[];
  /** Definition of a 9/10 outcome for this project */
  definition9: string;
  /** Explicit out-of-scope items */
  exclusions: string[];
  /** Daily LLM spend limit in USD (default 5.00) */
  dailyBudgetUsd: number;
  /**
   * Oversight level:
   *   1 = approve every cycle
   *   2 = approve only architectural changes (> 3 files or new modules)
   *   3 = notify only — fully autonomous
   */
  oversightLevel: 1 | 2 | 3;
  createdAt: string;
  updatedAt: string;
}

export interface SetGoalOptions {
  cwd?: string;
  promptMode?: boolean;
  /** Run universe-scan after saving (default true) */
  autoScan?: boolean;
  /** Direct field overrides for non-interactive usage (tests) */
  fields?: Partial<Omit<GoalConfig, 'version' | 'createdAt' | 'updatedAt'>>;
  _readLine?: (prompt: string) => Promise<string>;
  _runUniverseScan?: (opts?: UniverseScanOptions) => Promise<UniverseScan>;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const GOAL_FILENAME = 'GOAL.json';

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

function getGoalPath(cwd?: string): string {
  return path.join(getDanteforgeDir(cwd), GOAL_FILENAME);
}

// ── Persistence ───────────────────────────────────────────────────────────────

/** Load existing GOAL.json. Returns null if not found. */
export async function loadGoal(cwd?: string): Promise<GoalConfig | null> {
  try {
    const raw = await fs.readFile(getGoalPath(cwd), 'utf8');
    return JSON.parse(raw) as GoalConfig;
  } catch {
    return null;
  }
}

/** Persist a GoalConfig to .danteforge/GOAL.json. */
export async function saveGoal(goal: GoalConfig, cwd?: string): Promise<void> {
  const dir = getDanteforgeDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getGoalPath(cwd), JSON.stringify(goal, null, 2), 'utf8');
}

// ── Interactive readline helper ───────────────────────────────────────────────

async function defaultReadLine(promptText: string): Promise<string> {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(promptText);
    return answer.trim();
  } finally {
    rl.close();
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export async function setGoal(opts: SetGoalOptions = {}): Promise<GoalConfig> {
  const cwd = opts.cwd;
  const autoScan = opts.autoScan ?? true;
  const readLine = opts._readLine ?? defaultReadLine;

  // ── Prompt mode ─────────────────────────────────────────────────────────────
  if (opts.promptMode) {
    const template = `# Set Goal — GOAL.json Template

Fill in these fields and run \`danteforge set-goal\` in interactive mode,
or pass them directly via --fields in programmatic usage.

{
  "category": "agentic dev CLI",
  "competitors": ["Cursor", "Copilot", "Aider"],
  "definition9": "Autonomously improves itself by harvesting OSS patterns and verifying convergence",
  "exclusions": ["no web app", "no cloud backend required"],
  "dailyBudgetUsd": 5.00,
  "oversightLevel": 2
}

## Oversight Levels
  1 = Approve every forge cycle before execution
  2 = Approve only when architectural (> 3 files, new modules)  [default]
  3 = Fully autonomous — notify only
`;
    logger.info(template);
    return buildDefaultGoal();
  }

  // ── Load existing to merge ──────────────────────────────────────────────────
  const existing = await loadGoal(cwd);
  const now = new Date().toISOString();

  let goal: GoalConfig;

  if (opts.fields) {
    // Non-interactive path (used by tests and programmatic callers)
    const competitors = deduplicateCompetitors(opts.fields.competitors ?? existing?.competitors ?? []);
    goal = {
      version: '1.0.0',
      category: opts.fields.category ?? existing?.category ?? 'agentic dev CLI',
      competitors,
      definition9: opts.fields.definition9 ?? existing?.definition9 ?? 'Fully autonomous self-improvement with verified convergence',
      exclusions: opts.fields.exclusions ?? existing?.exclusions ?? [],
      dailyBudgetUsd: opts.fields.dailyBudgetUsd ?? existing?.dailyBudgetUsd ?? 5.0,
      oversightLevel: opts.fields.oversightLevel ?? existing?.oversightLevel ?? 2,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  } else if (process.stdin.isTTY) {
    // Interactive TTY path
    logger.info('\n  SET CONVERGENCE GOAL\n  ════════════════════\n');

    const category = await readLine(
      `  Software category [${existing?.category ?? 'agentic dev CLI'}]: `,
    ) || (existing?.category ?? 'agentic dev CLI');

    const competitorsRaw = await readLine(
      `  Competitors (comma-separated) [${(existing?.competitors ?? []).join(', ') || 'none'}]: `,
    );
    const competitors = deduplicateCompetitors(
      competitorsRaw
        ? competitorsRaw.split(',').map(s => s.trim()).filter(Boolean)
        : (existing?.competitors ?? []),
    );

    const definition9 = await readLine(
      `  Definition of 9/10 [${existing?.definition9 ?? 'Fully autonomous self-improvement'}]: `,
    ) || (existing?.definition9 ?? 'Fully autonomous self-improvement with verified convergence');

    const exclusionsRaw = await readLine(
      `  Exclusions (comma-separated) [${(existing?.exclusions ?? []).join(', ') || 'none'}]: `,
    );
    const exclusions = exclusionsRaw
      ? exclusionsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : (existing?.exclusions ?? []);

    const budgetRaw = await readLine(
      `  Daily budget USD [${existing?.dailyBudgetUsd ?? 5.0}]: `,
    );
    const dailyBudgetUsd = budgetRaw ? parseFloat(budgetRaw) : (existing?.dailyBudgetUsd ?? 5.0);

    const oversightRaw = await readLine(
      `  Oversight level 1/2/3 [${existing?.oversightLevel ?? 2}]: `,
    );
    const oversightLevel = (oversightRaw ? parseInt(oversightRaw, 10) : (existing?.oversightLevel ?? 2)) as 1 | 2 | 3;

    goal = {
      version: '1.0.0',
      category,
      competitors,
      definition9,
      exclusions,
      dailyBudgetUsd: isNaN(dailyBudgetUsd) ? 5.0 : dailyBudgetUsd,
      oversightLevel: ([1, 2, 3] as const).includes(oversightLevel) ? oversightLevel : 2,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  } else {
    // Non-TTY, no fields provided — use defaults merged with existing
    goal = {
      version: '1.0.0',
      category: existing?.category ?? 'agentic dev CLI',
      competitors: existing?.competitors ?? [],
      definition9: existing?.definition9 ?? 'Fully autonomous self-improvement with verified convergence',
      exclusions: existing?.exclusions ?? [],
      dailyBudgetUsd: existing?.dailyBudgetUsd ?? 5.0,
      oversightLevel: existing?.oversightLevel ?? 2,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  await saveGoal(goal, cwd);
  logger.info(`[set-goal] Goal saved to .danteforge/GOAL.json`);
  logger.info(`  Category: ${goal.category}`);
  logger.info(`  Oversight: ${goal.oversightLevel} (${oversightDescription(goal.oversightLevel)})`);
  logger.info(`  Daily budget: $${goal.dailyBudgetUsd}`);
  logger.info('');
  logger.info('Goal set. Run /harvest-forge to begin autonomous improvement.');

  // ── Auto universe-scan ──────────────────────────────────────────────────────
  if (autoScan) {
    logger.info('[set-goal] Running universe-scan to establish baseline...');
    const runUniverseScan = opts._runUniverseScan ?? defaultUniverseScan;
    try {
      await runUniverseScan({ cwd });
    } catch (err) {
      logger.warn(`[set-goal] universe-scan failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return goal;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deduplicateCompetitors(competitors: string[]): string[] {
  const seen = new Set<string>();
  return competitors.filter(c => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function oversightDescription(level: 1 | 2 | 3): string {
  if (level === 1) return 'approve every cycle';
  if (level === 2) return 'approve architectural changes only';
  return 'notify only — fully autonomous';
}

function buildDefaultGoal(): GoalConfig {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    category: 'agentic dev CLI',
    competitors: [],
    definition9: 'Fully autonomous self-improvement with verified convergence',
    exclusions: [],
    dailyBudgetUsd: 5.0,
    oversightLevel: 2,
    createdAt: now,
    updatedAt: now,
  };
}

async function defaultUniverseScan(opts?: UniverseScanOptions): Promise<UniverseScan> {
  const { universeScan } = await import('./universe-scan.js');
  return universeScan(opts);
}
