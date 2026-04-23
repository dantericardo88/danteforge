// Dashboard - lightweight progress overview served as local HTML.
import fs from 'fs/promises';
import http from 'http';
import { logger } from '../../core/logger.js';
import { loadState, type DanteState } from '../../core/state.js';
import { loadConfig, type DanteConfig } from '../../core/config.js';
import { detectHost, detectMCPCapabilities } from '../../core/mcp.js';
import { resolveTier } from '../../core/mcp-adapter.js';
import { estimateTokens } from '../../core/token-estimator.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { getWikiHealth } from '../../core/wiki-engine.js';
import type { WikiHealth } from '../../core/wiki-schema.js';
import { computeHarshScore, type HarshScoreResult, type HarshScorerOptions } from '../../core/harsh-scorer.js';

interface DashboardCapabilities {
  hasFigmaMCP: boolean;
}

interface DashboardRenderInput {
  state: Pick<DanteState, 'project' | 'workflowStage' | 'currentPhase' | 'profile' | 'tasks' | 'auditLog'>;
  config: Pick<DanteConfig, 'defaultProvider'>;
  host: string;
  capabilities: DashboardCapabilities;
  tier: string;
  packageVersion: string;
  totalTokensEstimated: number;
  wikiHealth?: WikiHealth | null;
  qualityScore?: HarshScoreResult | null;
}

