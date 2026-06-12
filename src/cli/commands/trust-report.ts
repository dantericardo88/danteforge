// trust-report.ts — render every score WITH its receipts, so honesty is legible from outside.
//
// The honest system's structural marketing problem: it always reports LOWER numbers than tools
// that grade themselves ("honestly 7.6" vs self-declared 9s), and the discipline behind each
// number is invisible to anyone who hasn't read the codebase. This report inverts that: for every
// dimension it shows the claim NEXT TO the evidence — the exact commands that ran, when, in how
// many distinct sessions, what artifacts they produced, the court's verdict or the verbatim
// honest ceiling — plus replay instructions, so a skeptical outsider can re-run any receipt
// themselves. The LOW number plus its receipts is the product; this makes that pair shippable.
//
// Strictly READ-ONLY: it loads the same surfaces every score consumer loads (loadMatrix applies
// the full derivation + caps + frontier gate) and never writes anything except the report file.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMatrix } from '../../core/compete-matrix.js';
import { decisionDimScore } from '../../core/compete-matrix-score.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import { makeEvidenceKey } from '../../matrix/types/outcome.js';
import { loadAllCeilingReceipts } from '../../core/ceiling-receipt.js';
import { loadAllDeclarations } from '../../core/declarations-ledger.js';
import { loadAuditQueue } from '../../core/audit-escrow.js';
import { MARKET_CAPPED_DIMS, MARKET_DIM_MAX_SCORE } from '../../core/market-dims.js';
import { effectiveStatus, type FrontierSpec } from '../../core/frontier-spec.js';
import { logger } from '../../core/logger.js';

export interface TrustReportOptions {
  cwd?: string;
  /** Output path (default .danteforge/reports/TRUST_REPORT.md). */
  output?: string;
  json?: boolean;
}

export interface TrustReportResult {
  outputPath: string;
  overall: number;
  dims: number;
  receiptsShown: number;
  pendingAudits: number;
}

interface DimRow {
  id: string;
  score: number;
  specStatus: string;
  receipts: Array<{ outcomeId: string; tier: string; kind: string; command: string; ranAt: string; session: string; passed: boolean }>;
  ceiling?: { cause: string; detail: string };
  marketCapped: boolean;
  durableDeclarations: number;
}

function trim(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= n ? one : one.slice(0, n - 1) + '…';
}

