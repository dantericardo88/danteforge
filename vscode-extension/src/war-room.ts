// Matrix War Room — VS Code webview dashboard (Phase 14)
//
// Reads `.danteforge/matrix/*.json` artifacts and renders a live dashboard
// of the Matrix Kernel run state: waves, leases, gate reports, merge
// decisions, retro highlights. Refreshes on file changes.
//
// Designed to be testable: renderMatrixWarRoomHTML is a pure function over
// a MatrixDashboardSnapshot. The webview wiring around it is small and
// uses dependency injection so tests don't need a real VS Code runtime.

export interface MatrixDashboardSnapshot {
  /** Workspace root for context paths. */
  workspaceRoot: string;
  /** Run identifier from the latest plan, if known. */
  runId?: string;
  /** Wave summary derived from the simulation plan. */
  waves: Array<{
    waveNumber: number;
    description: string;
    workPacketIds: string[];
    estimatedTokens: number;
    estimatedUsdLow: number;
    estimatedUsdHigh: number;
  }>;
  /** Lease counts by status. */
  leaseCounts: Record<string, number>;
  /** Latest gate-report verdicts. */
  gateReports: Array<{
    leaseId: string;
    status: string;
    passed: number;
    failed: number;
  }>;
  /** Latest merge decisions. */
  mergeDecisions: Array<{
    candidateId: string;
    outcome: string;
  }>;
  /** Top retrospective highlights. */
  retro?: {
    bestPerformingProvider?: string;
    weakestGate?: string;
    recommendedNextRunChanges?: string[];
  };
  /** Wall-clock when this snapshot was loaded. */
  loadedAt: string;
  /** Per-file load errors (file → message), surfaced so the dashboard never silently lies. */
  errors: Record<string, string>;
}

// ── Pure renderer ──────────────────────────────────────────────────────────

