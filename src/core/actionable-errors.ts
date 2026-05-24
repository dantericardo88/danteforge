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
 *
 * Canonical error codes (ERR_*) are derived from the key by deriveCode().
 * Keep entries alphabetically grouped by domain.
 */
export const ERROR_SUGGESTIONS: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  'enoent .danteforge':
    'Run `danteforge init` to initialize the project in this directory.',
  'no state.yaml':
    'Run `danteforge init` to create the initial project state file.',
  'state.yaml not found':
    'Run `danteforge init` to create the initial project state file.',

  // ---------------------------------------------------------------------------
  // State integrity — ERR_STATE_CORRUPT
  // ---------------------------------------------------------------------------
  'state.yaml is not valid yaml':
    '[ERR_STATE_CORRUPT] STATE.yaml has invalid YAML syntax. Backup and reset: `cp .danteforge/STATE.yaml .danteforge/STATE.yaml.bak && danteforge init`.',
  'state file corrupted':
    '[ERR_STATE_CORRUPT] STATE.yaml is corrupted. Run `danteforge init` to recreate it, or restore from a Time Machine snapshot.',
  'state corrupt':
    '[ERR_STATE_CORRUPT] Project state is corrupt. Run `danteforge convergence-health` for diagnostics, then `danteforge init` to reset.',

  // ---------------------------------------------------------------------------
  // Config — ERR_CONFIG_MISSING
  // ---------------------------------------------------------------------------
  'no config found':
    '[ERR_CONFIG_MISSING] Run `danteforge config --setup` to configure your LLM provider (or use `--provider ollama` for local inference).',
  'config not found':
    '[ERR_CONFIG_MISSING] Run `danteforge config --setup` to configure your LLM provider.',
  'config.yaml missing':
    '[ERR_CONFIG_MISSING] Run `danteforge config --setup` to create your global configuration at `~/.danteforge/config.yaml`.',
  'config.yaml not found':
    '[ERR_CONFIG_MISSING] Configuration file missing. Run `danteforge config --setup` to create it.',
  'missing api key':
    'Set your API key with `danteforge config --setup`, or use `--provider ollama` for local inference.',
  'invalid api key':
    'Check your API key with `danteforge config --show`. Rotate the key if needed.',

  // ---------------------------------------------------------------------------
  // Constitution / spec / plan / tasks
  // ---------------------------------------------------------------------------
  'no constitution':
    'Run `danteforge constitution` to create your CONSTITUTION.md, then re-run the command.',
  'constitution not found':
    'Run `danteforge constitution` to create your CONSTITUTION.md.',
  'constitution.md missing':
    'Run `danteforge constitution` to create your CONSTITUTION.md.',
  'no spec found':
    '[ERR_NO_SPEC] Run `danteforge specify` to write a project spec before planning or forging.',
  'spec not found':
    '[ERR_NO_SPEC] Run `danteforge specify` to write a project spec.',
  'spec.md missing':
    '[ERR_NO_SPEC] No SPEC.md found. Run `danteforge specify "your idea"` to create one.',
  'no plan found':
    'Run `danteforge plan` to generate an implementation plan before creating tasks.',
  'plan not found':
    'Run `danteforge plan` to generate your PLAN.md.',
  'no tasks found':
    '[ERR_NO_TESTS] Add tests before forging. Run `danteforge tasks` to generate TDD tasks, or use `--light` to skip the tests gate.',
  'tasks not found':
    'Run `danteforge tasks` to generate TASKS.md from your plan.',

  // ---------------------------------------------------------------------------
  // LLM — ERR_LLM_TIMEOUT
  // ---------------------------------------------------------------------------
  'llm timeout':
    '[ERR_LLM_TIMEOUT] LLM call timed out. Try `--provider ollama` for local inference, or use `--prompt` to copy-paste the prompt manually.',
  'request timed out':
    '[ERR_LLM_TIMEOUT] Request timed out. Use `--timeout 120000` to extend the limit, or switch to `--provider ollama`.',
  'timeout':
    'The LLM call timed out. Try `--provider ollama` for local inference, or add `--timeout 120000` to extend the limit.',

  // ---------------------------------------------------------------------------
  // LLM — ERR_LLM_RATE_LIMIT
  // ---------------------------------------------------------------------------
  'rate limit':
    '[ERR_LLM_RATE_LIMIT] Provider rate limit hit. Wait ~60 seconds and retry, or use `--provider ollama` for unlimited local inference.',
  'rate_limit':
    '[ERR_LLM_RATE_LIMIT] Rate limit exceeded. Wait ~60 seconds, then retry.',
  '429':
    '[ERR_LLM_RATE_LIMIT] Too many requests (HTTP 429). Wait 60 seconds and try again, or switch to `--provider ollama`.',

  // ---------------------------------------------------------------------------
  // Provider availability
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Budget — ERR_BUDGET_EXCEEDED
  // ---------------------------------------------------------------------------
  'budget exceeded':
    '[ERR_BUDGET_EXCEEDED] Cost budget exhausted. Use a lighter preset (ember/spark) or increase `--max-budget`. Check `danteforge cost` for token usage.',
  'cost budget':
    '[ERR_BUDGET_EXCEEDED] The cost budget was reached. Run `danteforge cost` to see usage, then re-run with `--max-budget <amount>`.',
  'agent exceeded':
    '[ERR_BUDGET_EXCEEDED] An agent exceeded its configured budget limit. Increase the budget or use a lighter level (--level light).',

  // ---------------------------------------------------------------------------
  // Gates — ERR_GATE_FAILED
  // ---------------------------------------------------------------------------
  'gate failed':
    '[ERR_GATE_FAILED] A quality gate blocked the command. Run `danteforge verify` to see failing checks, or use `--light` to bypass gates.',
  'gate:':
    '[ERR_GATE_FAILED] A hard gate is blocking progress. Check `.danteforge/STATE.yaml` for gate status, or run with `--light` to skip.',
  'tests must pass':
    'Run `npm test` (or your test command) and fix failing tests before proceeding.',

  // ---------------------------------------------------------------------------
  // Worktree — ERR_WORKTREE_DIRTY
  // ---------------------------------------------------------------------------
  'working tree is dirty':
    '[ERR_WORKTREE_DIRTY] Git working tree has uncommitted changes. Commit or stash them before running this command.',
  'worktree is dirty':
    '[ERR_WORKTREE_DIRTY] Git worktree has uncommitted changes. Run `git stash` or commit before proceeding.',
  'worktree':
    'Git worktree issue detected. Run `git worktree list` to inspect and `git worktree prune` to clean up stale entries.',

  // ---------------------------------------------------------------------------
  // Build — ERR_BUILD_FAILED
  // ---------------------------------------------------------------------------
  'typescript error':
    '[ERR_BUILD_FAILED] Fix TypeScript errors before building. Run `npm run typecheck` to see all errors.',
  'tsc error':
    '[ERR_BUILD_FAILED] TypeScript compilation failed. Run `npm run typecheck` for the full error list.',
  'build failed':
    '[ERR_BUILD_FAILED] The build failed. Run `npm run build` to see the detailed error, then fix and retry.',
  'compilation error':
    '[ERR_BUILD_FAILED] Compilation failed. Run `npm run build` to see details, then fix TypeScript/syntax issues.',
  'npm run build':
    '[ERR_BUILD_FAILED] `npm run build` failed. Check the output above for TypeScript or bundler errors.',

  // ---------------------------------------------------------------------------
  // Tests — ERR_NO_TESTS (empty tests/ directory)
  // ---------------------------------------------------------------------------
  'no tests found in':
    '[ERR_NO_TESTS] No test files found in the tests/ directory. Add at least one test file before forging. Run `danteforge tasks` to generate TDD tasks.',
  'empty test':
    '[ERR_NO_TESTS] Test suite is empty. Add test files to the tests/ directory, or use `--light` to skip the gate.',

  // ---------------------------------------------------------------------------
  // Circuit breaker
  // ---------------------------------------------------------------------------
  'circuit breaker open':
    '[ERR_CIRCUIT_OPEN] The LLM provider circuit breaker opened due to repeated failures. Wait 30 seconds for auto-reset, or switch providers with `--provider ollama`.',
  'circuit breaker reset':
    'Circuit breaker recovered. Provider is available again.',

  // ---------------------------------------------------------------------------
  // File / permissions
  // ---------------------------------------------------------------------------
  'permission denied':
    'Permission denied. Check file/directory ownership, or run with elevated privileges if appropriate.',
  'eacces':
    'Access denied. Check that you have write permissions in this directory.',
  'disk full':
    'Disk is full. Free up space and retry.',
  'enospc':
    'No space left on device. Free up disk space and retry.',

  // ---------------------------------------------------------------------------
  // Anti-stub
  // ---------------------------------------------------------------------------
  'stub detected':
    'Stub or TODO-only implementation found. Fill in the implementation before merging.',
  'anti-stub':
    'Stub check failed. Real implementations are required — replace TODO/placeholder code.',

  // ---------------------------------------------------------------------------
  // Generic fallback (checked last — must remain last)
  // ---------------------------------------------------------------------------
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
  'config.yaml missing': 'https://github.com/dantericardo88/danteforge#configuration',
  'config.yaml not found': 'https://github.com/dantericardo88/danteforge#configuration',
  'state corrupt': 'https://github.com/dantericardo88/danteforge#troubleshooting',
  'state file corrupted': 'https://github.com/dantericardo88/danteforge#troubleshooting',
  'state.yaml is not valid yaml': 'https://github.com/dantericardo88/danteforge#troubleshooting',
  'no constitution': 'https://github.com/dantericardo88/danteforge#constitution',
  'no spec found': 'https://github.com/dantericardo88/danteforge#specify',
  'spec.md missing': 'https://github.com/dantericardo88/danteforge#specify',
  'rate limit': 'https://github.com/dantericardo88/danteforge#llm-providers',
  'rate_limit': 'https://github.com/dantericardo88/danteforge#llm-providers',
  '429': 'https://github.com/dantericardo88/danteforge#llm-providers',
  'llm timeout': 'https://github.com/dantericardo88/danteforge#llm-providers',
  'request timed out': 'https://github.com/dantericardo88/danteforge#llm-providers',
  'budget exceeded': 'https://github.com/dantericardo88/danteforge#budgets',
  'cost budget': 'https://github.com/dantericardo88/danteforge#budgets',
  'gate failed': 'https://github.com/dantericardo88/danteforge#gates',
  'working tree is dirty': 'https://github.com/dantericardo88/danteforge#worktrees',
  'build failed': 'https://github.com/dantericardo88/danteforge#build',
  'no tests found in': 'https://github.com/dantericardo88/danteforge#testing',
  'circuit breaker open': 'https://github.com/dantericardo88/danteforge#circuit-breaker',
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