export async function runTrustReport(options: TrustReportOptions = {}): Promise<TrustReportResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found — nothing to report on.');

  const evidence = await loadOutcomeEvidence(cwd);
  const ceilings = await loadAllCeilingReceipts(cwd).catch(() => []);
  const declarations = await loadAllDeclarations(cwd).catch(() => new Map<string, unknown[]>());
  const audits = await loadAuditQueue(cwd).catch(() => []);
  const pendingAudits = audits.filter(a => (a as { status?: string }).status === 'pending').length;

  const rows: DimRow[] = [];
  let receiptsShown = 0;
  for (const dim of matrix.dimensions) {
    const d = dim as unknown as Record<string, unknown>;
    const outcomes = Array.isArray(d['outcomes']) ? d['outcomes'] as Array<Record<string, unknown>> : [];
    const receipts: DimRow['receipts'] = [];
    for (const o of outcomes) {
      const entry = evidence.get(makeEvidenceKey(dim.id, String(o['id'])));
      if (!entry) continue;
      const command = typeof o['command'] === 'string'
        ? o['command'] as string
        : Array.isArray(o['cli_args']) ? `node dist/index.js ${(o['cli_args'] as unknown[]).map(String).join(' ')}` : '(declared steps)';
      receipts.push({
        outcomeId: String(o['id']), tier: entry.tier, kind: String(o['kind'] ?? 'shell'),
        command, ranAt: entry.ranAt, session: (entry as { session_id?: string }).session_id ?? '—',
        passed: entry.passed,
      });
    }
    receipts.sort((a, b) => b.tier.localeCompare(a.tier) || a.outcomeId.localeCompare(b.outcomeId));
    receiptsShown += receipts.length;
    const spec = (d['frontier_spec'] as FrontierSpec | undefined);
    const ceiling = ceilings.find(c => c.dimId === dim.id);
    rows.push({
      id: dim.id,
      score: decisionDimScore(dim as Parameters<typeof decisionDimScore>[0]),
      specStatus: spec ? effectiveStatus(spec) : 'none',
      receipts,
      ...(ceiling ? { ceiling: { cause: ceiling.cause, detail: ceiling.detail } } : {}),
      marketCapped: MARKET_CAPPED_DIMS.has(dim.id),
      durableDeclarations: (declarations.get(dim.id) as unknown[] | undefined)?.length ?? 0,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const overall = rows.length === 0 ? 0 : Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 100) / 100;

  const lines: string[] = [];
  lines.push('# Trust Report — every score, with its receipts');
  lines.push('');
  lines.push(`> Generated ${new Date().toISOString()} from on-disk evidence. Nothing here is self-graded:`);
  lines.push('> scores derive from executed receipts, are capped by integrity gates, and cannot exceed 8.0');
  lines.push('> without an independent court validation. Numbers here are LOWER than self-declared scores');
  lines.push('> by design — every one of them can be replayed: run the command in any receipt row yourself.');
  lines.push('');
  lines.push(`**Overall (honest mean): ${overall.toFixed(2)} / 10** · ${rows.length} dimensions · ${receiptsShown} live receipts · ${pendingAudits} court validation(s) awaiting human audit`);
  lines.push('');
  lines.push('| Dim | Score | Frontier spec | Fresh receipts | Durable earns | Ceiling |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.id} | **${r.score.toFixed(1)}** | ${r.specStatus} | ${r.receipts.length} | ${r.durableDeclarations} | ${r.marketCapped ? `market-cap ${MARKET_DIM_MAX_SCORE.toFixed(1)}` : r.ceiling ? r.ceiling.cause : '—'} |`);
  }
  lines.push('');
  for (const r of rows) {
    lines.push(`## ${r.id} — ${r.score.toFixed(1)}`);
    if (r.marketCapped) {
      lines.push(`*Hard-capped at ${MARKET_DIM_MAX_SCORE.toFixed(1)}: bounded by external market signals (adoption/usage) that internal evidence cannot certify. At the cap, this dimension is done.*`);
    }
    if (r.ceiling) {
      lines.push(`**Honest ceiling (${r.ceiling.cause}):** ${r.ceiling.detail}`);
    }
    if (r.specStatus === 'validated') {
      lines.push('**Frontier: court-VALIDATED** — independent judges (builder excluded) confirmed this dimension against its named competitor.');
    } else if (r.specStatus === 'frozen') {
      lines.push('**Frontier: spec frozen** — the competitive target is hash-locked; evidence capture/court pending. Score is gated ≤8.0 until the court validates.');
    }
    if (r.receipts.length === 0) {
      lines.push('*No fresh receipts — the score above already reflects that (stale/absent evidence decays; unverified claims cap at 5.0).*');
    } else {
      lines.push('');
      lines.push('| Receipt | Tier | Kind | Command (replayable) | Last ran | Session | Pass |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const e of r.receipts) {
        lines.push(`| ${e.outcomeId} | ${e.tier} | ${e.kind} | \`${trim(e.command, 90)}\` | ${e.ranAt.slice(0, 16)} | ${trim(e.session, 18)} | ${e.passed ? '✓' : '✗'} |`);
      }
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('**How to verify any number here:** clone the repo, run the command in the receipt row, and');
  lines.push('compare. Or run `danteforge validate <dim>` to re-execute a dimension\'s whole evidence suite');
  lines.push('cold — the score will move to whatever the receipts genuinely support. The system structurally');
  lines.push('rejects hand-edited scores, test-suite receipts above T4/7.0, sub-second "exercises",');
  lines.push('single-session 9.0 proofs, and softened competitive bars.');
  lines.push('');

  const outputPath = path.resolve(cwd, options.output ?? path.join('.danteforge', 'reports', 'TRUST_REPORT.md'));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'), 'utf8');

  const result: TrustReportResult = { outputPath, overall, dims: rows.length, receiptsShown, pendingAudits };
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    logger.success(`[trust-report] ${rows.length} dims · ${receiptsShown} receipts · honest mean ${overall.toFixed(2)} → ${outputPath}`);
    if (pendingAudits > 0) logger.warn(`[trust-report] ${pendingAudits} court validation(s) awaiting human audit — run \`danteforge frontier-audit\` (the courts are LLM judges; spot-checks keep them honest).`);
  }
  return result;
}
