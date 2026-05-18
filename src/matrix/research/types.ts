// Matrix Research — type schema for Phase N-Q of
// docs/PRDs/autonomous-frontier-reaching.md.
//
// HONEST SCOPE: This is the schema layer. Types + activation criteria +
// stop conditions are load-bearing this session. The actual parallel-agent
// orchestration (Phase O) and synthesis (Phase P) are explicitly NOT shipped —
// invoking those code paths surfaces a clear "Phase O orchestration not yet
// shipped — see docs/PRDs/autonomous-frontier-reaching.md section 6" error.
//
// What this file delivers:
//   - ResearchAgentRole — the 10 cognitive roles from PRD section 5
//   - ResearchModeConfig — operator-configurable defaults (PRD section 5)
//   - ResearchWaveOutcome — the 3 possible recommendations (PRD section 7)
//   - FailedHypothesis — prior-research repetition guard (PRD section 8)
//   - ResearchStatus — per-dim research metadata stored alongside matrix.json

import type { CapabilityTier } from '../types/capability-test.js';

// ── Agent role schema (PRD section 5) ────────────────────────────────────────

/**
 * Cognitive mode that determines how an agent reasons about its task.
 * Discovery agents propose hypotheses; critique agents argue against current
 * approaches; synthesis agents combine; validation agents test claims.
 */
export type CognitiveMode = 'discovery' | 'critique' | 'synthesis' | 'validation';

export interface ResearchAgentRole {
  /** Stable id used in file paths + audit log. */
  id: string;
  /** Human-readable label. */
  label: string;
  cognitive_mode: CognitiveMode;
  required_outputs: ResearchOutput[];
  /** Specific actions the agent must NOT take (e.g. "do not install dependencies"). */
  forbidden_actions: string[];
  /** Wall-clock budget. Default 120 min. */
  time_budget_minutes: number;
  /** Lower number = spawn earlier in the wave. */
  spawn_priority: number;
}

export interface ResearchOutput {
  filename: string;
  format: 'markdown' | 'json' | 'shell-script';
  schema?: object;
  required: boolean;
}

// ── PRD-canonical roles (PRD section 5.2, 10 roles) ─────────────────────────

/**
 * The 10 cognitive roles per the PRD. Prompt templates for each live at
 * `prompts/research/<role-id>.md` (operator may override via
 * `.danteforge/prompts/research/<role-id>.md`). The prompts themselves are NOT
 * yet authored — Phase O orchestration requires them; this session just
 * captures the canonical role identities so the type system rejects typos.
 */
export const CANONICAL_RESEARCH_ROLES: ResearchAgentRole[] = [
  {
    id: 'benchmark-designer',
    label: 'Benchmark Designer',
    cognitive_mode: 'validation',
    required_outputs: [
      { filename: 'frontier-definition.md', format: 'markdown', required: true },
    ],
    forbidden_actions: ['propose code without measurable frontier criteria'],
    time_budget_minutes: 60,
    spawn_priority: 0,  // runs FIRST and ALONE per PRD section 5
  },
  {
    id: 'literature-scout',
    label: 'Literature Scout',
    cognitive_mode: 'discovery',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'hypothesis.md', format: 'markdown', required: true },
    ],
    forbidden_actions: ['copy code from sources without harvest notes'],
    time_budget_minutes: 120,
    spawn_priority: 10,
  },
  {
    id: 'frontier-reverse-engineer',
    label: 'Frontier Reverse-Engineer',
    cognitive_mode: 'discovery',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'hypothesis.md', format: 'markdown', required: true },
      { filename: 'harvest-notes', format: 'markdown', required: true },
    ],
    forbidden_actions: ['propose installing external dependencies', 'copy code verbatim'],
    time_budget_minutes: 120,
    spawn_priority: 10,
  },
  {
    id: 'adversarial-critic',
    label: 'Adversarial Critic',
    cognitive_mode: 'critique',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'hypothesis.md', format: 'markdown', required: true },
    ],
    forbidden_actions: ['propose constructive solutions (critique only)'],
    time_budget_minutes: 90,
    spawn_priority: 20,
  },
  {
    id: 'alternative-architect',
    label: 'Alternative Architect',
    cognitive_mode: 'discovery',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'hypothesis.md', format: 'markdown', required: true },
      { filename: 'tradeoffs.md', format: 'markdown', required: true },
    ],
    forbidden_actions: ['repeat known-failed approaches'],
    time_budget_minutes: 120,
    spawn_priority: 20,
  },
  {
    id: 'cost-complexity-analyzer',
    label: 'Cost/Complexity Analyzer',
    cognitive_mode: 'validation',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'confidence.json', format: 'json', required: true },
    ],
    forbidden_actions: ['propose new architectures'],
    time_budget_minutes: 60,
    spawn_priority: 30,
  },
  {
    id: 'constitutional-reviewer',
    label: 'Constitutional Reviewer',
    cognitive_mode: 'validation',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
    ],
    forbidden_actions: ['approve proposals that violate constitutional invariants'],
    time_budget_minutes: 45,
    spawn_priority: 30,
  },
  {
    id: 'sovereignty-auditor',
    label: 'Sovereignty Auditor',
    cognitive_mode: 'validation',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'dependencies.json', format: 'json', required: true },
    ],
    forbidden_actions: ['approve unaudited external dependencies'],
    time_budget_minutes: 45,
    spawn_priority: 30,
  },
  {
    id: 'wiring-validator',
    label: 'Wiring Validator',
    cognitive_mode: 'validation',
    required_outputs: [
      { filename: 'findings.md', format: 'markdown', required: true },
      { filename: 'capability_test.sh', format: 'shell-script', required: false },
    ],
    forbidden_actions: ['validate proposals that have no production import path'],
    time_budget_minutes: 60,
    spawn_priority: 30,
  },
  {
    id: 'hybrid-synthesizer',
    label: 'Hybrid Synthesizer',
    cognitive_mode: 'synthesis',
    required_outputs: [
      { filename: 'synthesis-recommendation.md', format: 'markdown', required: true },
    ],
    forbidden_actions: ['generate new hypotheses (synthesis only)'],
    time_budget_minutes: 90,
    spawn_priority: 99,  // runs LAST per PRD section 7
  },
];

