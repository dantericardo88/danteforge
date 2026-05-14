// Actionable error engine — maps DanteForge error codes/messages to helpful suggestions.
// Used by CLI commands to surface next-step guidance instead of raw error dumps.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionableError {
  /** Short machine-readable code (e.g. ERR_NO_INIT, ERR_LLM_TIMEOUT). */
  code: string;
  /** Human-readable error message (may be the original error text). */
  message: string;
  /** Concrete next step the user should take. */
  suggestion: string;
  /** Optional documentation reference. */
  docsRef?: string;
}

// ---------------------------------------------------------------------------
// Pattern → suggestion map
// ---------------------------------------------------------------------------

/**
 * Map of error pattern substrings (lowercased) to actionable suggestions.
 * Entries are checked in order — first match wins.
 */
export const ERROR_SUGGESTIONS: Record<string, string> = {
  // Initialization
  'enoent .danteforge':
    'Run `danteforge init` to initialize the project in this directory.',
  'no state.yaml':
    'Run `danteforge init` to create the initial project state file.',
  'state.yaml not found':
    'Run `danteforge init` to create the initial project state file.',

  // Config
  'no config found':
    'Run `danteforge config --setup` to configure your LLM provider (or use `--provider ollama` for local inference).',
  'config not found':
    'Run `danteforge config --setup` to configure your LLM provider.',
  'config.yaml missing':
    'Run `danteforge config --setup` to create your global configuration.',
  'missing api key':
    'Set your API key with `danteforge config --setup`, or use `--provider ollama` for local inference.',
  'invalid api key':
    'Check your API key with `danteforge config --show`. Rotate the key if needed.',

  // Constitution / spec / plan / tasks
  'no constitution':
    'Run `danteforge constitution` to create your CONSTITUTION.md, then re-run the command.',
  'constitution not found':
    'Run `danteforge constitution` to create your CONSTITUTION.md.',
  'constitution.md missing':
    'Run `danteforge constitution` to create your CONSTITUTION.md.',
  'no spec found':
    'Run `danteforge specify` to write a project spec before planning or forging.',
  'spec not found':
    'Run `danteforge specify` to write a project spec.',
  'spec.md missing':
    'Run `danteforge specify` to create your SPEC.md file.',
  'no plan found':
    'Run `danteforge plan` to generate an implementation plan before creating tasks.',
  'plan not found':
    'Run `danteforge plan` to generate your PLAN.md.',
  'no tasks found':
    'Run `danteforge tasks` to break your plan into executable tasks.',
  'tasks not found':
    'Run `danteforge tasks` to generate TASKS.md from your plan.',

  // LLM / provider errors
  'llm timeout':
    'Try a lighter model with `--provider ollama` or use `--prompt` flag to copy-paste the prompt manually.',
  'timeout':
    'The LLM call timed out. Try `--provider ollama` for local inference, or add `--timeout 120000` to extend the limit.',
  'rate limit':
    'You have hit the provider rate limit. Wait ~60 seconds, then retry. Alternatively use `--provider ollama` for local inference.',
  'rate_limit':
    'You have hit the provider rate limit. Wait ~60 seconds, then retry.',
  '429':
    'Too many requests (HTTP 429). Wait 60 seconds and try again, or switch to `--provider ollama`.',
  '503':
    'Provider service is unavailable (HTTP 503). Try again in a moment, or switch providers with `--provider ollama`.',
  'connection refused':
    'Cannot connect to the LLM provider. If using Ollama, ensure it is running: `ollama serve`.',
  'econnrefused':
    'Connection refused. If using Ollama, start it with: `ollama serve`. For cloud providers, check your network.',
  'model not found':
    'The specified model does not exist. Run `ollama list` to see available models, or specify a different one with `--model`.',
  'no model':
    'No LLM model configured. Set one with `danteforge config --setup` or pass `--provider ollama`.',

  // Gates
  'gate failed':
    'A quality gate blocked the command. Run `danteforge verify` to see failing checks, or use `--light` to bypass gates.',
  'gate:':
    'A hard gate is blocking progress. Check `.danteforge/STATE.yaml` for the gate status, or run with `--light` to skip.',
  'tests must pass':
    'Run `npm test` (or your test command) and fix failing tests before proceeding.',
  'no tests found':
    'Add tests before forging. Run `danteforge tasks` to generate TDD tasks, or use `--light` to skip the tests gate.',

  // Build / compile
  'typescript error':
    'Fix TypeScript errors before building. Run `npm run typecheck` to see all errors.',
  'tsc error':
    'TypeScript compilation failed. Run `npm run typecheck` for the full error list.',
  'build failed':
    'The build failed. Run `npm run build` to see the detailed error, then fix and retry.',
  'compilation error':
    'Compilation failed. Run `npm run build` to see details.',

  // File / permissions
  'permission denied':
    'Permission denied. Check file/directory ownership, or run with elevated privileges if appropriate.',
  'eacces':
    'Access denied. Check that you have write permissions in this directory.',
  'disk full':
    'Disk is full. Free up space and retry.',
  'enospc':
    'No space left on device. Free up disk space and retry.',

  // Worktree
  'worktree':
    'Git worktree issue detected. Run `git worktree list` to inspect and `git worktree prune` to clean up stale entries.',

  // Anti-stub
  'stub detected':
    'Stub or TODO-only implementation found. Fill in the implementation before merging.',
  'anti-stub':
    'Stub check failed. Real implementations are required — replace TODO/placeholder code.',

  // Generic fallback (checked last)
  'error':
    'An unexpected error occurred. Run with `--debug` for more detail, or check `.danteforge/audit.log`.',
};

