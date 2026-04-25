// Jest output filter — keeps failing suites/diffs/stack snippets, compacts pass summary.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'jest';

const STRIP_PASS_PATTERNS: RegExp[] = [
  /^\s*✓\s/,
  /^\s*✔\s/,
  /^\s*√\s/,
  /^\s*PASS\s/,
  /^Test Suites:\s+\d+ passed/,
  /^Tests:\s+\d+ passed/,
  /^Snapshots:\s+\d+ (passed|written)/,
  /^Time:\s+[\d.]+ s/,
  /^Ran all test suites/,
  /^\s*at Object\.<anonymous>/,
];

export const jestFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    return command === 'jest'
      || command === 'npx jest'
      || (command === 'npm' && (args[1] === 'test' || args[0] === 'test'))
      || command === './node_modules/.bin/jest';
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

    if (containsSacredContent(output)) {
      const sacred = detectSacredSpans(output);
      const lines = output.split('\n').filter((l) => !STRIP_PASS_PATTERNS.some((p) => p.test(l)));
      const filtered = lines.join('\n').trim();
      const finalOutput = injectSacredSpans(filtered, sacred);
      const outputTokens = estimateTokens(finalOutput);
      const savedTokens = Math.max(0, inputTokens - outputTokens);
      const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
      return { output: finalOutput, status: 'sacred-bypass', inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
    }

    const lines = output.split('\n').filter((l) => !STRIP_PASS_PATTERNS.some((p) => p.test(l)));
    const filtered = lines.join('\n').trim();
    const sacred = detectSacredSpans(output);
    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;
    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const status = savingsPercent < 10 ? 'low-yield' : 'filtered';

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};
