import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ── Scoring Doctrine (canonical — mirrors src/core/scoring-doctrine.ts) ─────
// Every scoring surface in DanteForge references this doctrine.
// See src/core/scoring-doctrine.ts for the full version with exports.
const SCORING_DOCTRINE_SHORT = 'Evidence-based scoring only. Compare against actual competitors (not downstream consumers). No adoption penalties on pre-release tools. The gap is the value. "Harsh" = evidence-based, not opinion-based.';
console.log(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}\n`);

const CWD = process.cwd();
const MATRIX_PATH = '.danteforge/compete/matrix.json';
const EVIDENCE_DIR = '.danteforge/outcome-evidence';

const TIER_SCORE_CAPS = {
  T0: 1.0, T1: 4.0, T2: 5.0, T3: 6.0, T4: 7.0, T5: 8.0, T6: 8.5, T7: 9.0, T8: 9.5,
};
const TIER_ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const MIN_T7_HIGH_TIER_OUTCOMES = 3;

// ── Load evidence ────────────────────────────────────────────────────────────

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: CWD }).trim();
  } catch { return null; }
}

function loadEvidence() {
  const evidence = new Map();
  const dir = path.join(CWD, EVIDENCE_DIR);
  if (!fs.existsSync(dir)) return evidence;

  // Load ALL evidence files, keeping the most recent per outcome.
  // Evidence is SHA-scoped in live scoring, but for rescore we want the
  // latest evidence regardless of which commit generated it.
  const allEntries = new Map(); // key -> { entry, mtime }

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const fullPath = path.join(dir, f);
      const entry = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (!entry?.dimensionId || !entry?.outcomeId) continue;

      const key = `${entry.dimensionId}::${entry.outcomeId}`;
      const tsStr = entry.finishedAt ?? entry.ranAt;
      const mtime = tsStr ? new Date(tsStr).getTime() : 0;
      const existing = allEntries.get(key);

      if (!existing || mtime > existing.mtime) {
        allEntries.set(key, { entry, mtime });
      }
    } catch { /* skip */ }
  }

  for (const [key, { entry }] of allEntries) {
    evidence.set(key, entry);
  }
  return evidence;
}

// ── Derived score (port of src/core/derived-score.ts) ────────────────────────

function isOutcomePassing(outcome, entry) {
  if (!entry || !entry.passed) return false;
  if ((outcome.kind ?? 'shell') !== 'shell') return entry.passed;
  const expectedExit = outcome.expected_exit ?? 0;
  return entry.exitCode === expectedExit;
}

function computeDerivedScore(dim, evidence) {
  const outcomes = dim.outcomes ?? [];
  if (outcomes.length === 0) {
    return { score: dim.scores?.self ?? 0, legacy: true, perTier: [] };
  }

  const tierBuckets = new Map();
  for (const o of outcomes) {
    const bucket = tierBuckets.get(o.tier) ?? [];
    bucket.push(o);
    tierBuckets.set(o.tier, bucket);
  }

  const perTier = [];
  let highestFullPassedTier = null;
  let nextTier = null;
  let nextTierProgress = 0;

  for (const tier of TIER_ORDER) {
    const tierOutcomes = tierBuckets.get(tier) ?? [];
    if (tierOutcomes.length === 0) continue;

    let passing = 0;
    for (const o of tierOutcomes) {
      const entry = evidence.get(`${dim.id}::${o.id}`);
      if (isOutcomePassing(o, entry)) passing++;
    }

    let allPassing = passing === tierOutcomes.length;

    if (allPassing && tier === 'T7') {
      const highTierPassCount = perTier
        .filter(pt => TIER_ORDER.indexOf(pt.tier) >= TIER_ORDER.indexOf('T5') && pt.allPassing)
        .reduce((sum, pt) => sum + pt.declared, 0);
      if (highTierPassCount + tierOutcomes.length < MIN_T7_HIGH_TIER_OUTCOMES) {
        allPassing = false;
      }

      // Session-ID temporal separation: T7 requires evidence from ≥2 distinct
      // validate sessions. Mirrors the check in src/core/derived-score.ts.
      if (allPassing) {
        const sessionIds = (dim.outcomes ?? [])
          .filter(o => TIER_ORDER.indexOf(o.tier) >= TIER_ORDER.indexOf('T5'))
          .map(o => evidence.get(`${dim.id}::${o.id}`)?.session_id)
          .filter(s => typeof s === 'string');
        if (sessionIds.length >= 2 && new Set(sessionIds).size < 2) {
          allPassing = false;
        }
      }

      // Structural veto: any T7 structural failure resets passing to 0 so that
      // nextTierProgress cannot interpolate the score up to 9.0 silently.
      if (!allPassing) passing = 0;
    }

    perTier.push({ tier, declared: tierOutcomes.length, passing, allPassing });

    if (allPassing) {
      highestFullPassedTier = tier;
    } else {
      nextTier = tier;
      nextTierProgress = passing / tierOutcomes.length;
      break;
    }
  }

  let score;
  if (highestFullPassedTier === null && nextTier === null) {
    score = 0;
  } else if (highestFullPassedTier === null) {
    score = TIER_SCORE_CAPS[nextTier] * nextTierProgress;
  } else if (nextTier === null) {
    score = TIER_SCORE_CAPS[highestFullPassedTier];
  } else {
    const lower = TIER_SCORE_CAPS[highestFullPassedTier];
    const upper = TIER_SCORE_CAPS[nextTier];
    score = lower + (upper - lower) * nextTierProgress;
  }

  if (dim.declared_ceiling && TIER_SCORE_CAPS[dim.declared_ceiling] !== undefined) {
    const cap = TIER_SCORE_CAPS[dim.declared_ceiling];
    if (score > cap) score = cap;
  }

  score = Math.round(score * 10) / 10;
  return { score, legacy: false, highestFullPassedTier, perTier };
}

// ── Competitor taxonomy ──────────────────────────────────────────────────────
// Per project_positioning.md (user-confirmed 2026-05-13):
// Actual competitors are in 4 categories. IDE/completion tools are reference only.

const ACTUAL_COMPETITORS_CLOSED = [
  'Kiro (AWS)',
  'Replit Agent',
];

const ACTUAL_COMPETITORS_OSS = [
  'spec-kit (GitHub)',
  'BMad-METHOD',
  'MetaGPT',
  'CrewAI',
  'AutoGen (Microsoft)',
  'GPT-Engineer',
  'OpenHands (All-Hands AI)',
  'Aider',
  'SWE-Agent (Princeton)',
  'LangChain Agents',
  'Dagger',
  're_gent',
  // Frontier OSS frameworks — added 2026-05-24: these score higher than DanteForge
  // on multi_agent_orchestration and ecosystem_mcp. Excluding them was producing
  // false "no gap" signals. "The gap is the value."
  'LangGraph',
  'Agno',
  'Pydantic-AI',
  'SmolaAgents',
  'DSPy',
];

const REFERENCE_TIER = [
  'Devin (Cognition AI)', 'GitHub Copilot Workspace', 'Cursor',
  'Claude Code', 'Codex CLI (OpenAI)', 'Gemini CLI (Google)',
  'GitHub Copilot CLI', 'CodiumAI / Qodo', 'CodeRabbit',
  'Zencoder', 'Qodo 2.0', 'Continue.dev', 'Cline',
  'Goose (Block)', 'Kilo Code', 'Swimm',
];

const ACTUAL_SET = new Set([...ACTUAL_COMPETITORS_CLOSED, ...ACTUAL_COMPETITORS_OSS]);

// ── Gap computation (actual competitors only) ────────────────────────────────

function computeGaps(dim) {
  let leaderScore = dim.scores.self;
  let leader = 'self';
  let csLeaderScore = dim.scores.self;
  let csLeader = 'self';
  let ossLeaderScore = dim.scores.self;
  let ossLeader = 'self';

  for (const [name, score] of Object.entries(dim.scores)) {
    if (name === 'self') continue;
    if (!ACTUAL_SET.has(name)) continue;

    if (score > leaderScore) { leaderScore = score; leader = name; }
    if (ACTUAL_COMPETITORS_CLOSED.includes(name) && score > csLeaderScore) {
      csLeaderScore = score; csLeader = name;
    }
    if (ACTUAL_COMPETITORS_OSS.includes(name) && score > ossLeaderScore) {
      ossLeaderScore = score; ossLeader = name;
    }
  }

  return {
    gap_to_leader: Math.round((leaderScore - dim.scores.self) * 10) / 10,
    leader,
    gap_to_closed_source_leader: Math.round((csLeaderScore - dim.scores.self) * 10) / 10,
    closed_source_leader: csLeader,
    gap_to_oss_leader: Math.round((ossLeaderScore - dim.scores.self) * 10) / 10,
    oss_leader: ossLeader,
  };
}

// ── New dimensions (DanteForge's actual differentiators) ─────────────────────

function getNewDimensions() {
  return [
    {
      id: 'spec_workflow_enforcement',
      label: 'Spec-Driven Workflow Enforcement',
      weight: 2.0,
      category: 'core_differentiator',
      frequency: 'high',
      scores: {
        self: 7.5,
        'Kiro (AWS)': 7.5,
        'Replit Agent': 3.0,
        'spec-kit (GitHub)': 7.0,
        'BMad-METHOD': 6.5,
        'MetaGPT': 5.0,
        'CrewAI': 3.5,
        'AutoGen (Microsoft)': 3.5,
        'GPT-Engineer': 5.0,
        'OpenHands (All-Hands AI)': 3.0,
        'Aider': 2.5,
        'SWE-Agent (Princeton)': 3.0,
        'LangChain Agents': 3.0,
        'Dagger': 4.0,
        're_gent': 3.0,
        // Reference tier
        'Devin (Cognition AI)': 4.0, 'Cursor': 2.0, 'Claude Code': 3.0,
        'GitHub Copilot Workspace': 3.0, 'GitHub Copilot CLI': 2.0,
        'Codex CLI (OpenAI)': 2.5, 'Gemini CLI (Google)': 2.0,
      },
      outcomes: [],
      declared_ceiling: 'T5',
    },
    {
      id: 'outcome_verification',
      label: 'Outcome-Driven Verification (T0-T8)',
      weight: 2.0,
      category: 'core_differentiator',
      frequency: 'high',
      scores: {
        self: 8.0,
        'Kiro (AWS)': 3.0,
        'Replit Agent': 2.0,
        'spec-kit (GitHub)': 2.0,
        'BMad-METHOD': 2.0,
        'MetaGPT': 2.5,
        'CrewAI': 2.0,
        'AutoGen (Microsoft)': 2.5,
        'GPT-Engineer': 1.5,
        'OpenHands (All-Hands AI)': 3.0,
        'Aider': 2.0,
        'SWE-Agent (Princeton)': 3.5,
        'LangChain Agents': 2.0,
        'Dagger': 3.0,
        're_gent': 2.5,
        // Reference tier
        'Devin (Cognition AI)': 2.0, 'Cursor': 1.5, 'Claude Code': 2.0,
      },
      outcomes: [],
      declared_ceiling: 'T5',
    },
    {
      id: 'constitutional_governance',
      label: 'Constitutional Governance & Hard Gates',
      weight: 1.5,
      category: 'core_differentiator',
      frequency: 'high',
      scores: {
        self: 7.5,
        'Kiro (AWS)': 4.0,
        'Replit Agent': 2.0,
        'spec-kit (GitHub)': 3.5,
        'BMad-METHOD': 4.0,
        'MetaGPT': 3.0,
        'CrewAI': 2.5,
        'AutoGen (Microsoft)': 3.0,
        'GPT-Engineer': 2.0,
        'OpenHands (All-Hands AI)': 3.0,
        'Aider': 2.0,
        'SWE-Agent (Princeton)': 2.5,
        'LangChain Agents': 2.5,
        'Dagger': 3.5,
        're_gent': 2.0,
        // Reference tier
        'Devin (Cognition AI)': 2.5, 'Cursor': 1.5, 'Claude Code': 2.0,
      },
      outcomes: [],
      declared_ceiling: 'T5',
    },
    {
      id: 'multi_agent_orchestration',
      label: 'Multi-Agent Orchestration Rigor',
      weight: 1.8,
      category: 'core_differentiator',
      frequency: 'high',
      scores: {
        self: 7.0,
        'Kiro (AWS)': 5.0,
        'Replit Agent': 4.0,
        'spec-kit (GitHub)': 2.0,
        'BMad-METHOD': 5.5,
        'MetaGPT': 7.5,
        'CrewAI': 7.0,
        'AutoGen (Microsoft)': 7.0,
        'GPT-Engineer': 4.0,
        'OpenHands (All-Hands AI)': 6.5,
        'Aider': 3.0,
        'SWE-Agent (Princeton)': 5.5,
        'LangChain Agents': 6.5,
        'Dagger': 5.0,
        're_gent': 5.0,
        // Reference tier
        'Devin (Cognition AI)': 6.0, 'Cursor': 2.0, 'Claude Code': 3.5,
      },
      outcomes: [],
      declared_ceiling: 'T5',
    },
    {
      id: 'depth_doctrine',
      label: 'Depth Doctrine & Wave Cadence',
      weight: 1.5,
      category: 'core_differentiator',
      frequency: 'high',
      scores: {
        self: 8.0,
        'Kiro (AWS)': 2.0,
        'Replit Agent': 1.5,
        'spec-kit (GitHub)': 1.5,
        'BMad-METHOD': 2.0,
        'MetaGPT': 3.0,
        'CrewAI': 2.0,
        'AutoGen (Microsoft)': 2.5,
        'GPT-Engineer': 1.5,
        'OpenHands (All-Hands AI)': 3.5,
        'Aider': 2.0,
        'SWE-Agent (Princeton)': 3.0,
        'LangChain Agents': 2.0,
        'Dagger': 2.0,
        're_gent': 2.0,
        // Reference tier
        'Devin (Cognition AI)': 2.0, 'Cursor': 1.0, 'Claude Code': 1.5,
      },
      outcomes: [],
      declared_ceiling: 'T5',
    },
  ];
}

// ── Weight overrides for existing dimensions ─────────────────────────────────

const WEIGHT_OVERRIDES = {
  ux_polish: 0.5,
  developer_experience: 1.0,
  community_adoption: 0.0,       // excluded — unreleased product
  enterprise_readiness: 0.5,
  token_economy: 0.5,
  functionality: 1.5,
  testing: 1.3,
  spec_driven_pipeline: 1.8,
  agent_activity_provenance: 1.5,
  self_improvement: 1.3,
  security: 1.0,
  error_handling: 1.0,
  performance: 1.0,
  documentation: 0.8,
  convergence_self_healing: 1.0,
  planning_quality: 1.0,
  maintainability: 0.8,
  autonomy: 1.2,
  ecosystem_mcp: 0.8,
};

// ── Main ─────────────────────────────────────────────────────────────────────

const m = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));
const gitSha = getGitSha();
const evidence = loadEvidence();

console.log(`Git SHA: ${gitSha?.slice(0, 8) ?? 'unknown'}`);
console.log(`Evidence entries: ${evidence.size}`);
console.log();

// Restructure competitor lists
m.competitors_closed_source = ACTUAL_COMPETITORS_CLOSED;
m.competitors_oss = ACTUAL_COMPETITORS_OSS;
m.competitors_reference = REFERENCE_TIER;
m.competitors = [...ACTUAL_COMPETITORS_CLOSED, ...ACTUAL_COMPETITORS_OSS];

// Add new dimensions if they don't exist
const existingIds = new Set(m.dimensions.map(d => d.id));
for (const newDim of getNewDimensions()) {
  if (!existingIds.has(newDim.id)) {
    m.dimensions.push(newDim);
    console.log(`+ Added dimension: ${newDim.id} (weight ${newDim.weight})`);
  }
}

// Fill missing competitor scores for spec-kit and BMad-METHOD on existing dims.
// These are spec-driven tools — score them based on their actual capabilities.
const SPECKIT_DEFAULTS = {
  testing: 5.0, developer_experience: 5.5, ux_polish: 4.5, functionality: 5.0,
  autonomy: 3.0, security: 4.0, error_handling: 4.0, performance: 5.0,
  documentation: 6.0, convergence_self_healing: 3.0, spec_driven_pipeline: 7.0,
  planning_quality: 6.0, maintainability: 5.5, token_economy: 3.0,
  self_improvement: 3.0, ecosystem_mcp: 4.0, enterprise_readiness: 4.0,
  agent_activity_provenance: 2.0,
};
const BMAD_DEFAULTS = {
  testing: 5.0, developer_experience: 5.0, ux_polish: 4.0, functionality: 5.5,
  autonomy: 4.5, security: 3.5, error_handling: 4.0, performance: 4.5,
  documentation: 5.5, convergence_self_healing: 3.5, spec_driven_pipeline: 6.5,
  planning_quality: 6.0, maintainability: 5.0, token_economy: 3.0,
  self_improvement: 3.5, ecosystem_mcp: 3.5, enterprise_readiness: 3.5,
  agent_activity_provenance: 2.5,
};
// Frontier OSS frameworks — added to ACTUAL_COMPETITORS_OSS 2026-05-24.
// Scores reflect their actual capability posture as of their latest release.
const LANGGRAPH_DEFAULTS = {
  testing: 5.0, developer_experience: 5.0, ux_polish: 4.0, functionality: 6.0,
  autonomy: 7.0, security: 4.0, error_handling: 5.0, performance: 6.0,
  documentation: 5.5, convergence_self_healing: 5.0, spec_driven_pipeline: 3.0,
  planning_quality: 4.0, maintainability: 6.0, token_economy: 5.0,
  self_improvement: 4.0, ecosystem_mcp: 7.5, enterprise_readiness: 5.0,
  agent_activity_provenance: 3.0, constitutional_governance: 2.0,
  depth_doctrine: 2.0, outcome_verification: 2.0, spec_workflow_enforcement: 3.0,
};
const AGNO_DEFAULTS = {
  testing: 5.0, developer_experience: 5.5, ux_polish: 4.5, functionality: 6.5,
  autonomy: 7.5, security: 4.0, error_handling: 5.0, performance: 6.5,
  documentation: 6.0, convergence_self_healing: 5.5, spec_driven_pipeline: 3.5,
  planning_quality: 4.5, maintainability: 6.5, token_economy: 5.5,
  self_improvement: 4.5, ecosystem_mcp: 7.0, enterprise_readiness: 5.0,
  agent_activity_provenance: 3.5, constitutional_governance: 2.0,
  depth_doctrine: 2.0, outcome_verification: 2.0, spec_workflow_enforcement: 3.0,
};
const PYDANTICAI_DEFAULTS = {
  testing: 6.0, developer_experience: 6.5, ux_polish: 5.0, functionality: 6.0,
  autonomy: 6.0, security: 5.0, error_handling: 6.0, performance: 6.5,
  documentation: 7.0, convergence_self_healing: 4.0, spec_driven_pipeline: 3.0,
  planning_quality: 4.0, maintainability: 7.0, token_economy: 6.0,
  self_improvement: 3.5, ecosystem_mcp: 6.5, enterprise_readiness: 5.5,
  agent_activity_provenance: 3.0, constitutional_governance: 2.0,
  depth_doctrine: 2.0, outcome_verification: 2.5, spec_workflow_enforcement: 3.0,
};
const SMOLAAGENTS_DEFAULTS = {
  testing: 5.5, developer_experience: 5.5, ux_polish: 4.5, functionality: 5.5,
  autonomy: 6.5, security: 4.0, error_handling: 5.0, performance: 6.0,
  documentation: 6.0, convergence_self_healing: 4.5, spec_driven_pipeline: 2.5,
  planning_quality: 4.0, maintainability: 6.0, token_economy: 5.5,
  self_improvement: 4.0, ecosystem_mcp: 6.0, enterprise_readiness: 4.0,
  agent_activity_provenance: 3.0, constitutional_governance: 2.0,
  depth_doctrine: 2.0, outcome_verification: 2.0, spec_workflow_enforcement: 2.5,
};
const DSPY_DEFAULTS = {
  testing: 6.0, developer_experience: 5.5, ux_polish: 4.0, functionality: 6.0,
  autonomy: 5.5, security: 4.5, error_handling: 5.0, performance: 6.5,
  documentation: 6.5, convergence_self_healing: 4.0, spec_driven_pipeline: 4.0,
  planning_quality: 5.0, maintainability: 6.5, token_economy: 7.0,
  self_improvement: 5.5, ecosystem_mcp: 5.5, enterprise_readiness: 4.5,
  agent_activity_provenance: 3.5, constitutional_governance: 2.0,
  depth_doctrine: 3.0, outcome_verification: 3.0, spec_workflow_enforcement: 3.5,
};
for (const dim of m.dimensions) {
  if (dim.scores['spec-kit (GitHub)'] === undefined && SPECKIT_DEFAULTS[dim.id] !== undefined) {
    dim.scores['spec-kit (GitHub)'] = SPECKIT_DEFAULTS[dim.id];
  }
  if (dim.scores['BMad-METHOD'] === undefined && BMAD_DEFAULTS[dim.id] !== undefined) {
    dim.scores['BMad-METHOD'] = BMAD_DEFAULTS[dim.id];
  }
  if (dim.scores['LangGraph'] === undefined && LANGGRAPH_DEFAULTS[dim.id] !== undefined) {
    dim.scores['LangGraph'] = LANGGRAPH_DEFAULTS[dim.id];
  }
  if (dim.scores['Agno'] === undefined && AGNO_DEFAULTS[dim.id] !== undefined) {
    dim.scores['Agno'] = AGNO_DEFAULTS[dim.id];
  }
  if (dim.scores['Pydantic-AI'] === undefined && PYDANTICAI_DEFAULTS[dim.id] !== undefined) {
    dim.scores['Pydantic-AI'] = PYDANTICAI_DEFAULTS[dim.id];
  }
  if (dim.scores['SmolaAgents'] === undefined && SMOLAAGENTS_DEFAULTS[dim.id] !== undefined) {
    dim.scores['SmolaAgents'] = SMOLAAGENTS_DEFAULTS[dim.id];
  }
  if (dim.scores['DSPy'] === undefined && DSPY_DEFAULTS[dim.id] !== undefined) {
    dim.scores['DSPy'] = DSPY_DEFAULTS[dim.id];
  }
}

// Apply weight overrides and compute derived scores
let totalWeightedScore = 0;
let totalWeight = 0;

console.log();
console.log('━'.repeat(90));
console.log('DIM'.padEnd(32) + 'WEIGHT  EVIDENCE  DERIVED  TIER     STATUS');
console.log('━'.repeat(90));

for (const dim of m.dimensions) {
  // Apply weight override
  if (WEIGHT_OVERRIDES[dim.id] !== undefined) {
    dim.weight = WEIGHT_OVERRIDES[dim.id];
  }

  // Skip excluded dimensions
  if (dim.weight === 0) {
    console.log(`${dim.id.padEnd(32)} 0.0    —         —        —        EXCLUDED`);
    if (!m.excludedDimensions) m.excludedDimensions = [];
    if (!m.excludedDimensions.includes(dim.id)) m.excludedDimensions.push(dim.id);
    continue;
  }

  // Compute derived score from evidence
  const result = computeDerivedScore(dim, evidence);

  if (!result.legacy) {
    // Write to scores.derived only. scores.self is the adversarial/competitive
    // assessment and must not be overwritten by validate evidence.
    const oldDerived = dim.scores.derived;
    dim.scores.derived = result.score;
    const tierStr = result.highestFullPassedTier ?? 'none';
    const evidenceCount = result.perTier.reduce((s, p) => s + p.passing, 0);
    const totalOutcomes = result.perTier.reduce((s, p) => s + p.declared, 0);
    const changed = oldDerived !== result.score ? ` (was ${oldDerived ?? 'unset'})` : '';
    console.log(
      `${dim.id.padEnd(32)} ${dim.weight.toFixed(1).padStart(3)}    ` +
      `${evidenceCount}/${totalOutcomes}`.padEnd(10) +
      `${result.score.toFixed(1).padStart(5)}    ` +
      `${tierStr.padEnd(9)}` +
      `DERIVED${changed}`
    );
  } else {
    console.log(
      `${dim.id.padEnd(32)} ${dim.weight.toFixed(1).padStart(3)}    ` +
      `—`.padEnd(10) +
      `${(dim.scores.self ?? 0).toFixed(1).padStart(5)}    ` +
      `—`.padEnd(9) +
      `LEGACY (no outcomes)`
    );
  }

  // Compute gaps against ACTUAL competitors only
  const gaps = computeGaps(dim);
  Object.assign(dim, gaps);

  // Effective score = min(self, derived) when derived exists — evidence caps the claim.
  // If derived > self: claim is honest, evidence exceeds it (fine).
  // If derived < self: evidence doesn't support the claim → cap down.
  const effectiveScore = (dim.scores.derived !== undefined)
    ? Math.min(dim.scores.self ?? 0, dim.scores.derived)
    : (dim.scores.self ?? 0);
  totalWeightedScore += effectiveScore * dim.weight;
  totalWeight += dim.weight;
}

const overall = Math.round((totalWeightedScore / totalWeight) * 10) / 10;
m.overallSelfScore = overall;
m.lastUpdated = new Date().toISOString();

console.log('━'.repeat(90));
console.log();
console.log(`OVERALL: ${overall}/10 (weighted, actual competitors only)`);
console.log(`Total dimensions: ${m.dimensions.length} (${m.dimensions.filter(d => d.weight > 0).length} active)`);
console.log(`Actual competitors: ${m.competitors.length} (${ACTUAL_COMPETITORS_CLOSED.length} CS + ${ACTUAL_COMPETITORS_OSS.length} OSS)`);
console.log(`Reference tier: ${REFERENCE_TIER.length} (scored but excluded from gap calculations)`);
console.log();

// Priority ranking (actual competitors only)
const priorities = m.dimensions
  .filter(d => d.weight > 0)
  .map(d => ({
    id: d.id,
    self: d.scores.self,
    weight: d.weight,
    gap: d.gap_to_leader,
    leader: d.leader,
    weightedGap: d.gap_to_leader * d.weight,
  }))
  .sort((a, b) => b.weightedGap - a.weightedGap);

console.log('PRIORITY RANKING (by weighted gap against ACTUAL competitors):');
console.log('Rank  Dimension                        Self  Gap  Leader                    W*Gap');
console.log('─'.repeat(85));
for (let i = 0; i < priorities.length; i++) {
  const p = priorities[i];
  const marker = i < 4 ? ' ◄' : '';
  console.log(
    String(i + 1).padStart(3) + '   ' +
    p.id.padEnd(32) + ' ' +
    p.self.toFixed(1).padStart(4) + '  ' +
    p.gap.toFixed(1).padStart(4) + '  ' +
    p.leader.padEnd(26) +
    p.weightedGap.toFixed(2).padStart(5) + marker
  );
}

fs.writeFileSync(MATRIX_PATH, JSON.stringify(m, null, 2));
console.log(`\nWritten to ${MATRIX_PATH}`);
