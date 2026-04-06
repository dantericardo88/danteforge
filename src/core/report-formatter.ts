// Report formatter — rich table output for assess, maturity, universe commands
// Uses cli-table3 for terminal tables
// Falls back to plain text in --json mode

import { createRequire } from 'module';
import type { ScoringDimension } from './harsh-scorer.js';

// Dynamic require for cli-table3 (CJS module)
function getTable(): new (opts?: object) => { push(row: string[]): void; toString(): string } {
  const req = createRequire(import.meta.url);
  return req('cli-table3');
}

export interface DimRow {
  dim: ScoringDimension;
  score: number;
  bestCompetitor?: string;
  bestScore?: number;
  delta?: number;
  severity?: string;
}

export function formatDimensionTable(rows: DimRow[]): string {
  try {
    const Table = getTable();
    const table = new Table({
      head: ['Dimension', 'Score', 'Best Peer', 'Peer', 'Gap', 'Flag'],
      colWidths: [26, 7, 16, 6, 6, 6],
      style: { head: ['cyan'] },
    });
    for (const row of rows) {
      const score = row.score.toFixed(1);
      const peer = row.bestCompetitor ?? '—';
      const peerScore = row.bestScore != null ? (row.bestScore / 10).toFixed(1) : '—';
      const gap = row.delta != null
        ? (row.delta > 0 ? `+${(row.delta / 10).toFixed(1)}` : (row.delta / 10).toFixed(1))
        : '—';
      const flag = row.score <= 5.0 ? '⚠ P0' : row.score <= 7.5 ? '△ P1' : '✓';
      table.push([row.dim, score, peer, peerScore, gap, flag]);
    }
    return table.toString();
  } catch {
    // Fallback to plain text if cli-table3 not available
    return rows.map((r) =>
      `  ${r.dim.padEnd(22)} ${r.score.toFixed(1)}  ${r.bestCompetitor ?? ''}`,
    ).join('\n');
  }
}

export interface MasterplanRow {
  priority: string;
  dimension: string;
  action: string;
  effort: string;
}

export function formatMasterplanTable(rows: MasterplanRow[]): string {
  try {
    const Table = getTable();
    const table = new Table({
      head: ['Priority', 'Dimension', 'Action', 'Effort'],
      colWidths: [10, 22, 40, 10],
      style: { head: ['cyan'] },
    });
    for (const row of rows) {
      table.push([row.priority, row.dimension, row.action.slice(0, 38), row.effort]);
    }
    return table.toString();
  } catch {
    return rows.map((r) => `  [${r.priority}] ${r.dimension}: ${r.action}`).join('\n');
  }
}
