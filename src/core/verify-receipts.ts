// Verify Receipts — durable JSON + Markdown artifacts from every verify run
import fs from 'fs/promises';
import path from 'path';

const EVIDENCE_DIR = '.danteforge/evidence/verify';
const LATEST_JSON = path.join(EVIDENCE_DIR, 'latest.json');
const LATEST_MD = path.join(EVIDENCE_DIR, 'latest.md');

export type VerifyStatus = 'pass' | 'warn' | 'fail';

export interface VerifyReceipt {
  project: string;
  version: string;
  gitSha: string | null;
  platform: string;
  nodeVersion: string;
  cwd: string;
  projectType: string;
  workflowStage: string;
  timestamp: string;
  commandMode: { release: boolean; live: boolean; recompute: boolean };
  passed: string[];
  warnings: string[];
  failures: string[];
  counts: { passed: number; warnings: number; failures: number };
  releaseCheckPassed: boolean | null;
  liveCheckPassed: boolean | null;
  currentStateFresh: boolean;
  selfEditPolicyEnforced: boolean;
  status: VerifyStatus;
}

/**
 * Compute the overall verify status from result arrays.
 * fail: any failures; warn: warnings but no failures; pass: clean
 */
export function computeReceiptStatus(
  passed: string[],
  warnings: string[],
  failures: string[],
): VerifyStatus {
  if (failures.length > 0) return 'fail';
  if (warnings.length > 0) return 'warn';
  return 'pass';
}

/**
 * Build a Markdown summary from a VerifyReceipt.
 */
export function buildReceiptMarkdown(receipt: VerifyReceipt): string {
  const statusIcon = receipt.status === 'pass' ? '✅' : receipt.status === 'warn' ? '⚠️' : '❌';
  const lines: string[] = [
    `# DanteForge Verify Receipt`,
    ``,
    `**Status:** ${statusIcon} ${receipt.status.toUpperCase()}  `,
    `**Timestamp:** ${receipt.timestamp}  `,
    `**Project:** ${receipt.project} v${receipt.version}  `,
    `**Git SHA:** ${receipt.gitSha ?? 'unavailable'}  `,
    `**Platform:** ${receipt.platform} / Node ${receipt.nodeVersion}  `,
    `**Project Type:** ${receipt.projectType}  `,
    `**Workflow Stage:** ${receipt.workflowStage}  `,
    ``,
    `## Counts`,
    ``,
    `| Passed | Warnings | Failures |`,
    `|--------|----------|---------|`,
    `| ${receipt.counts.passed} | ${receipt.counts.warnings} | ${receipt.counts.failures} |`,
    ``,
  ];

  if (receipt.passed.length > 0) {
    lines.push(`## Passed (${receipt.passed.length})`);
    lines.push(``);
    for (const p of receipt.passed) {
      lines.push(`- ✅ ${p}`);
    }
    lines.push(``);
  }

  if (receipt.warnings.length > 0) {
    lines.push(`## Warnings (${receipt.warnings.length})`);
    lines.push(``);
    for (const w of receipt.warnings) {
      lines.push(`- ⚠️ ${w}`);
    }
    lines.push(``);
  }

  if (receipt.failures.length > 0) {
    lines.push(`## Failures (${receipt.failures.length})`);
    lines.push(``);
    for (const f of receipt.failures) {
      lines.push(`- ❌ ${f}`);
    }
    lines.push(``);
  }

  lines.push(`## Policy`);
  lines.push(``);
  lines.push(`- Self-edit policy enforced: ${receipt.selfEditPolicyEnforced ? 'yes' : 'no'}`);
  lines.push(`- Current state fresh: ${receipt.currentStateFresh ? 'yes' : 'no'}`);
  if (receipt.releaseCheckPassed !== null) {
    lines.push(`- Release check: ${receipt.releaseCheckPassed ? 'passed' : 'failed'}`);
  }

  return lines.join('\n');
}

/**
 * Write a VerifyReceipt to .danteforge/evidence/verify/latest.json and latest.md.
 * Also writes a timestamped copy (verify-${ts}.json) so computeStrictDimensions
 * can count historical runs — 5+ files → +25 autonomy pts instead of +15.
 * Creates directories as needed. Returns the path to the JSON file.
 */
export async function writeVerifyReceipt(
  receipt: VerifyReceipt,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<string> {
  const base = cwd ?? process.cwd();
  const evidenceDir = path.join(base, EVIDENCE_DIR);
  const jsonPath = path.join(base, LATEST_JSON);
  const mdPath = path.join(base, LATEST_MD);

  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });

  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  await fs.writeFile(mdPath, buildReceiptMarkdown(receipt), 'utf8');

  // Also write a timestamped copy so historical runs accumulate in the directory.
  // computeStrictDimensions awards +25 autonomy pts for 5+ files (vs +15 for 2 files).
  try {
    const ts = receipt.timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const tsPath = path.join(evidenceDir, `verify-${ts}.json`);
    await write(tsPath, JSON.stringify(receipt, null, 2) + '\n');
  } catch {
    // non-fatal — timestamped copy is a bonus signal, not critical output
  }

  return jsonPath;
}

/**
 * Read and parse the latest verify receipt from .danteforge/evidence/verify/latest.json.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function readLatestVerifyReceipt(cwd?: string): Promise<VerifyReceipt | null> {
  const base = cwd ?? process.cwd();
  const jsonPath = path.join(base, LATEST_JSON);

  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    return JSON.parse(raw) as VerifyReceipt;
  } catch {
    return null;
  }
}