export function parseDashboardPort(rawPort?: string): number {
  const normalized = (rawPort ?? '4242').trim();
  const parsed = Number.parseInt(normalized, 10);
  const validInteger = /^\d+$/.test(normalized) && Number.isInteger(parsed);
  if (!validInteger || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid --port value "${normalized}": must be an integer between 1 and 65535.`,
    );
  }
  return parsed;
}

async function loadPackageVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(new URL('../../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const DIM_LABELS: Record<string, string> = {
  functionality: 'Functionality', testing: 'Testing', errorHandling: 'Error Handling',
  security: 'Security', uxPolish: 'UX Polish', documentation: 'Documentation',
  performance: 'Performance', maintainability: 'Maintainability',
  developerExperience: 'Developer Experience', autonomy: 'Autonomy',
  planningQuality: 'Planning Quality', selfImprovement: 'Self-Improvement',
  specDrivenPipeline: 'Spec-Driven Pipeline', convergenceSelfHealing: 'Convergence',
  tokenEconomy: 'Token Economy', ecosystemMcp: 'MCP Ecosystem',
  enterpriseReadiness: 'Enterprise Readiness', communityAdoption: 'Community Adoption',
};

function scoreColor(score: number): string {
  if (score >= 9.0) return '#4ade80';
  if (score >= 7.0) return '#fbbf24';
  return '#f87171';
}

function renderQualitySection(qualityScore: HarshScoreResult | null | undefined): string {
  if (!qualityScore) return '';

  const displayScore = qualityScore.displayScore;
  const dims = qualityScore.displayDimensions ?? {};
  const color = scoreColor(displayScore);

  const dimEntries = Object.entries(dims)
    .filter(([id]) => id !== 'communityAdoption')
    .sort(([, a], [, b]) => a - b);

  const p0Dims = dimEntries.filter(([, v]) => v < 7.0).slice(0, 3);

  const dimBars = dimEntries.map(([id, score]) => {
    const label = DIM_LABELS[id] ?? id;
    const pct = Math.round((score / 10) * 100);
    const barColor = scoreColor(score);
    const isP0 = score < 7.0 ? ' <span style="color:#f87171;font-size:0.7rem">P0</span>' : '';
    return `<div class="dim-row">
      <span class="dim-label">${escapeHtml(label)}${isP0}</span>
      <div class="dim-track"><div class="dim-bar" style="width:${pct}%;background:${barColor}"></div></div>
      <span class="dim-num" style="color:${barColor}">${score.toFixed(1)}</span>
    </div>`;
  }).join('\n');

  const nextAction = p0Dims.length > 0
    ? `danteforge forge "Improve ${DIM_LABELS[p0Dims[0]![0]] ?? p0Dims[0]![0]}"`
    : 'danteforge ascend';

  const p0Section = p0Dims.length > 0 ? `
  <h2>P0 Gaps — recommended next actions</h2>
  <div class="p0-list">
    ${p0Dims.map(([id, v]) => `<div class="p0-item"><span class="p0-dim">${escapeHtml(DIM_LABELS[id] ?? id)}</span><span class="p0-score">${v.toFixed(1)}/10</span><code class="p0-cmd">danteforge forge "Improve ${escapeHtml(DIM_LABELS[id] ?? id)}"</code></div>`).join('\n    ')}
  </div>` : '<div class="p0-clean">✓ All tracked dimensions above 7.0. Run <code>danteforge ascend</code> to push further.</div>';

  return `
  <div class="quality-hero">
    <div class="quality-score-ring" style="border-color:${color}">
      <div class="quality-score-num" style="color:${color}">${displayScore.toFixed(1)}</div>
      <div class="quality-score-denom">/10</div>
      <div class="quality-score-label">Quality Score</div>
    </div>
    <div class="quality-next-action">
      <div class="quality-next-label">Recommended next action</div>
      <code class="quality-next-cmd">${escapeHtml(nextAction)}</code>
    </div>
  </div>

  <h2>Dimension Breakdown</h2>
  <div class="dim-grid">${dimBars}</div>

  ${p0Section}`;
}

function renderWikiSection(wikiHealth?: WikiHealth | null): string {
  if (!wikiHealth) return '';
  return `
  <h2>Wiki Health</h2>
  <div class="grid">
    <div class="card"><div class="label">Wiki Pages</div><div class="value">${wikiHealth.pageCount}</div></div>
    <div class="card"><div class="label">Link Density</div><div class="value ${wikiHealth.linkDensity >= 3 ? 'ok' : 'warn'}">${wikiHealth.linkDensity.toFixed(1)}</div></div>
    <div class="card"><div class="label">Orphan Ratio</div><div class="value ${wikiHealth.orphanRatio <= 0.05 ? 'ok' : 'warn'}">${(wikiHealth.orphanRatio * 100).toFixed(1)}%</div></div>
    <div class="card"><div class="label">Lint Pass Rate</div><div class="value ${wikiHealth.lintPassRate >= 0.95 ? 'ok' : 'warn'}">${(wikiHealth.lintPassRate * 100).toFixed(1)}%</div></div>
    <div class="card"><div class="label">PDSE Anomalies</div><div class="value ${wikiHealth.anomalyCount === 0 ? 'ok' : 'warn'}">${wikiHealth.anomalyCount === 0 ? 'None' : wikiHealth.anomalyCount}</div></div>
    <div class="card"><div class="label">Last Lint</div><div class="value" style="font-size:0.9rem">${wikiHealth.lastLint ? escapeHtml(wikiHealth.lastLint.slice(0, 16).replace('T', ' ')) : 'Never'}</div></div>
  </div>`;
}

function renderMetricGrid(input: DashboardRenderInput, executionWaveLabel: string, totalTasks: number, totalAuditEntries: number): string {
  const { config, capabilities, tier, totalTokensEstimated } = input;
  const figmaStatus = capabilities.hasFigmaMCP ? 'Connected' : 'Not configured';
  return `<div class="grid">
    <div class="card"><div class="label">Workflow Stage</div><div class="value">${escapeHtml(input.state.workflowStage)}</div></div>
    <div class="card"><div class="label">Execution Wave</div><div class="value">${escapeHtml(executionWaveLabel)}</div></div>
    <div class="card"><div class="label">Total Tasks</div><div class="value">${totalTasks}</div></div>
    <div class="card"><div class="label">LLM Provider</div><div class="value">${escapeHtml(config.defaultProvider)}</div></div>
    <div class="card"><div class="label">Figma MCP</div><div class="value ${capabilities.hasFigmaMCP ? 'ok' : 'warn'}">${figmaStatus}</div></div>
    <div class="card"><div class="label">MCP Host</div><div class="value">${escapeHtml(input.host)}</div></div>
    <div class="card"><div class="label">MCP Tier</div><div class="value">${escapeHtml(tier)}</div></div>
    <div class="card"><div class="label">Audit Entries</div><div class="value">${totalAuditEntries}</div></div>
    <div class="card"><div class="label">Est. Tokens Used</div><div class="value">${totalTokensEstimated.toLocaleString()}</div></div>
  </div>`;
}

export function renderDashboardHtml(input: DashboardRenderInput): string {
  const {
    state,
    config,
    host,
    capabilities,
    tier,
    packageVersion,
    totalTokensEstimated,
    wikiHealth,
    qualityScore,
  } = input;

  const totalTasks = Object.values(state.tasks).flat().length;
  const totalAuditEntries = state.auditLog.length;
  const executionWaveLabel = state.currentPhase > 0 ? String(state.currentPhase) : 'Not started';
  const recentLog = state.auditLog.slice(-20).reverse();
  const timelineRows = recentLog.map(entry => {
    const [timestamp, ...rest] = entry.split(' | ');
    return `<tr><td class="ts">${escapeHtml(timestamp)}</td><td>${escapeHtml(rest.join(' | '))}</td></tr>`;
  }).join('\n');

  const style = `<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; color: #ff6b35; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; }
  .card .label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 1.5rem; font-weight: 600; color: #fff; margin-top: 4px; }
  .card .value.ok { color: #4ade80; }
  .card .value.warn { color: #fbbf24; }
  h2 { font-size: 1rem; color: #ff6b35; margin: 24px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: #888; padding: 8px 12px; border-bottom: 1px solid #333; }
  td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; }
  .ts { color: #888; white-space: nowrap; font-family: monospace; font-size: 0.75rem; }
  .footer { margin-top: 24px; color: #555; font-size: 0.75rem; text-align: center; }
  /* Quality score hero */
  .quality-hero { display: flex; align-items: center; gap: 32px; background: #111; border: 1px solid #222; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .quality-score-ring { width: 100px; height: 100px; border-radius: 50%; border: 4px solid; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
  .quality-score-num { font-size: 2rem; font-weight: 700; line-height: 1; }
  .quality-score-denom { font-size: 0.85rem; color: #888; }
  .quality-score-label { font-size: 0.65rem; color: #888; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
  .quality-next-action { flex: 1; }
  .quality-next-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .quality-next-cmd { display: block; font-family: monospace; font-size: 0.95rem; color: #60a5fa; background: #0d1a2e; border: 1px solid #1e3a5f; border-radius: 6px; padding: 8px 14px; }
  /* Dimension bars */
  .dim-grid { display: flex; flex-direction: column; gap: 6px; margin-bottom: 24px; }
  .dim-row { display: grid; grid-template-columns: 180px 1fr 40px; align-items: center; gap: 10px; }
  .dim-label { font-size: 0.8rem; color: #ccc; white-space: nowrap; }
  .dim-track { background: #222; border-radius: 4px; height: 6px; overflow: hidden; }
  .dim-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .dim-num { font-size: 0.8rem; font-weight: 600; text-align: right; }
  /* P0 gaps */
  .p0-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
  .p0-item { display: grid; grid-template-columns: 180px 60px 1fr; align-items: center; gap: 12px; background: #1a0f0f; border: 1px solid #3a1515; border-radius: 6px; padding: 10px 14px; }
  .p0-dim { font-size: 0.85rem; color: #f87171; font-weight: 600; }
  .p0-score { font-size: 0.85rem; color: #888; }
  .p0-cmd { font-family: monospace; font-size: 0.8rem; color: #60a5fa; }
  .p0-clean { color: #4ade80; font-size: 0.85rem; margin-bottom: 24px; padding: 10px 14px; background: #0f1a0f; border: 1px solid #1a3a1a; border-radius: 6px; }
  code { font-family: monospace; }
</style>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>DanteForge Dashboard</title>${style}</head>
<body>
  <h1>DanteForge Dashboard</h1>
  <div class="subtitle">Project: ${escapeHtml(state.project)} | v${escapeHtml(packageVersion)} | Workflow Stage: ${escapeHtml(state.workflowStage)}</div>
  ${renderQualitySection(qualityScore)}
  <h2>System Metrics</h2>
  ${renderMetricGrid(input, executionWaveLabel, totalTasks, totalAuditEntries)}
  ${renderWikiSection(wikiHealth)}
  <h2>Recent Activity</h2>
  <table>
    <thead><tr><th>Timestamp</th><th>Action</th></tr></thead>
    <tbody>${timelineRows || '<tr><td colspan="2">No activity yet. Run: danteforge review</td></tr>'}</tbody>
  </table>
  <div class="footer">DanteForge v${escapeHtml(packageVersion)} | Auto-closes in 5 minutes | Refresh for latest data</div>
</body>
</html>`;
}

export async function dashboard(options: {
  port?: string;
  _loadState?: typeof loadState;
  _loadConfig?: typeof loadConfig;
  _computeScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
} = {}) {
  const loadFn = options._loadState ?? loadState;
  const loadConfigFn = options._loadConfig ?? loadConfig;
  const computeScoreFn = options._computeScore ?? computeHarshScore;

  return withErrorBoundary('dashboard', async () => {
  let port = 4242;
  try {
    port = parseDashboardPort(options.port);
  } catch (err) {
    process.exitCode = 1;
    logger.error(err instanceof Error ? err.message : String(err));
    return;
  }

  logger.info('Starting DanteForge Dashboard...');

  const cwd = process.cwd();
  const state = await loadFn();
  const config = await loadConfigFn();
  const host = detectHost();
  const capabilities = await detectMCPCapabilities(host);
  const tier = resolveTier(host, capabilities.hasFigmaMCP);
  const packageVersion = await loadPackageVersion();
  const totalTokensEstimated = estimateTokens(state.auditLog.join('\n'));

  // Quality score (best-effort — null if project not initialized)
  let qualityScore: HarshScoreResult | null = null;
  try {
    qualityScore = await computeScoreFn({ cwd });
  } catch {
    // Non-fatal — dashboard still renders without score section
  }

  // Wiki health (best-effort — null if wiki not initialized)
  let wikiHealth: WikiHealth | null = null;
  try {
    wikiHealth = await getWikiHealth({ cwd });
  } catch {
    // Non-fatal
  }

  const html = renderDashboardHtml({
    state,
    config,
    host,
    capabilities,
    tier,
    packageVersion,
    totalTokensEstimated,
    wikiHealth,
    qualityScore,
  });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(port, () => {
    logger.success(`Dashboard running at http://localhost:${port}`);
    logger.info('Auto-closes in 5 minutes. Press Ctrl+C to stop early.');
  });

  const autoClose = setTimeout(() => {
    server.close();
    logger.info('Dashboard auto-closed after 5 minutes');
  }, 5 * 60 * 1000);

  process.on('SIGINT', () => {
    clearTimeout(autoClose);
    server.close();
    logger.info('Dashboard stopped');
    process.exit(0);
  });
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