// ---------------------------------------------------------------------------
// Pattern matcher
// ---------------------------------------------------------------------------

const PATTERN_ENTRIES = Object.entries(ERROR_SUGGESTIONS);

function matchPattern(text: string): { key: string; suggestion: string } | undefined {
  const lower = text.toLowerCase();
  for (const [pattern, suggestion] of PATTERN_ENTRIES) {
    if (lower.includes(pattern)) {
      return { key: pattern, suggestion };
    }
  }
  return undefined;
}

function deriveCode(pattern: string): string {
  return (
    'ERR_' +
    pattern
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40)
  );
}

// ---------------------------------------------------------------------------
// Docs references
// ---------------------------------------------------------------------------

const DOCS_REFS: Record<string, string> = {
  'enoent .danteforge': 'https://github.com/dantericardo88/danteforge#getting-started',
  'no config found': 'https://github.com/dantericardo88/danteforge#configuration',
  'no constitution': 'https://github.com/dantericardo88/danteforge#constitution',
  'no spec found': 'https://github.com/dantericardo88/danteforge#specify',
  'rate limit': 'https://github.com/dantericardo88/danteforge#llm-providers',
  'llm timeout': 'https://github.com/dantericardo88/danteforge#llm-providers',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enrich a raw error with a human-readable suggestion and a stable error code.
 *
 * @param err - The original error (Error instance or string message).
 * @param context - Optional context (command being run, working directory).
 */
export function enrichError(
  err: Error | string,
  context?: { command?: string; cwd?: string },
): ActionableError {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const combined = [
    rawMessage,
    err instanceof Error && err.cause instanceof Error ? err.cause.message : '',
    context?.command ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const match = matchPattern(combined);

  if (match) {
    return {
      code: deriveCode(match.key),
      message: rawMessage,
      suggestion: match.suggestion,
      docsRef: DOCS_REFS[match.key],
    };
  }

  // Generic fallback
  return {
    code: 'ERR_UNKNOWN',
    message: rawMessage,
    suggestion:
      'An unexpected error occurred. Run with `--debug` for more detail, or check `.danteforge/audit.log`.',
  };
}

/**
 * Format an ActionableError as a CLI-friendly string.
 * Suitable for printing directly to stderr.
 */
export function formatActionableError(ae: ActionableError): string {
  const lines: string[] = [
    `Error [${ae.code}]: ${ae.message}`,
    `  → ${ae.suggestion}`,
  ];
  if (ae.docsRef) {
    lines.push(`  Docs: ${ae.docsRef}`);
  }
  return lines.join('\n');
}
