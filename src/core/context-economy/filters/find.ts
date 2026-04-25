// find output filter — summarizes large file lists by directory, preserves permission errors.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'find';

const MAX_LINES_BEFORE_SUMMARY = 40;

function summarizeFind(output: string): string {
  const lines = output.split('\n').filter(Boolean);
  if (lines.length <= MAX_LINES_BEFORE_SUMMARY) return output;

  // Group by directory
  const dirMap = new Map<string, number>();
  for (const line of lines) {
    const parts = line.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    dirMap.set(dir, (dirMap.get(dir) ?? 0) + 1);
  }

  const topDirs = [...dirMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const summaryLines = [
    `find: ${lines.length} results (showing directory summary — full list omitted)`,
    ...topDirs.map(([dir, count]) => `  ${dir}/  (${count} file${count > 1 ? 's' : ''})`),
  ];

  if (dirMap.size > 15) {
    summaryLines.push(`  ... and ${dirMap.size - 15} more directories`);
  }

  return summaryLines.join('\n');
}

export const findFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, _args: string[]): boolean {
    return command === 'find';
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);
    const sacred = detectSacredSpans(output);

    const filtered = containsSacredContent(output)
      ? output
      : summarizeFind(output);

    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;
    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const hasSacred = containsSacredContent(output);
    const status = hasSacred ? 'sacred-bypass' : (savingsPercent < 10 ? 'low-yield' : 'filtered');

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};
