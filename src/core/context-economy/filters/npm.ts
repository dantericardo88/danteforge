// npm output filter — strips install progress, keeps failures and audit findings.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'npm';

const STRIP_PATTERNS: RegExp[] = [
  /^npm notice/,
  /^npm warn.*deprecated/i,
  /^npm http fetch/,
  /^added \d+ packages/,
  /^changed \d+ packages/,
  /^removed \d+ packages/,
  /^found \d+ vulnerabilities/,
  /^up to date/,
  /^audited \d+ packages/,
  /^\s*\d+ packages are looking for funding/,
  /^npm fund/,
  /^\d+\.\d+s/,
  /^Downloading/,
  /^Extracting/,
  /^Linking/,
];

const SUPPORTED_SUBCOMMANDS = new Set(['install', 'i', 'ci', 'update', 'list', 'ls', 'outdated', 'test', 'run', 'audit', 'pack', 'publish']);

export const npmFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    if (command !== 'npm') return false;
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
