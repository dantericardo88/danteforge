export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'danteforge_state',
    description: 'Read current DanteForge project state (workflow stage, phase, project name, configuration).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_score',
    description: 'Get PDSE quality score for a specific artifact (CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS).',
    inputSchema: {
      type: 'object',
      properties: {
        artifact: {
          type: 'string',
          description: 'Artifact name to score (e.g. CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS)',
        },
      },
      required: ['artifact'],
    },
  },
  {
    name: 'danteforge_score_all',
    description: 'Get PDSE quality scores for all artifacts on disk.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_gate_check',
    description: 'Check whether a specific gate passes (requireConstitution, requireSpec, requireClarify, requirePlan, requireTests, requireDesign).',
    inputSchema: {
      type: 'object',
      properties: {
        gate: {
          type: 'string',
          description: 'Gate name: requireConstitution, requireSpec, requireClarify, requirePlan, requireTests, or requireDesign',
        },
      },
      required: ['gate'],
    },
  },
  {
    name: 'danteforge_next_steps',
    description: 'Get recommended next workflow steps based on current project state and the workflow graph.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_task_list',
    description: 'List tasks for the current execution phase.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_artifact_read',
    description: 'Read a specific artifact file from .danteforge/ directory.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Filename to read from .danteforge/ (e.g. SPEC.md, PLAN.md, CONSTITUTION.md, TASKS.md)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'danteforge_lessons',
    description: 'Read accumulated lessons from .danteforge/lessons.md (corrections, failures, insights).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_memory_query',
    description: 'Search the persistent memory engine for past decisions, corrections, and insights.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for memory entries',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'danteforge_verify',
    description: 'Run project verification (artifact checks, release checks, drift detection). Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to execute verification',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'danteforge_handoff',
    description: 'Trigger a workflow handoff to advance the pipeline to the next stage. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          description: 'Source stage for the handoff (constitution, spec, forge, party, review, ux-refine, design)',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to execute the handoff',
        },
      },
      required: ['stage', 'confirm'],
    },
  },
  {
    name: 'danteforge_budget_status',
    description: 'Check the latest token cost/budget report from .danteforge/reports/.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_complexity',
    description: 'Assess task complexity for the current phase and get routing/preset recommendations.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_route_task',
    description: 'Get routing recommendation (local/light/heavy tier) for a named task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskName: {
          type: 'string',
          description: 'Name of the task to route',
        },
      },
      required: ['taskName'],
    },
  },
  {
    name: 'danteforge_audit_log',
    description: 'Read recent entries from the project audit log.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of recent entries to return (default: 20)',
        },
      },
      required: [],
    },
  },
  // New tools added for full workflow coverage
  {
    name: 'danteforge_assess',
    description: 'Run a quality assessment of the current project and return an overall score.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: process.cwd())' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_forge',
    description: 'Execute GSD forge waves to build the next set of features.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_autoforge',
    description: 'Run the autoforge loop to automatically drive the project to completion.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_plan',
    description: 'Generate a detailed implementation plan from the project spec.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_tasks',
    description: 'Break the plan into an executable task list.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_synthesize',
    description: 'Generate Ultimate Planning Resource (UPR.md) from current project artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_retro',
    description: 'Run a retrospective on the current project iteration.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_maturity',
    description: 'Analyze current code maturity level and provide improvement recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_specify',
    description: 'Start the SPEC refinement flow from a high-level idea.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
        idea: { type: 'string', description: 'High-level product idea to specify' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_constitution',
    description: 'Generate or update the project constitution.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_state_read',
    description: 'Read full DanteForge project state as JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_masterplan',
    description: 'Generate a masterplan from the current project artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_competitors',
    description: 'Scan and analyze competitor products in the same space.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_lessons_add',
    description: 'Append a new lesson or correction to the project lessons log.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
        lesson: { type: 'string', description: 'Lesson text to record' },
      },
      required: ['lesson'],
    },
  },
  {
    name: 'danteforge_workflow',
    description: 'Get current workflow state: stage, phase, last handoff, verify status.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_adoption_queue',
    description: 'Read the current OSS adoption queue showing patterns ready to implement. Returns the ADOPTION_QUEUE.md content.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
    },
  },
  {
    name: 'danteforge_quality_certificate',
    description: 'Generate a tamper-evident quality certificate (evidenceFingerprint) from current convergence state.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
    },
  },
  {
    name: 'danteforge_pattern_coverage',
    description: 'Show which spec requirements have OSS pattern coverage. Reads PATTERN_COVERAGE.md if present.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
    },
  },
  {
    name: 'danteforge_harvest_next_pattern',
    description: 'Adopt the highest-priority pattern from ADOPTION_QUEUE.md. Requires human approval (policy: confirm) â€” writes files and may run tests.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
        dryRun: { type: 'boolean', description: 'If true, show what would be adopted without executing (default: true for safety)' },
      },
    },
  },
  {
    name: 'danteforge_explain_score',
    description: 'Explain a maturity score dimension â€” what it measures, why it matters, and what would improve it.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', description: 'Score dimension name (e.g. "circuit-breaker-reliability")' },
        score: { type: 'number', description: 'Current score 0-10 (optional â€” loads from state if omitted)' },
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
      required: ['dimension'],
    },
  },
  {
    name: 'danteforge_leapfrog_opportunities',
    description: 'List competitive leapfrog opportunities â€” dimensions where OSS patterns can jump this project ahead of named competitors.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
        maxOpportunities: { type: 'number', description: 'Maximum opportunities to return (default: 5)' },
      },
    },
  },
  {
    name: 'danteforge_pattern_search',
    description: 'Search the global OSS pattern library by keyword, category, or complexity. Returns patterns ranked by ROI.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search term matched against pattern name and description' },
        category: { type: 'string', description: 'Filter by category (e.g. "reliability", "performance")' },
        maxComplexity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Maximum adoption complexity' },
        minAvgRoi: { type: 'number', description: 'Minimum average ROI 0-1 (default: 0)' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
      },
    },
  },
  {
    name: 'danteforge_adversarial_score',
    description: 'Challenge the self-score with an independent adversary LLM. Returns a divergence panel showing selfScore vs adversarialScore, verdict (trusted/watch/inflated/underestimated), and the most inflated dimensions. Use this to catch score inflation before declaring a feature complete.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory (defaults to process.cwd())' },
        summaryOnly: { type: 'boolean', description: 'Use a single LLM call for summary score instead of per-dimension (faster, lower cost)' },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific dimensions to score adversarially. Omit to score all dimensions.',
        },
      },
      required: [],
    },
  },
  // â”€â”€ Dossier system tools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'danteforge_dossier_build',
    description: 'Build or refresh a competitor dossier with source-backed evidence and rubric scores',
    inputSchema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Competitor id (e.g. "cursor", "aider")' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override primary source URLs (optional)',
        },
        since: { type: 'string', description: 'Skip if dossier built within this duration (e.g. "7d")' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['competitor'],
    },
  },
  {
    name: 'danteforge_dossier_get',
    description: 'Get a competitor dossier, optionally filtered to a single dimension',
    inputSchema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Competitor id' },
        dim: { type: 'number', description: 'Dimension number (1â€“28). Omit for full dossier.' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['competitor'],
    },
  },
  {
    name: 'danteforge_dossier_list',
    description: 'List all built competitor dossiers with composite scores',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_landscape_build',
    description: 'Rebuild the full competitive landscape matrix from all dossiers and write COMPETITIVE_LANDSCAPE.md',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_landscape_diff',
    description: 'Show competitive landscape staleness and metadata since last build',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_rubric_get',
    description: 'Get the scoring rubric â€” all dimensions or a single dimension with criteria',
    inputSchema: {
      type: 'object',
      properties: {
        dim: { type: 'number', description: 'Dimension number (1â€“28). Omit for full rubric.' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_score_competitor',
    description: 'Get the composite score and dimension breakdown for a specific competitor',
    inputSchema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Competitor id' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['competitor'],
    },
  },
  // -- Feature Universe tools --------------------------------------------------
  {
    name: 'danteforge_universe',
    description: 'Read the current feature universe (the union of capabilities across competitors that DanteForge scores the project against). Pass refresh=true to rebuild from the canonical DanteForge peer list. Auto-populates when missing — no "run /oss first" dead-end.',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Force rebuild of the feature universe (calls extractCompetitorFeatures per competitor — requires LLM)' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_ensure_universe_ready',
    description: 'Idempotent preflight for the feature universe. By default only LOADS the existing universe from disk (no LLM calls) — safe to call from every orchestration entry point (ascend, inferno, matrixdev) without blocking. Pass build: true to also build via LLM when missing/stale. Returns { features, competitors, generatedAt, ready }.',
    inputSchema: {
      type: 'object',
      properties: {
        build: { type: 'boolean', description: 'When true, also calls the LLM to build a missing/stale universe (default false — load-only).' },
        minFeatures: { type: 'number', description: 'Rebuild if fewer than this many features (default 20)' },
        maxAgeDays: { type: 'number', description: 'Rebuild if older than this (default 14)' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_canonical_competitors',
    description: 'Returns the canonical 16-peer DanteForge competitor list grouped by category: spec-driven dev kits (spec-kit, BMAD, OpenSpec), skill consolidators (anthropics/claude-skills, cursor.directory), autonomous research loops (Karpathy autoresearch, DSPy), and orchestration peers (MetaGPT, CrewAI, AutoGen, GPT-Engineer, OpenHands, Aider, SWE-Agent, LangChain Agents). DanteForge sits ON TOP OF AI coding assistants — these are its peers, NOT Cursor/Devin/Claude Code itself.',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_compete_reset',
    description: 'Replace the competitors in compete-matrix.json with the canonical DanteForge peer list. Backs up the old matrix to matrix.pre-<timestamp>.json. Mutating — requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: 'Required: explicit confirmation to mutate the matrix' },
        useCanonical: { type: 'boolean', description: 'Apply the canonical peer list (default true; other modes reserved)' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['confirm'],
    },
  },
  // â”€â”€ COFL tool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'danteforge_cofl',
    description: 'Run a Competitive Operator Forge Loop (COFL) phase. Partitions competitors into direct_peer/specialist_teacher/reference_teacher roles, scores operator leverage for each matrix dimension, checks 7 anti-failure guardrails, and returns a full cycle result with reframe assessment. Use --auto for a complete end-to-end cycle.',
    inputSchema: {
      type: 'object',
      properties: {
        universe: { type: 'boolean', description: 'Run universe+partition phase â€” classify competitors by role' },
        harvest: { type: 'boolean', description: 'Run harvest phase â€” extract patterns from OSS teacher set (requires LLM)' },
        prioritize: { type: 'boolean', description: 'Run prioritize phase â€” rank dimensions by operator leverage score' },
        guards: { type: 'boolean', description: 'Run anti-failure guardrail checks (7 codified failure modes)' },
        reframe: { type: 'boolean', description: 'Run reframe phase â€” strategic position assessment (inflating rows vs real preference gain)' },
        report: { type: 'boolean', description: 'Write COFL_REPORT.md to .danteforge/cofl/' },
        auto: { type: 'boolean', description: 'Run all phases end-to-end (full 10-phase cycle)' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
];