export function renderMatrixWarRoomHTML(snapshot: MatrixDashboardSnapshot): string {
  const wavesHtml = snapshot.waves.length === 0
    ? `<p class="muted">No simulation plan yet. Run <code>danteforge matrix-kernel simulate</code> in the terminal.</p>`
    : `<table>
        <thead><tr><th>Wave</th><th>Packets</th><th>Est. Tokens</th><th>Est. USD</th></tr></thead>
        <tbody>${snapshot.waves.map(w => `
          <tr>
            <td>${w.waveNumber}</td>
            <td>${w.workPacketIds.length}</td>
            <td>${w.estimatedTokens.toLocaleString()}</td>
            <td>$${w.estimatedUsdLow.toFixed(2)}–$${w.estimatedUsdHigh.toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

  const leasesHtml = Object.keys(snapshot.leaseCounts).length === 0
    ? `<p class="muted">No leases yet.</p>`
    : `<ul class="lease-list">${Object.entries(snapshot.leaseCounts)
        .map(([status, count]) => `<li><strong>${status}</strong> · ${count}</li>`).join('')}</ul>`;

  const gateHtml = snapshot.gateReports.length === 0
    ? `<p class="muted">No verification reports yet.</p>`
    : `<table>
        <thead><tr><th>Lease</th><th>Verdict</th><th>Passed</th><th>Failed</th></tr></thead>
        <tbody>${snapshot.gateReports.map(g => `
          <tr class="${g.status === 'passed' ? 'pass' : 'fail'}">
            <td title="${escapeAttr(g.leaseId)}"><code>${escapeHtml(truncate(g.leaseId, 50))}</code></td>
            <td>${escapeHtml(g.status)}</td>
            <td>${g.passed}</td>
            <td>${g.failed}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

  const mergeHtml = snapshot.mergeDecisions.length === 0
    ? `<p class="muted">Merge Court has not arbitrated yet.</p>`
    : `<ul class="merge-list">${snapshot.mergeDecisions.map(m =>
        `<li class="${m.outcome.includes('approved') ? 'pass' : 'fail'}"><code>${escapeHtml(truncate(m.candidateId, 50))}</code> → <strong>${escapeHtml(m.outcome)}</strong></li>`,
      ).join('')}</ul>`;

  const retroHtml = !snapshot.retro
    ? `<p class="muted">No retrospective yet.</p>`
    : `<ul>
        ${snapshot.retro.bestPerformingProvider ? `<li>Best provider: <strong>${escapeHtml(snapshot.retro.bestPerformingProvider)}</strong></li>` : ''}
        ${snapshot.retro.weakestGate ? `<li>Weakest gate: <strong>${escapeHtml(snapshot.retro.weakestGate)}</strong></li>` : ''}
        ${(snapshot.retro.recommendedNextRunChanges ?? []).map(r => `<li>Recommendation: ${escapeHtml(r)}</li>`).join('')}
      </ul>`;

  const errorsHtml = Object.keys(snapshot.errors).length === 0
    ? ''
    : `<section class="errors"><h2>Load errors</h2><ul>${
        Object.entries(snapshot.errors).map(([file, msg]) =>
          `<li><code>${escapeHtml(file)}</code>: ${escapeHtml(msg)}</li>`,
        ).join('')
      }</ul></section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Matrix War Room</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 1rem 1.5rem; max-width: 1100px; color: var(--vscode-foreground); }
  h1 { margin-top: 0; }
  h2 { margin-top: 1.5rem; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.25rem; }
  .muted { color: var(--vscode-descriptionForeground); font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.35rem 0.75rem; border-bottom: 1px solid var(--vscode-panel-border); }
  th { background: var(--vscode-editor-inactiveSelectionBackground); }
  .pass { color: var(--vscode-charts-green, #22863a); }
  .fail { color: var(--vscode-charts-red, #cb2431); }
  code { background: var(--vscode-textCodeBlock-background); padding: 0.1rem 0.35rem; border-radius: 3px; }
  .lease-list, .merge-list { list-style: none; padding: 0; }
  .lease-list li, .merge-list li { padding: 0.25rem 0; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
  .errors { margin-top: 2rem; border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700); padding: 0.5rem 1rem; border-radius: 4px; }
</style>
</head>
<body>
<h1>Matrix War Room</h1>
<p class="meta">Run <code>${snapshot.runId ?? '(no run yet)'}</code> · loaded ${snapshot.loadedAt} · workspace <code>${escapeHtml(snapshot.workspaceRoot)}</code></p>

<h2>Simulation Plan</h2>
${wavesHtml}

<h2>Leases</h2>
${leasesHtml}

<h2>Verification Court</h2>
${gateHtml}

<h2>Merge Court</h2>
${mergeHtml}

<h2>Retrospective</h2>
${retroHtml}

${errorsHtml}
</body>
</html>`;
}

// ── Snapshot loader ────────────────────────────────────────────────────────

export interface LoadSnapshotOptions {
  workspaceRoot: string;
  _readFile?: (p: string) => Promise<string>;
}

const MATRIX_DIR = '.danteforge/matrix';
const FILES = {
  simulationPlan: 'matrix.simulation-plan.json',
  leaseGraph: 'matrix.lease-graph.json',
  gateReports: 'matrix.gate-reports.json',
  mergeDecisions: 'matrix.merge-decisions.json',
  retrospective: 'matrix.retrospective.json',
} as const;

export async function loadMatrixDashboardSnapshot(
  options: LoadSnapshotOptions,
): Promise<MatrixDashboardSnapshot> {
  const errors: Record<string, string> = {};
  const readFile = options._readFile ?? defaultReadFile;
  const read = async <T,>(file: string): Promise<T | null> => {
    try {
      const raw = await readFile(`${options.workspaceRoot}/${MATRIX_DIR}/${file}`);
      return JSON.parse(raw) as T;
    } catch (err) {
      errors[file] = err instanceof Error ? err.message : String(err);
      return null;
    }
  };

  type PlanShape = { runId?: string; waves?: Array<{ waveNumber: number; description: string; workPacketIds: string[]; estimatedTokens: number; estimatedUsdLow: number; estimatedUsdHigh: number }> };
  type LeaseShape = { leases?: Array<{ status: string }> };
  type GatesShape = { reports?: Array<{ leaseId: string; status: string; checks?: Array<{ status: string }> }> };
  type MergeShape = { decisions?: Array<{ candidateId: string; outcome: string }> };
  type RetroShape = { runId?: string; bestPerformingProvider?: string; weakestGate?: string; recommendedNextRunChanges?: string[] };

  const plan = await read<PlanShape>(FILES.simulationPlan);
  const leases = await read<LeaseShape>(FILES.leaseGraph);
  const gates = await read<GatesShape>(FILES.gateReports);
  const merges = await read<MergeShape>(FILES.mergeDecisions);
  const retro = await read<RetroShape>(FILES.retrospective);

  const leaseCounts: Record<string, number> = {};
  for (const lease of leases?.leases ?? []) {
    leaseCounts[lease.status] = (leaseCounts[lease.status] ?? 0) + 1;
  }

  const gateReports = (gates?.reports ?? []).map(r => {
    const checks = r.checks ?? [];
    return {
      leaseId: r.leaseId,
      status: r.status,
      passed: checks.filter(c => c.status === 'passed').length,
      failed: checks.filter(c => c.status === 'failed').length,
    };
  });

  return {
    workspaceRoot: options.workspaceRoot,
    runId: plan?.runId ?? retro?.runId,
    waves: plan?.waves ?? [],
    leaseCounts,
    gateReports,
    mergeDecisions: (merges?.decisions ?? []).map(d => ({ candidateId: d.candidateId, outcome: d.outcome })),
    retro: retro ? {
      bestPerformingProvider: retro.bestPerformingProvider,
      weakestGate: retro.weakestGate,
      recommendedNextRunChanges: retro.recommendedNextRunChanges,
    } : undefined,
    loadedAt: new Date().toISOString(),
    errors,
  };
}

async function defaultReadFile(filePath: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  return readFile(filePath, 'utf8');
}

// ── Webview wiring (called from runtime.ts) ────────────────────────────────

import type { VscodeLike } from './runtime.js';

export async function openMatrixWarRoom(vscodeApi: VscodeLike): Promise<void> {
  const workspaceRoot = vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscodeApi.window.showErrorMessage('Open a workspace folder first.');
    return;
  }
  const createPanel = vscodeApi.window.createWebviewPanel;
  if (!createPanel) {
    void vscodeApi.window.showErrorMessage('This VS Code build does not support webview panels.');
    return;
  }
  const panel = createPanel(
    'danteforge.matrixKernel.warRoom',
    'Matrix War Room',
    1,
    { enableScripts: false, retainContextWhenHidden: true },
  );

  const refresh = async () => {
    const snapshot = await loadMatrixDashboardSnapshot({ workspaceRoot });
    panel.webview.html = renderMatrixWarRoomHTML(snapshot);
  };

  await refresh();

  const watcher = vscodeApi.workspace.createFileSystemWatcher?.(
    `${workspaceRoot}/${MATRIX_DIR}/*.json`,
  );
  if (watcher) {
    watcher.onDidChange(() => { void refresh(); });
    watcher.onDidCreate(() => { void refresh(); });
    panel.onDidDispose(() => watcher.dispose());
  }
}

// ── HTML utility ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
