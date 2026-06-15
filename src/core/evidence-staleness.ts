// evidence-staleness.ts — #10: surface whether a dimension's score is about the CURRENT code or borrowed
// from a prior commit. loadOutcomeEvidence silently falls back to the most-recent prior-SHA receipt within
// a tier's freshness window (so an unrelated commit doesn't orphan the whole matrix) — honest, but it
// means a displayed score can describe code that is N commits stale with no flag. This computes, per dim,
// whether ≥1 receipt is at HEAD vs only borrowed from prior SHAs, so `compete status` can say "scored
// against X, HEAD is Y" and the operator knows which numbers are current. Read-only; never throws.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadOutcomeEvidence } from '../matrix/engines/outcome-runner.js';
import type { OutcomeEvidence, OutcomeEvidenceEntry } from '../matrix/types/outcome.js';
import type { CompeteMatrix } from './compete-matrix.js';

const execFileAsync = promisify(execFile);

export interface DimFreshness {
  dimId: string;
  hasEvidence: boolean;
  /** ≥1 receipt recorded at the current HEAD. */
  freshAtHead: boolean;
  /** prior SHAs this dim's evidence was borrowed from (entry.gitSha !== HEAD). */
  borrowedShas: string[];
}

export interface StalenessReport {
  headSha: string | null;
  perDim: DimFreshness[];
  freshCount: number;       // dims with ≥1 receipt at HEAD
  staleCount: number;       // dims with evidence, but only borrowed from prior SHAs
  noEvidenceCount: number;  // dims with no receipts at all
}

async function defaultHeadSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    return stdout.trim() || null;
  } catch { return null; }
}

export interface StalenessOptions {
  cwd: string;
  matrix: CompeteMatrix;
  _loadEvidence?: (cwd: string) => Promise<OutcomeEvidence>;
  _headSha?: (cwd: string) => Promise<string | null>;
}

/** Per-dimension freshness of the evidence backing the displayed scores, relative to HEAD. */
export async function computeEvidenceStaleness(opts: StalenessOptions): Promise<StalenessReport> {
  const headSha = await (opts._headSha ?? defaultHeadSha)(opts.cwd);
  const evidence = await (opts._loadEvidence ?? ((c: string) => loadOutcomeEvidence(c)))(opts.cwd);

  const byDim = new Map<string, OutcomeEvidenceEntry[]>();
  for (const e of evidence.values()) {
    const arr = byDim.get(e.dimensionId) ?? [];
    arr.push(e);
    byDim.set(e.dimensionId, arr);
  }

  const perDim: DimFreshness[] = opts.matrix.dimensions.map(d => {
    const entries = byDim.get(d.id) ?? [];
    const freshAtHead = headSha != null && entries.some(e => e.gitSha === headSha);
    const borrowedShas = [...new Set(entries.filter(e => e.gitSha && e.gitSha !== headSha).map(e => e.gitSha as string))];
    return { dimId: d.id, hasEvidence: entries.length > 0, freshAtHead, borrowedShas };
  });

  return {
    headSha,
    perDim,
    freshCount: perDim.filter(p => p.freshAtHead).length,
    staleCount: perDim.filter(p => p.hasEvidence && !p.freshAtHead).length,
    noEvidenceCount: perDim.filter(p => !p.hasEvidence).length,
  };
}

const short = (sha: string | null): string => (sha ? sha.slice(0, 7) : 'none');

/** A one/two-line operator summary, or '' when there's no evidence to report (keeps fresh matrices quiet). */
export function formatStalenessLine(report: StalenessReport): string {
  const withEvidence = report.perDim.filter(p => p.hasEvidence);
  if (withEvidence.length === 0) return '';
  const lines = [
    `Evidence freshness — HEAD ${short(report.headSha)}: ${report.freshCount} dim(s) current, ` +
    `${report.staleCount} on borrowed prior-SHA evidence, ${report.noEvidenceCount} with no receipts.`,
  ];
  const stale = report.perDim.filter(p => p.hasEvidence && !p.freshAtHead);
  if (stale.length > 0) {
    lines.push(
      `  ⧖ scored against older code (not HEAD): ${stale.map(p => `${p.dimId}@${short(p.borrowedShas[0] ?? null)}`).slice(0, 8).join(', ')}` +
      `${stale.length > 8 ? ` (+${stale.length - 8} more)` : ''} — re-run \`danteforge validate <dim>\` to refresh.`,
    );
  }
  if (report.freshCount === 0 && withEvidence.length > 0) {
    lines.push(`  ⚠ ZERO dims have receipts at HEAD — every displayed score describes earlier code. Treat with low confidence until refreshed.`);
  }
  return lines.join('\n');
}
