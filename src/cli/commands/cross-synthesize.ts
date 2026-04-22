// cross-synthesize — Synthesize across attribution history to find what actually worked.
// Reads causal attribution log, finds patterns with positive lagging deltas,
// and generates a CROSS_SYNTHESIS.md: a prioritized action plan for escaping a plateau.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { callLLM } from '../../core/llm.js';
import { loadAttributionLog, type AttributionRecord } from '../../core/causal-attribution.js';

const STATE_DIR = '.danteforge';

export interface CrossSynthesizeOptions {
  cwd?: string;
  window?: number;          // lookback window in record count (default: 10)
  _loadAttribution?: () => Promise<AttributionRecord[]>;
  _loadUPR?: () => Promise<string | null>;
  _callLLM?: (prompt: string) => Promise<string>;
  _writeReport?: (content: string) => Promise<void>;
}

export interface CrossSynthesizeResult {
  written: boolean;
  reportPath: string;
  patternsAnalyzed: number;
  winnersFound: number;
}

export async function runCrossSynthesize(options: CrossSynthesizeOptions = {}): Promise<CrossSynthesizeResult> {
  const cwd = options.cwd ?? process.cwd();
  const reportPath = path.join(cwd, STATE_DIR, 'CROSS_SYNTHESIS.md');
  const window = options.window ?? 10;

  const loadAttribution = options._loadAttribution ?? (async () => {
    const log = await loadAttributionLog(cwd);
    return log.records;
  });

  const loadUPR = options._loadUPR ?? (async () => {
    try { return await fs.readFile(path.join(cwd, STATE_DIR, 'UPR.md'), 'utf8'); } catch { return null; }
  });

  const callLlm = options._callLLM ?? callLLM;

  const writeReport = options._writeReport ?? (async (content: string) => {
    await fs.mkdir(path.join(cwd, STATE_DIR), { recursive: true });
    await fs.writeFile(reportPath, content, 'utf8');
  });

  // Load and filter attribution records
  const allRecords = await loadAttribution();
  const recent = allRecords.slice(-window);
  const patternsAnalyzed = recent.length;

  if (patternsAnalyzed === 0) {
    logger.info('No attribution records found. Run `danteforge outcome-check` after adopting patterns to build the log.');
    return { written: false, reportPath, patternsAnalyzed: 0, winnersFound: 0 };
  }

  // Find winners: verified patterns with positive score delta
  const winners = recent.filter(r =>
    r.verifyStatus === 'pass' && r.scoreDelta > 0
  );
  const winnersFound = winners.length;

  const [upr] = await Promise.all([loadUPR()]);

  // Build prompt
  const winnerLines = winners.length > 0
    ? winners.map(r =>
        `- **${r.patternName}** (from ${r.sourceRepo}): +${r.scoreDelta.toFixed(2)} score delta` +
        (r.outcomeHypothesis ? ` — "${r.outcomeHypothesis}"` : '')
      ).join('\n')
    : '(No patterns with verified positive deltas found in the last window)';

  const loserLines = recent
    .filter(r => r.verifyStatus === 'fail' || r.scoreDelta <= 0)
    .map(r => `- ${r.patternName}: ${r.scoreDelta.toFixed(2)} delta, status: ${r.verifyStatus}`)
    .join('\n') || '(none)';

  const prompt = [
    'You are analyzing a project quality improvement history to identify what worked and create an action plan.',
    '',
    '## PATTERNS THAT WORKED (positive score delta, verify passed)',
    winnerLines,
    '',
    '## PATTERNS THAT DID NOT WORK',
    loserLines,
    '',
    upr ? `## PROJECT CONTEXT (from UPR.md)\n${upr.slice(0, 2000)}\n` : '',
    '## YOUR TASK',
    'Generate a CROSS_SYNTHESIS.md with:',
    '1. **What actually worked** — the key patterns and why they helped',
    '2. **Common threads** — what the winning patterns have in common',
    '3. **Prioritized next actions** — specific steps to continue improving, building on what worked',
    '4. **What to avoid** — patterns to not revisit based on the failures',
    '',
    'Be concrete and actionable. Output ONLY the markdown — no preamble.',
  ].filter(Boolean).join('\n');

  logger.info(`Analyzing ${patternsAnalyzed} patterns (${winnersFound} winners)...`);

  try {
    const report = await callLlm(prompt);
    await writeReport(report);

    logger.success(`CROSS_SYNTHESIS.md written (${winnersFound}/${patternsAnalyzed} patterns contributed).`);
    logger.info(`Report: ${reportPath}`);
    logger.info('Next: review the synthesis, then run `danteforge respec` or `danteforge forge` to act on it.');

    return { written: true, reportPath, patternsAnalyzed, winnersFound };
  } catch (err) {
    logger.error(`cross-synthesize failed: ${err instanceof Error ? err.message : String(err)}`);
    return { written: false, reportPath, patternsAnalyzed, winnersFound: 0 };
  }
}
