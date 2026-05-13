// Host AI detection — identify whether DanteForge is being invoked from
// inside Claude Code, Codex, or a plain terminal. Used by the matrix-kernel
// to switch run-wave dispatch into "embedded mode" so a host AI doesn't
// spawn a sibling subprocess of itself (which would double-bill the same
// subscription and duplicate context).

export type HostAI = 'claude' | 'codex' | null;

export interface HostDetectionOptions {
  /** Injection seam: replaces process.env for tests. */
  _env?: NodeJS.ProcessEnv;
}

/**
 * Detect which host AI (if any) is invoking the current process.
 *
 * Signals (all injected by the host into the child process):
 *   - Claude Code → `CLAUDE_PLUGIN_ROOT`
 *   - Codex      → `CODEX_SESSION` / `CODEX` / `CODEX_ENV`
 *
 * Returns `null` for plain terminal invocations.
 */
export function detectHostAI(options: HostDetectionOptions = {}): HostAI {
  const env = options._env ?? process.env;
  if (env.CLAUDE_PLUGIN_ROOT) return 'claude';
  if (env.CODEX_SESSION || env.CODEX || env.CODEX_ENV) return 'codex';
  return null;
}

/** Convenience for adapter routing: "should we run embedded?" */
export function isEmbeddedInHost(options: HostDetectionOptions = {}): boolean {
  return detectHostAI(options) !== null;
}