// ── ResearchModeConfig (PRD section 5, configuration block) ─────────────────

export interface ResearchModeConfig {
  /** Project composite must be >= this to activate. PRD default 7.5. */
  composite_threshold: number;
  /** Dim's derived score must be within [min, max] (the "sweet spot"). PRD [6.5, 8.5]. */
  per_dim_score_range: [number, number];
  /** Execution-mode waves without progress before research mode unlocks. PRD 3. */
  stuck_waves_before_research: number;
  /** Default council size. PRD 6. */
  default_agent_count: number;
  /** Hard cap on council size. PRD 10. */
  max_agent_count: number;
  /** Per-agent wall-clock budget. PRD 120 min. */
  agent_time_budget_minutes: number;
  /** Whole-wave budget. PRD 480 min (8 hours). */
  wave_total_budget_minutes: number;
  /** Whether to spawn agents as concurrent processes (true) or sequentially (pseudo). */
  parallel_mode: 'true' | 'pseudo';
  /** Whether agents have access to SearchEngine via MCP. PRD true (Phase L prereq). */
  use_search_primitive: boolean;
}

export const DEFAULT_RESEARCH_MODE_CONFIG: ResearchModeConfig = {
  composite_threshold: 7.5,
  per_dim_score_range: [6.5, 8.5],
  stuck_waves_before_research: 3,
  default_agent_count: 6,
  max_agent_count: 10,
  agent_time_budget_minutes: 120,
  wave_total_budget_minutes: 480,
  parallel_mode: 'true',
  use_search_primitive: true,
};

// ── Wave outcomes (PRD section 7) ───────────────────────────────────────────

/**
 * The 3 possible recommendations from the hybrid-synthesizer agent. Anything
 * else (e.g. "promote but failed harden gate") halts and surfaces the failure
 * — silent workarounds violate PRD invariant I7.
 */
export type ResearchWaveOutcome =
  | 'promote'      // one proposal clearly wins; land it on a feature branch
  | 'conflict'     // multiple proposals have merit; require operator decision
  | 'cap'          // no proposal achieves frontier; document structural cap
  | 'in-progress'  // wave is running
  | null;          // no wave has run yet

export interface FailedHypothesis {
  /** Wave id where this hypothesis was tried. */
  waveId: string;
  /** Brief description of the hypothesis. */
  description: string;
  /** Why it failed (harden gate? wiring? capability test?). */
  failureReason: string;
  /** ISO timestamp when the wave that tried it completed. */
  failedAt: string;
}

// ── Per-dim research metadata (PRD section 11) ──────────────────────────────

export interface ResearchStatus {
  /** Most recent wave id; undefined when no wave has ever run for this dim. */
  last_wave_id?: string;
  last_wave_outcome: ResearchWaveOutcome;
  /** ISO timestamp of last wave completion. */
  last_wave_at?: string;
  /** When outcome=cap, the structural reason. */
  structural_cap_reason?: string;
  /** When outcome=conflict, whether operator review is pending. */
  human_review_pending?: boolean;
  /** Total research waves completed for this dim. */
  research_waves_completed: number;
  /** Consecutive execution-mode waves without progress (drives stuck detection). */
  consecutive_stuck_waves: number;
}

// ── Wave manifest (written when a wave starts) ──────────────────────────────

export interface ResearchWaveManifest {
  waveId: string;
  dimensionId: string;
  startedAt: string;
  baseCommitSha: string | null;
  config: ResearchModeConfig;
  council: ResearchAgentRole[];
  /** Path under `.danteforge/research/<waveId>/`. */
  rootPath: string;
}

// ── Activation result (mode-selector output) ────────────────────────────────

export interface ActivationResult {
  /** Whether research mode should run for this dim. */
  shouldActivate: boolean;
  /** When false, the specific criterion that blocked activation. */
  blockingReason?: string;
  /** When true, the council of roles to spawn. */
  council?: ResearchAgentRole[];
  /** When true, the achieved tier this dim is currently at. */
  achievedTier?: CapabilityTier | null;
  /** When true, the declared ceiling. */
  declaredCeiling?: CapabilityTier;
}
