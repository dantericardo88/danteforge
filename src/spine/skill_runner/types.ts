/**
 * Dante-native skill runner types.
 * A skill execution emits an Artifact + Evidence chain matching the truth-loop schema,
 * runs the harsh-scorer pre-flight on declared dimensions, and refuses to declare
 * complete until the three-way gate (forge policy + evidence chain + harsh score) is GREEN.
 */

import type { Artifact, Evidence, NextAction, Verdict } from '../truth_loop/types.js';
import type { EvidenceCheck, GateResult, ThreeWayGate, GateName, GateStatus } from '../three_way_gate.js';

export type { EvidenceCheck, GateResult, ThreeWayGate, GateName, GateStatus };

export interface SkillFrontmatter {
  name: string;
  description: string;
  basedOn?: string;
  attribution?: string;
  license?: string;
  constitutionalDependencies?: string[];
  requiredDimensions?: string[];
  sacredContentTypes?: string[];
}

export interface SkillRunInputs {
  /** Skill name (matches SKILL.md frontmatter `name`). */
  skillName: string;
  /** Repo root. */
  repo: string;
  /** Inputs the skill consumes (free-form per skill). */
  inputs: Record<string, unknown>;
  /** Run identifier from the parent truth-loop (or generated standalone). */
  runId?: string;
  /** Git SHA to bind proof envelopes to. If omitted, the runner tries to read it from repo. */
  gitSha?: string | null;
  /** Frontmatter loaded from SKILL.md. */
  frontmatter: SkillFrontmatter;
  /** Pre-flight scorer that returns a 0-10 score per dimension. Inject for tests. */
  scorer?: (dimensions: string[], output: unknown) => Promise<Record<string, number>> | Record<string, number>;
  /** Forge policy gate evaluator (inject for tests). Default: green. */
  policyGate?: (output: unknown) => GateResult;
  /** Evidence chain integrity check (inject for tests). Default: green if Artifact valid. */
  evidenceCheck?: EvidenceCheck;
  /** Override the now() clock for deterministic IDs. */
  now?: Date;
  /**
   * When true, the runner uses the real harsh-scorer (computeHarshScore + applyStrictOverrides
   * against `repo`) to grade declared `requiredDimensions`, instead of the injected `scorer`.
   * Closes PRD-MASTER §7.5 #2 ("each skill scores 9.0+ on the harsh double scoring matrix
   * on its required dimensions") with real scoring rather than fixture stubs.
   */
  useRealScorer?: boolean;
}

export interface SkillRunResult {
  runId: string;
  skillName: string;
  artifacts: Artifact[];
  evidence: Evidence[];
  scoresByDimension: Record<string, number>;
  gate: ThreeWayGate;
  verdict: Verdict;
  nextAction: NextAction;
  /** The opaque output the skill produced. */
  output: unknown;
  outputDir: string;
}
