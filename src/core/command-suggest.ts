// command-suggest.ts — "Did you mean?" engine for unknown commands.
// Uses Levenshtein distance. No external dependencies.
// -----------------------------------------------------------------------

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
        curr[i - 1] + 1,        // insertion
        prev[i] + 1,             // deletion
        prev[i - 1] + cost,      // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[rowLen];
}

/**
 * Find the closest known command to the user's input.
 *
 * Returns `null` when:
 *  - the input exactly matches a known command (no suggestion needed), or
 *  - the best match is more than 40 % different from the input
 *    (threshold: distance / max(input.length, match.length) > 0.4).
 */
export function findClosestCommand(
  input: string,
  knownCommands: string[],
): string | null {
  if (knownCommands.length === 0) return null;

  const lower = input.toLowerCase();

  let bestCommand = '';
  let bestDist = Infinity;

  for (const cmd of knownCommands) {
    const dist = levenshteinDistance(lower, cmd.toLowerCase());
    if (dist === 0) {
      // Exact match — caller already knows the command; no suggestion needed.
      return null;
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestCommand = cmd;
    }
  }

  // Reject suggestions where the strings are too dissimilar.
  const maxLen = Math.max(lower.length, bestCommand.length);
  const similarity = bestDist / maxLen;
  if (similarity > 0.4) return null;

  return bestCommand;
}

/**
 * Format a user-facing "did you mean?" message.
 *
 * @example
 * formatCommandSuggestion("foreg", "forge")
 * // → 'Unknown command "foreg". Did you mean "forge"?'
 */
export function formatCommandSuggestion(
  input: string,
  suggestion: string,
): string {
  return `Unknown command "${input}". Did you mean "${suggestion}"?`;
}
