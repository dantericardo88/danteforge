// examples-registry.ts — Curated command examples that any command can query.
// Covers all major DanteForge commands with beginner-friendly tags.
// -----------------------------------------------------------------------

export interface CommandExample {
  /** Full CLI invocation, e.g. "danteforge forge --target 9.0" */
  command: string;
  /** One-line description of what this example does. */
  description: string;
  /** Semantic tags: "beginner", "quick-start", "advanced", "ci", etc. */
  tags: string[];
  /** Relevant quality dimension (optional), e.g. "testing". */
  dimension?: string;
}

// ---------------------------------------------------------------------------
// Canonical example catalogue (≥ 30 entries)
// ---------------------------------------------------------------------------

export const EXAMPLES: CommandExample[] = [
  // ── init ──────────────────────────────────────────────────────────────────
  {
    command: 'danteforge init',
    description: 'Initialise a new DanteForge project in the current directory.',
    tags: ['beginner', 'quick-start'],
  },

  // ── specify ───────────────────────────────────────────────────────────────
  {
    command: 'danteforge specify',
    description: 'Generate a project spec through interactive Q&A (no API key required for local mode).',
    tags: ['beginner', 'quick-start'],
  },
  {
    command: 'danteforge specify --prompt',
    description: 'Output the spec prompt so you can paste it into any chat interface.',
    tags: ['beginner'],
  },

  // ── plan ──────────────────────────────────────────────────────────────────
  {
    command: 'danteforge plan',
    description: 'Generate a detailed implementation plan from the spec.',
    tags: ['beginner', 'quick-start'],
  },
  {
    command: 'danteforge plan --light',
    description: 'Generate a plan without requiring a passing gate check first.',
    tags: ['beginner'],
  },

  // ── forge ─────────────────────────────────────────────────────────────────
  {
    command: 'danteforge forge',
    description: 'Run a full GSD wave to implement the plan.',
    tags: ['beginner', 'quick-start'],
  },
  {
    command: 'danteforge forge --target 9.0',
    description: 'Run forge waves until the quality score reaches 9.0.',
    tags: ['advanced'],
    dimension: 'functionality',
  },
  {
    command: 'danteforge forge --dim testing',
    description: 'Focus forge on improving the testing dimension only.',
    tags: ['advanced'],
    dimension: 'testing',
  },

  // ── verify ────────────────────────────────────────────────────────────────
  {
    command: 'danteforge verify',
    description: 'Run typecheck, lint, and all tests — the standard CI gate.',
    tags: ['beginner', 'quick-start', 'ci'],
    dimension: 'testing',
  },
  {
    command: 'danteforge verify --light',
    description: 'Fast verify pass — skips heavy checks for inner-loop speed.',
    tags: ['beginner'],
    dimension: 'testing',
  },

  // ── score ─────────────────────────────────────────────────────────────────
  {
    command: 'danteforge score',
    description: 'Score the project across all 8 quality dimensions.',
    tags: ['beginner', 'quick-start'],
  },
  {
    command: 'danteforge score --full',
    description: 'Show all 18 sub-dimensions with weights in the score report.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge score --strict',
    description: 'Run the harsh adversarial scorer for a conservative score estimate.',
    tags: ['advanced'],
    dimension: 'functionality',
  },

  // ── compete ───────────────────────────────────────────────────────────────
  {
    command: 'danteforge compete',
    description: 'Score this project against configured competitors side-by-side.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge compete --check-all-nine',
    description: 'Machine-readable check: is every dimension ≥ 9.0? (Used by goal-loop.)',
    tags: ['advanced', 'ci'],
  },
  {
    command: 'danteforge compete --auto',
    description: 'Run the full hyper-critical competitive scoring loop automatically.',
    tags: ['advanced'],
  },

  // ── matrix-kernel ─────────────────────────────────────────────────────────
  {
    command: 'danteforge matrix-kernel init',
    description: 'Initialise the Matrix Kernel control plane for multi-agent execution.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge matrix-kernel status',
    description: 'Show current Matrix Kernel phase, leases, and agent states.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge matrix-kernel simulate',
    description: 'Dry-run the Matrix Kernel loop without committing any changes.',
    tags: ['advanced'],
  },

  // ── goal-loop ─────────────────────────────────────────────────────────────
  {
    command: 'danteforge goal-loop',
    description: 'Run the cross-project goal loop until all nine dimensions reach 9.0.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge goal-loop --dim testing',
    description: 'Drive the goal loop focusing only on the testing dimension.',
    tags: ['advanced'],
    dimension: 'testing',
  },

  // ── autoforge ─────────────────────────────────────────────────────────────
  {
    command: 'danteforge autoforge',
    description: 'Autonomous plan→forge→verify loop; runs until the score target is met.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge autoforge --target 8.5',
    description: 'Run autoforge until the project score reaches 8.5.',
    tags: ['advanced'],
    dimension: 'functionality',
  },

  // ── harvest ───────────────────────────────────────────────────────────────
  {
    command: 'danteforge harvest-pattern --url https://github.com/some/repo',
    description: 'Harvest design patterns from an OSS GitHub repository.',
    tags: ['advanced'],
  },

  // ── wiki ──────────────────────────────────────────────────────────────────
  {
    command: 'danteforge wiki-ingest',
    description: 'Ingest raw source files into the project wiki.',
    tags: ['advanced'],
    dimension: 'documentation',
  },
  {
    command: 'danteforge wiki-query --q "retry strategy"',
    description: 'Search the project wiki for patterns matching a query.',
    tags: ['advanced'],
    dimension: 'documentation',
  },
  {
    command: 'danteforge wiki-status',
    description: 'Display wiki health, coverage %, and stale-entry count.',
    tags: ['advanced'],
    dimension: 'documentation',
  },

  // ── synthesize ────────────────────────────────────────────────────────────
  {
    command: 'danteforge synthesize',
    description: 'Generate the Ultimate Plan by synthesising all harvested patterns.',
    tags: ['advanced'],
  },

  // ── retro ─────────────────────────────────────────────────────────────────
  {
    command: 'danteforge retro',
    description: 'Run a sprint retrospective and capture lessons learned.',
    tags: ['beginner'],
  },

  // ── lessons ───────────────────────────────────────────────────────────────
  {
    command: 'danteforge lessons',
    description: 'Show all lessons captured from past corrections and failures.',
    tags: ['beginner'],
  },
  {
    command: 'danteforge lessons add "Always run verify before committing."',
    description: 'Manually add a lesson to the lessons log.',
    tags: ['beginner'],
  },

  // ── ascend ────────────────────────────────────────────────────────────────
  {
    command: 'danteforge ascend',
    description: 'Autonomous quality ascent: runs forge/verify loops until 9.5+.',
    tags: ['advanced'],
    dimension: 'functionality',
  },

  // ── magic / inferno / party ───────────────────────────────────────────────
  {
    command: 'danteforge magic',
    description: 'Balanced-power preset: moderate token budget with broad coverage.',
    tags: ['beginner'],
  },
  {
    command: 'danteforge inferno',
    description: 'Maximum-power preset: highest token budget, deepest analysis.',
    tags: ['advanced'],
  },
  {
    command: 'danteforge party',
    description: 'Multi-agent party mode: coordinate several agents in parallel.',
    tags: ['advanced'],
  },
];

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Return all examples whose `command` starts with (or contains) the given
 * command name.  Case-insensitive prefix match on the first word after
 * `danteforge `.
 */
export function getExamplesForCommand(command: string): CommandExample[] {
  const lower = command.toLowerCase();
  return EXAMPLES.filter((ex) => {
    // Strip the "danteforge " prefix so callers can pass just "forge".
    const stripped = ex.command.replace(/^danteforge\s+/, '').toLowerCase();
    return stripped.startsWith(lower) || ex.command.toLowerCase().includes(lower);
  });
}

/**
 * Return all examples tagged with the given dimension.
 */
export function getExamplesForDimension(dim: string): CommandExample[] {
  const lower = dim.toLowerCase();
  return EXAMPLES.filter((ex) => ex.dimension?.toLowerCase() === lower);
}

/**
 * Return examples suitable for new users (tagged "beginner").
 */
export function getQuickStartExamples(): CommandExample[] {
  return EXAMPLES.filter((ex) => ex.tags.includes('beginner'));
}
