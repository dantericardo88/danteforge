// pnpm output filter — strips install/lifecycle noise, keeps failures and security warnings.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'pnpm';

const STRIP_PATTERNS: RegExp[] = [
  /^Packages:.*added/,
  /^Progress:/,
  /^Already up to date/,
  /^packages are looking for funding/,
  /^Resolving:/,
  /^Fetching:/,
  /^Linking:/,
  /^Done in /,
  /^\s+\d+\.\d+\s+[A-Za-z]/,         // lifecycle timing lines
  /^> .* install$/,
  /^> .* postinstall$/,
  /^> .* prepare$/,
];

const SUPPORTED_SUBCOMMANDS = new Set(['install', 'i', 'add', 'update', 'list', 'ls', 'outdated', 'test', 'run', 'audit', 'publish']);

export const pnpmFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    if (command !== 'pnpm') return false;
    const sub = args[0];
    return sub !== undefined && SUPPORTED_SUBCOMMANDS.has(sub);
  },

  filter(output: string, _command: string, _args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

    if (containsSacredContent(output)) {
      const sacred = detectSacredSpans(output);
      return { output, status: 'sacred-bypass', inputTokens, outputTokens: inputTokens, savedTokens: 0, savingsPercent: 0, sacredSpanCount: sacred.length, filterId: FILTER_ID };
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

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};
