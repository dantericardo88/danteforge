// Matrix Kernel — Portable terminal war-room.
//
// Renders a live view of the matrix run state in any TTY (tmux, ssh,
// integrated terminal, plain bash). Reads the same canonical state files
// as the VS Code webview, refreshes on filesystem changes via fs.watchFile,
// and exits cleanly on Ctrl+C. Silent in non-TTY environments (CI safety).

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadMatrixDashboardSnapshot,
  dashboardWatchFiles,
  type MatrixDashboardSnapshot,
} from '../../matrix/engines/dashboard-snapshot.js';
import { logger } from '../../core/logger.js';

export interface WarRoomOptions {
  cwd?: string;
  /** `--once` renders one snapshot and exits (used by tests + CI). */
  once?: boolean;
  /** Suppress the watcher (tests + CI). */
  noWatch?: boolean;
  /** Optional injection seam: provide a snapshot directly (tests). */
  _snapshot?: MatrixDashboardSnapshot;
  /** Override the rendering sink (tests). */
  _write?: (chunk: string) => void;
}

export async function warRoom(opts: WarRoomOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const write = opts._write ?? ((chunk: string) => process.stdout.write(chunk));

  // Non-TTY safety: be quiet in pipes / CI. The watcher would be useless
  // there anyway since the terminal can't redraw.
  if (!opts.once && !opts._snapshot && !process.stdout.isTTY) {
    logger.info('[war-room] Non-TTY environment detected; rendering one frame to stdout and exiting. Use --once to make this explicit.');
    opts.once = true;
  }

  const renderOnce = async () => {
    const snapshot = opts._snapshot ?? await loadMatrixDashboardSnapshot({ workspaceRoot: cwd });
    if (process.stdout.isTTY && !opts.once) {
      // Clear screen + home cursor for live mode.
      write('\x1b[2J\x1b[H');
    }
    write(renderWarRoomTUI(snapshot));
    write('\n');
  };

  await renderOnce();

  if (opts.once || opts.noWatch || opts._snapshot) return;

  // Watch every state file; debounce so a burst of writes doesn't re-render N times.
  const files = dashboardWatchFiles(cwd);
  let pending = false;
  let timer: NodeJS.Timeout | null = null;
  const onChange = () => {
    if (pending) return;
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      pending = false;
      void renderOnce();
    }, 150);
  };
  for (const f of files) {
    // fs.watchFile is cross-platform and doesn't require the file to exist
    // up front — it'll fire when the file is later created.
    fs.watchFile(f, { interval: 500 }, onChange);
  }

  // Hold the process open until SIGINT.
  await new Promise<void>(resolve => {
    process.once('SIGINT', () => {
      for (const f of files) fs.unwatchFile(f);
      write('\n[war-room] stopped.\n');
      resolve();
    });
  });
}

// ── Renderer ───────────────────────────────────────────────────────────────

