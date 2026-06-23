// command-suggest.ts - "Did you mean?" engine for unknown commands.
// Uses Levenshtein distance. No external dependencies.

/**
 * Compute the Levenshtein edit distance between two strings.
 * Classic Wagner-Fischer DP in O(m*n) time, O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep the shorter string as the row to minimise memory.
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const rowLen = a.length;
  let prev = Array.from({ length: rowLen + 1 }, (_, i) => i);
  let curr = new Array<number>(rowLen + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= rowLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,
        prev[i] + 1,
        prev[i - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[rowLen];
}

export interface CommandSuggestion {
  command: string;
  distance: number;
  confidence: number;
}

export interface CommandSuggestionOptions {
  limit?: number;
  maxDistanceRatio?: number;
}

function normalizeCommandToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function distanceRatio(input: string, candidate: string): { distance: number; ratio: number } {
  const distance = levenshteinDistance(input, candidate);
  const maxLen = Math.max(input.length, candidate.length, 1);
  return { distance, ratio: distance / maxLen };
}

/**
 * Return ranked command suggestions for typo recovery.
 *
 * Matching considers both literal command names and separator-free spellings, so
 * `time_machine` can recover `time-machine` without broadening unrelated typo
 * matches.
 */
export function findCommandSuggestions(
  input: string,
  knownCommands: string[],
  options: CommandSuggestionOptions = {},
): CommandSuggestion[] {
  if (knownCommands.length === 0) return [];

  const limit = Math.max(1, options.limit ?? 3);
  const maxDistanceRatio = options.maxDistanceRatio ?? 0.55;
  const lower = input.toLowerCase();
  const normalizedInput = normalizeCommandToken(input);
  const deduped = new Map<string, CommandSuggestion>();

  for (const command of knownCommands) {
    const commandLower = command.toLowerCase();
    if (lower === commandLower) {
      return [];
    }

    const literal = distanceRatio(lower, commandLower);
    const normalized = distanceRatio(normalizedInput, normalizeCommandToken(command));
    const best = literal.ratio <= normalized.ratio ? literal : normalized;

    if (best.ratio > maxDistanceRatio) continue;

    const suggestion: CommandSuggestion = {
      command,
      distance: best.distance,
      confidence: Number((1 - best.ratio).toFixed(4)),
    };
    const existing = deduped.get(commandLower);
    if (!existing || suggestion.confidence > existing.confidence) {
      deduped.set(commandLower, suggestion);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.command.length !== b.command.length) return a.command.length - b.command.length;
      return a.command.localeCompare(b.command);
    })
    .slice(0, limit);
}

/**
 * Find the closest known command to the user's input.
 *
 * Returns `null` when:
 *  - the input exactly matches a known command (no suggestion needed), or
 *  - the best match is more than 40% different from the input.
 */
export function findClosestCommand(
  input: string,
  knownCommands: string[],
): string | null {
  const suggestions = findCommandSuggestions(input, knownCommands, {
    limit: 1,
    maxDistanceRatio: 0.4,
  });

  return suggestions[0]?.command ?? null;
}

function formatGenericUnknownCommand(input: string): string {
  return `Unknown command "${input}". Run "danteforge --help" for available commands.`;
}

/**
 * Format a user-facing "did you mean?" message.
 *
 * @example
 * formatCommandSuggestion("foreg", "forge")
 * // -> 'Unknown command "foreg". Did you mean "forge"?'
 */
export function formatCommandSuggestion(
  input: string,
  suggestion: string,
): string {
  return `Unknown command "${input}". Did you mean "${suggestion}"?`;
}

/**
 * Format one or more ranked suggestions as runnable commands.
 */
export function formatCommandSuggestions(
  input: string,
  suggestions: string[],
): string {
  if (suggestions.length === 0) {
    return formatGenericUnknownCommand(input);
  }
  if (suggestions.length === 1) {
    return formatCommandSuggestion(input, suggestions[0]!);
  }

  return [
    `Unknown command "${input}". Did you mean one of these?`,
    ...suggestions.map((suggestion) => `  danteforge ${suggestion}`),
    'Run "danteforge --help" for the full command list.',
  ].join('\n');
}
