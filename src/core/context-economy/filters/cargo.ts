// Cargo output filter — strips build noise, keeps compiler errors/warnings/panics/failing tests.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'cargo';

const STRIP_PATTERNS: RegExp[] = [
  /^\s*Compiling\s/,
  /^\s*Downloading\s/,
  /^\s*Fetching\s/,
  /^\s*Updating\s/,
  /^\s*Locking\s/,
  /^\s*Packaging\s/,
  /^\s*Verifying\s/,
  /^\s*Documenting\s/,
  /^\s*Running `rustfmt/,
  /^\s*Fresh\s/,
  /^\s*test \S+ \.\.\. ok$/,         // passing test lines
  /^\s*running \d+ tests?$/,
];

const SUPPORTED_SUBCOMMANDS = new Set(['build', 'test', 'check', 'clippy', 'run', 'fmt', 'audit']);

export const cargoFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    if (command !== 'cargo') return false;
    const sub = args[0];
    return sub !== undefined && SUPPORTED_SUBCOMMANDS.has(sub);
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

    const sacred = detectSacredSpans(output);
    const lines = output.split('\n').filter((l) => !STRIP_PATTERNS.some((p) => p.test(l)));
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
