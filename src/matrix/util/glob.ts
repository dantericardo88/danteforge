// Matrix Kernel — Shared glob-matcher utility.
//
// Single source of truth for the glob-to-regex pattern used across the Matrix
// engines and courts (project-graph, ownership-map, lease-manager, conflict-radar,
// verification-court, work-packet-generator). Replaces five duplicate
// implementations.
//
// Glob syntax supported (minimal subset, deliberately):
//   - `*`   matches any sequence of characters EXCEPT path separators
//   - `**`  matches any sequence including path separators (recursive)
//   - All other characters are matched literally
//
// Paths are normalized to forward slashes before matching so Windows paths
// and POSIX paths compare consistently.

/**
 * Convert a glob pattern to a `RegExp`. Patterns are anchored (`^...$`).
 *
 * Escapes regex metacharacters first, then expands `*` and `**` into the
 * appropriate regex fragments.
 */
export function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Test whether a file path matches a single glob pattern.
 * Both path and glob are normalized to forward slashes before comparison.
 */
export function matchesGlob(filePath: string, glob: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return globToRegex(glob).test(normalized);
}

/**
 * Test whether a file path matches ANY glob in the provided list.
 * Returns true on the first match. Short-circuits.
 */
export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  if (globs.length === 0) return false;
  const normalized = filePath.replace(/\\/g, '/');
  for (const g of globs) {
    if (globToRegex(g).test(normalized)) return true;
  }
  return false;
}
