// TypeScript compiler output filter — strips header/footer boilerplate,
// keeps all error and warning lines (which are always sacred).

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'tsc';

// Lines that carry no diagnostic value and can be stripped safely
const STRIP_PATTERNS: RegExp[] = [
  /^Version \d+\.\d+\.\d+/,
  /^Starting compilation in watch mode/,
  /^\[.*\] Starting compilation/,
  /^\[.*\] Found 0 errors\./,
  /^\[.*\] Watching for file changes\./,
  /^$/,  // blank lines emitted during watch mode
];

// Package managers that forward args to tsc when invoked as `<pm> tsc`
const TSC_FORWARDING_PMS = new Set(['npx', 'pnpm', 'yarn']);

export const tscFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    // Direct `tsc` invocation
    if (command === 'tsc') return true;
    // node_modules/.bin/tsc (Unix or Windows path separator)
    if (command.endsWith('/tsc') || command.endsWith('\\tsc')) return true;
    // Package-manager forwarding: `npx tsc`, `pnpm tsc`, `yarn tsc`
    // Production parsing splits these as command='npx'|'pnpm'|'yarn', args[0]='tsc'
    if (TSC_FORWARDING_PMS.has(command) && args[0] === 'tsc') return true;
    return false;
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

    // If output has sacred content (actual errors/warnings), bypass to preserve them
    if (containsSacredContent(output)) {
      const sacred = detectSacredSpans(output);
      return {
        output,
        status: 'sacred-bypass',
        inputTokens,
        outputTokens: inputTokens,
        savedTokens: 0,
        savingsPercent: 0,
        sacredSpanCount: sacred.length,
        filterId: FILTER_ID,
      };
    }

    const lines = output.split('\n');
    const kept = lines.filter((line) => !STRIP_PATTERNS.some((p) => p.test(line)));
    const filtered = kept.join('\n').trim();

    const sacred = detectSacredSpans(output);
    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;
    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const status = savingsPercent < 10 ? 'low-yield' : 'filtered';

    return {
      output: finalOutput,
      status,
      inputTokens,
      outputTokens,
      savedTokens,
      savingsPercent,
      sacredSpanCount: sacred.length,
      filterId: FILTER_ID,
    };
  },
};
