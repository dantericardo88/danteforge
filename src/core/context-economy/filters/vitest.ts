// Vitest output filter — keeps failing suites/diffs/unhandled errors, compacts pass noise.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'vitest';

const STRIP_PASS_PATTERNS: RegExp[] = [
  /^\s*✓\s/,
  /^\s*✔\s/,
  /^\s*PASS\s/,
  /^Test Files\s+\d+ passed/,
  /^Tests\s+\d+ passed/,
  /^Duration\s+[\d.]+/,
  /^\s*\[vite\]/,
  /^ {2}✓ /,
];

export const vitestFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, _args: string[]): boolean {
    return command === 'vitest'
      || command === 'npx vitest'
      || command === './node_modules/.bin/vitest';
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

    const sacred = detectSacredSpans(output);
    const lines = output.split('\n').filter((l) => !STRIP_PASS_PATTERNS.some((p) => p.test(l)));
    const filtered = lines.join('\n').trim();
    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;

    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const hasSacred = containsSacredContent(output);
    const status = hasSacred ? 'sacred-bypass' : (savingsPercent < 10 ? 'low-yield' : 'filtered');

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};