export function renderWarRoomTUI(snapshot: MatrixDashboardSnapshot): string {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan('Matrix War Room'));
  lines.push(chalk.gray(`Run: ${snapshot.runId ?? '(none yet)'}  |  Loaded: ${snapshot.loadedAt}`));
  lines.push(chalk.gray(`Workspace: ${snapshot.workspaceRoot}`));
  lines.push('');

  // 1. Simulation plan
  lines.push(chalk.bold.yellow('── Simulation Plan ──'));
  if (snapshot.waves.length === 0) {
    lines.push(chalk.dim('  (no plan — run `danteforge matrix-kernel simulate`)'));
  } else {
    const planTable = new Table({
      head: [chalk.bold('Wave'), chalk.bold('Packets'), chalk.bold('Tokens'), chalk.bold('USD range')],
      style: { head: [], border: ['gray'] },
    });
    for (const w of snapshot.waves) {
      planTable.push([
        String(w.waveNumber),
        String(w.workPacketIds.length),
        w.estimatedTokens.toLocaleString(),
        `$${w.estimatedUsdLow.toFixed(2)}–$${w.estimatedUsdHigh.toFixed(2)}`,
      ]);
    }
    lines.push(planTable.toString());
  }
  lines.push('');

  // 2. Leases
  lines.push(chalk.bold.yellow('── Leases ──'));
  const leaseEntries = Object.entries(snapshot.leaseCounts);
  if (leaseEntries.length === 0) {
    lines.push(chalk.dim('  (no leases yet)'));
  } else {
    for (const [status, count] of leaseEntries) {
      const color = status === 'completed' ? chalk.green
        : status === 'failed' ? chalk.red
        : status === 'active' ? chalk.cyan
        : chalk.white;
      lines.push(`  ${color(status.padEnd(12))} ${count}`);
    }
  }
  lines.push('');

  // 3. Courts
  lines.push(chalk.bold.yellow('── Verification Court ──'));
  if (snapshot.gateReports.length === 0) {
    lines.push(chalk.dim('  (no gate reports yet)'));
  } else {
    const gateTable = new Table({
      head: [chalk.bold('Lease'), chalk.bold('Status'), chalk.bold('Pass'), chalk.bold('Fail')],
      style: { head: [], border: ['gray'] },
    });
    for (const g of snapshot.gateReports) {
      const color = g.status === 'passed' ? chalk.green : chalk.red;
      gateTable.push([truncate(g.leaseId, 48), color(g.status), String(g.passed), String(g.failed)]);
    }
    lines.push(gateTable.toString());
  }
  lines.push('');

  // 4. Merge decisions
  lines.push(chalk.bold.yellow('── Merge Court ──'));
  if (snapshot.mergeDecisions.length === 0) {
    lines.push(chalk.dim('  (no merge decisions yet)'));
  } else {
    for (const d of snapshot.mergeDecisions) {
      const isApproved = /approved/i.test(d.outcome);
      const color = isApproved ? chalk.green : chalk.red;
      lines.push(`  ${color(d.outcome.padEnd(14))} ${truncate(d.candidateId, 60)}`);
    }
  }
  lines.push('');

  // 5. Mailbox
  lines.push(chalk.bold.yellow('── Mailbox (active coordination) ──'));
  const activeMailbox = snapshot.mailbox.filter(m => m.status === 'pending_ack');
  if (activeMailbox.length === 0) {
    lines.push(chalk.dim('  (no pending messages)'));
  } else {
    const mboxTable = new Table({
      head: [chalk.bold('Type'), chalk.bold('From'), chalk.bold('To'), chalk.bold('Summary')],
      style: { head: [], border: ['gray'] },
      colWidths: [22, 22, 22, 56],
      wordWrap: true,
    });
    for (const m of activeMailbox.slice(0, 12)) {
      mboxTable.push([m.type, truncate(m.fromLease, 20), truncate(m.toLease, 20), m.summary]);
    }
    lines.push(mboxTable.toString());
    if (activeMailbox.length > 12) {
      lines.push(chalk.dim(`  …and ${activeMailbox.length - 12} more`));
    }
  }
  lines.push('');

  // 6. Retro
  if (snapshot.retro) {
    lines.push(chalk.bold.yellow('── Retrospective ──'));
    if (snapshot.retro.bestPerformingProvider) {
      lines.push(`  Best provider: ${chalk.green(snapshot.retro.bestPerformingProvider)}`);
    }
    if (snapshot.retro.weakestGate) {
      lines.push(`  Weakest gate: ${chalk.red(snapshot.retro.weakestGate)}`);
    }
    for (const r of snapshot.retro.recommendedNextRunChanges ?? []) {
      lines.push(`  ${chalk.cyan('→')} ${r}`);
    }
    lines.push('');
  }

  // Errors
  if (Object.keys(snapshot.errors).length > 0) {
    lines.push(chalk.bold.red('── Load errors ──'));
    for (const [file, msg] of Object.entries(snapshot.errors)) {
      lines.push(`  ${chalk.red(file)}: ${msg}`);
    }
    lines.push('');
  }

  lines.push(chalk.dim('Watching matrix state files. Press Ctrl+C to exit.'));
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// keep module side-effect free
void path;
