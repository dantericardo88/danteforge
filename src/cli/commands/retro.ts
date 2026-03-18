// Retro command — project retrospective with metrics, delta scoring, trend tracking.
// No PII — no author names or emails in output.
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { runRetro, writeRetroFiles, loadPriorRetro } from '../../core/retro-engine.js';

export async function retro(options: { summary?: boolean; cwd?: string } = {}) {
  const cwd = options.cwd ?? process.cwd();

  if (options.summary) {
    await printRetroSummary(cwd);
    return;
  }

  logger.info('Running project retrospective...');

  const report = await runRetro(cwd);
  const retroDir = path.join(cwd, '.danteforge', 'retros');
  const { jsonPath, mdPath } = await writeRetroFiles(report, retroDir);

  logger.success(`\nRetro Score: ${report.score}/100`);
  if (report.delta !== null) {
    const arrow = report.delta > 0 ? '↑' : report.delta < 0 ? '↓' : '→';
    logger.info(`Delta: ${arrow} ${report.delta > 0 ? '+' : ''}${report.delta} from prior retro`);
  }

  logger.info('');
  logger.info('Praise:');
  for (const item of report.praise) logger.info(`  + ${item}`);
  logger.info('');
  logger.info('Growth Areas:');
  for (const item of report.growthAreas) logger.info(`  - ${item}`);

  logger.info(`\nJSON: ${jsonPath}`);
  logger.info(`Markdown: ${mdPath}`);

  // Update state
  try {
    const state = await loadState({ cwd });
    state.retroDelta = report.delta ?? 0;
    state.retroLastRun = report.timestamp;
    state.auditLog.push(
      `${report.timestamp} | retro: score ${report.score}/100${report.delta !== null ? ` (delta: ${report.delta > 0 ? '+' : ''}${report.delta})` : ''}`,
    );
    await saveState(state, { cwd });
  } catch {
    // State save is best-effort
  }
}

async function printRetroSummary(cwd: string): Promise<void> {
  const retroDir = path.join(cwd, '.danteforge', 'retros');
  try {
    const entries = await fs.readdir(retroDir);
    const jsonFiles = entries
      .filter(e => e.startsWith('retro-') && e.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 5);

    if (jsonFiles.length === 0) {
      logger.info('No retros found. Run "danteforge retro" first.');
      return;
    }

    logger.info('\n=== Retro Trend Summary ===\n');
    for (const file of jsonFiles.reverse()) {
      const content = await fs.readFile(path.join(retroDir, file), 'utf8');
      const report = JSON.parse(content) as { score: number; delta: number | null; timestamp: string };
      const arrow = report.delta === null ? ' ' : report.delta > 0 ? '↑' : report.delta < 0 ? '↓' : '→';
      logger.info(`  ${report.timestamp.slice(0, 10)} | Score: ${String(report.score).padStart(3)} | ${arrow} ${report.delta !== null ? String(report.delta > 0 ? '+' : '') + report.delta : 'n/a'}`);
    }
  } catch {
    logger.info('No retros found. Run "danteforge retro" first.');
  }
}
