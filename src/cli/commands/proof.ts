import { runProof, generateProofReport } from '../../core/proof-engine.js';
import type { ProofEngineOptions, ProofReport, PipelineProofOptions, PipelineProofReport, ConvergenceProofOptions, ConvergenceProofReport } from '../../core/proof-engine.js';
import type { SemanticScoringOptions } from '../../core/pdse-semantic.js';
import type { ScoreHistoryEntry } from '../../core/state.js';

// ── Score Arc ─────────────────────────────────────────────────────────────────

export interface ScoreArcReport {
  before: number;
  after: number;
  gain: number;
  entries: ScoreHistoryEntry[];
  html: string;
  markdown: string;
}

/** Pure function — builds a score arc report from a slice of history entries. */
export function buildScoreArc(
  since: string,
  history: ScoreHistoryEntry[],
  currentScore: number,
): ScoreArcReport {
  // Find entries at or after `since` (supports ISO date prefix or git SHA)
  const sinceEntries = history.filter(e => {
    if (since.length <= 10) {
      // date-only prefix comparison (YYYY-MM-DD)
      return e.timestamp.slice(0, 10) >= since;
    }
    return e.gitSha === since || e.timestamp >= since;
  });

  const before = sinceEntries.length > 0
    ? sinceEntries[sinceEntries.length - 1].displayScore
    : currentScore;
  const after = currentScore;
  const gain = +(after - before).toFixed(2);

  const gainStr = gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1);
  const arrow = gain > 0.05 ? '▲' : gain < -0.05 ? '▼' : '─';

  const markdown = [
    `## Score Arc — since ${since}`,
    '',
    `| | Score |`,
    `|---|---|`,
    `| **Before** | ${before.toFixed(1)}/10 |`,
    `| **After** | ${after.toFixed(1)}/10 |`,
    `| **Gain** | ${arrow} ${gainStr} |`,
    '',
    `_${sinceEntries.length} measurement${sinceEntries.length !== 1 ? 's' : ''} in window_`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Score Arc</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px}
.card{border:1px solid #ddd;border-radius:8px;padding:20px;text-align:center}
.before{color:#888}.after{color:#2a7ae2;font-size:2em;font-weight:bold}
.gain{font-size:1.4em;color:${gain >= 0 ? '#27ae60' : '#c0392b'}}</style>
</head>
<body>
<h1>Score Arc — since ${since}</h1>
<div class="card">
  <p class="before">Before: ${before.toFixed(1)}/10</p>
  <p class="after">After: ${after.toFixed(1)}/10</p>
  <p class="gain">${arrow} ${gainStr}</p>
</div>
</body></html>`;

  return { before, after, gain, entries: sinceEntries, html, markdown };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProofCommandOptions {
  prompt?: string;
  pipeline?: boolean;
  convergence?: boolean;
  since?: string;
  cwd?: string;
  semantic?: boolean;
  _runProof?: (rawPrompt: string, opts?: ProofEngineOptions) => Promise<ProofReport>;
  _runPipelineProof?: (opts?: PipelineProofOptions) => Promise<PipelineProofReport>;
  _runConvergenceProof?: (opts?: ConvergenceProofOptions) => Promise<ConvergenceProofReport>;
  _loadScoreHistory?: (cwd: string) => Promise<{ history: ScoreHistoryEntry[]; currentScore: number }>;
  _stdout?: (line: string) => void;
  _semanticOpts?: SemanticScoringOptions;
}

export async function proof(options: ProofCommandOptions = {}): Promise<void> {
  const out = options._stdout ?? console.log;
  const cwd = options.cwd ?? process.cwd();

  if (options.since) {
    const loadHistory = options._loadScoreHistory ?? defaultLoadScoreHistory;
    const { history, currentScore } = await loadHistory(cwd);
    const arc = buildScoreArc(options.since, history, currentScore);
    for (const line of arc.markdown.split('\n')) {
      out(line);
    }
    return;
  }

  if (options.convergence) {
    const { runConvergenceProof } = await import('../../core/proof-engine.js');
    const runner = options._runConvergenceProof ?? runConvergenceProof;
    const report = await runner({ cwd: options.cwd });
    out(JSON.stringify(report, null, 2));
    return;
  }

  if (options.pipeline) {
    const { runPipelineProof } = await import('../../core/proof-engine.js');
    const runner = options._runPipelineProof ?? runPipelineProof;
    const report = await runner({ cwd: options.cwd });
    out(JSON.stringify(report, null, 2));
    return;
  }

  if (!options.prompt) {
    out('Usage: danteforge proof --prompt "Your raw prompt here"');
    out('       danteforge proof --pipeline');
    out('       danteforge proof --convergence');
    out('');
    out('Scores your raw prompt against DanteForge structured artifacts and shows the improvement.');
    out('Flags:');
    out('  --pipeline     Generate structured pipeline execution evidence report');
    out('  --convergence  Generate structured convergence & self-healing evidence report');
    out('  --semantic     Enhance PDSE scoring with LLM semantic assessment (requires LLM connection)');
    return;
  }

  const runner = options._runProof ?? runProof;
  const engineOpts: ProofEngineOptions = { cwd: options.cwd };

  if (options.semantic) {
    out('[semantic] LLM-enhanced scoring enabled');
  }

  const report = await runner(options.prompt, engineOpts);
  const reportText = generateProofReport(report);

  for (const line of reportText.split('\n')) {
    out(line);
  }
}

async function defaultLoadScoreHistory(cwd: string): Promise<{ history: ScoreHistoryEntry[]; currentScore: number }> {
  const { loadState } = await import('../../core/state.js');
  const { computeHarshScore } = await import('../../core/harsh-scorer.js');
  const [state, result] = await Promise.all([
    loadState({ cwd }),
    computeHarshScore({ cwd }),
  ]);
  return { history: state.scoreHistory ?? [], currentScore: result.displayScore };
}
