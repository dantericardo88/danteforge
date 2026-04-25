// ESLint output filter — keeps rule id/file/line/severity, collapses clean-file noise.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'eslint';

// ESLint output is essentially all signal — errors and warnings are sacred.
// We only strip cosmetic spacing and the trailing ✔ "no problems" banners.
const STRIP_PATTERNS: RegExp[] = [
  /^\s*$/,
  /^✔ 0 problems/,
  /^0 errors, 0 warnings/,
];

const SUPPORTED_SUBCOMMANDS: Set<string> = new Set();   // eslint has no subcommands

function keepLine(line: string): boolean {
  return !STRIP_PATTERNS.some((p) => p.test(line));
}

export const eslintFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, _args: string[]): boolean {
    return command === 'eslint' || command === 'npx eslint' || command === './node_modules/.bin/eslint';
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

    // All ESLint errors/warnings are sacred — never compress them away.
    const sacred = detectSacredSpans(output);
    const lines = output.split('\n').filter(keepLine);
    const filtered = lines.join('\n').trim();
    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;

    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const status = sacred.length > 0 ? 'sacred-bypass' : (savingsPercent < 10 ? 'low-yield' : 'filtered');

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};

// satisfy unused-import check
void SUPPORTED_SUBCOMMANDS;
