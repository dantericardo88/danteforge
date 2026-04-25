// Docker output filter — compacts ps/images/logs, preserves container failures and security warnings.

import { estimateTokens } from '../../token-estimator.js';
import { detectSacredSpans, containsSacredContent, injectSacredSpans } from '../sacred-content.js';
import type { CommandFilter, FilterResult } from '../types.js';

const FILTER_ID = 'docker';

const STRIP_PATTERNS: RegExp[] = [
  /^Sending build context/,
  /^Step \d+\/\d+/,
  /^ ---> (Using cache|[a-f0-9]{12})/,
  /^Successfully built/,
  /^Successfully tagged/,
  /^\[internal\]/,
  /^=+> \[/,                         // buildkit layer headers
  /^\s+\d+\.\d+ [A-Z]/,             // buildkit timing lines
  /^REPOSITORY\s+TAG\s+IMAGE ID/,   // images header (kept if content follows, stripped alone)
];

const SUPPORTED_SUBCOMMANDS = new Set(['ps', 'images', 'logs', 'build', 'run', 'exec', 'inspect', 'pull', 'push', 'rm', 'rmi', 'stop', 'start', 'network', 'volume']);

function truncateLogs(output: string, maxLines = 50): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return output;
  const head = lines.slice(0, 10);
  const tail = lines.slice(-40);
  head.push(`... (${lines.length - 50} lines omitted — use docker logs --tail N for more)`);
  return [...head, ...tail].join('\n');
}

export const dockerFilter: CommandFilter = {
  filterId: FILTER_ID,

  detect(command: string, args: string[]): boolean {
    if (command !== 'docker' && command !== 'docker-compose' && command !== 'docker compose') return false;
    const sub = args[0];
    return sub !== undefined && SUPPORTED_SUBCOMMANDS.has(sub);
  },

  filter(output: string, _command: string, args: string[]): FilterResult {
    const inputTokens = estimateTokens(output);
    const sacred = detectSacredSpans(output);

    const sub = args[0] ?? '';
    let filtered: string;
    if (sub === 'logs') {
      filtered = truncateLogs(output);
    } else {
      const lines = output.split('\n').filter((l) => !STRIP_PATTERNS.some((p) => p.test(l)));
      filtered = lines.join('\n').trim();
    }

    const finalOutput = sacred.length > 0 ? injectSacredSpans(filtered, sacred) : filtered;
    const outputTokens = estimateTokens(finalOutput);
    const savedTokens = Math.max(0, inputTokens - outputTokens);
    const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
    const hasSacred = containsSacredContent(output);
    const status = hasSacred ? 'sacred-bypass' : (savingsPercent < 10 ? 'low-yield' : 'filtered');

    return { output: finalOutput, status, inputTokens, outputTokens, savedTokens, savingsPercent, sacredSpanCount: sacred.length, filterId: FILTER_ID };
  },
};
