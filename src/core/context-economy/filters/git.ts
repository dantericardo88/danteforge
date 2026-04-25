// Git output filter — strips routine boilerplate, preserves hunks and sacred content.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'git';

const STRIP_PATTERNS: RegExp[] = [
  /^hint:.*/,
  /^remote:\s*$/,
  /^remote:\s+Enumerating objects:/,
  /^remote:\s+Counting objects:/,
  /^remote:\s+Compressing objects:/,
  /^remote:\s+Total/,
  /^Receiving objects:/,
  /^Resolving deltas:/,
  /^Unpacking objects:/,
  /^Already up to date\./,
  /^Everything up-to-date/,
  /^Your branch is up to date with/,
  /^nothing to commit/,
  /^nothing added to commit/,
  /^\s*\(use "git /,
  /^\s*\(no files/,
];

const SUPPORTED_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'fetch', 'pull', 'push', 'clone', 'branch', 'stash']);

function filterLines(lines: string[]): string[] {
  return lines.filter((line) => !STRIP_PATTERNS.some((p) => p.test(line)));
}

function compactLog(output: string): string {
  // Collapse long oneline log to last 20 entries summary
  const lines = output.split('\n');
  if (lines.length > 30) {
    const kept = lines.slice(0, 20);
    kept.push(`... (${lines.length - 20} more commits — use git log for full history)`);
    return kept.join('\n');
  }
  return output;
}

export const gitFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    if (command !== 'git') return false;
    const sub = args[0];
    return sub !== undefined && SUPPORTED_SUBCOMMANDS.has(sub);
  },

  filter(output: string, _command: string, args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);

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

    const sub = args[0] ?? '';
    let filtered: string;
    if (sub === 'log') {
      filtered = compactLog(output);
    } else {
      filtered = filterLines(output.split('\n')).join('\n').trim();
    }

    const sacred = detectSacredSpans(output);
    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;
    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const status = savingsPercent < 10 ? 'low-yield' : 'filtered';

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};
