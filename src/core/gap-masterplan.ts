// Gap Masterplan — converts assessment gaps into an ordered, executable plan
// Produces MASTERPLAN.md (human-readable) + masterplan.json (machine-readable)
// stored in .danteforge/ for use by the self-improve loop.

import fs from 'fs/promises';
import path from 'path';
import type { ScoringDimension } from './harsh-scorer.js';
import type { DimensionGap, CompetitorComparison } from './competitor-scanner.js';
import type { HarshScoreResult } from './harsh-scorer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MasterplanPriority = 'P0' | 'P1' | 'P2';

export interface MasterplanItem {
  id: string;                     // e.g., "P0-01"
  priority: MasterplanPriority;
  dimension: ScoringDimension;
  currentScore: number;           // 0.0-10.0
  targetScore: number;            // 9.0 by default
  title: string;
  description: string;
  forgeCommand: string;           // e.g., "danteforge forge --focus error-handling"
  verifyCondition: string;        // e.g., "npm test passes + coverage > 85%"
  estimatedDelta: number;         // expected gain in display score (0-10 scale)
  competitorContext?: string;     // "Devin scores 9.0/10 here via ..."
}

export interface Masterplan {
  generatedAt: string;
  cycleNumber: number;
  overallScore: number;           // 0.0-10.0
  targetScore: number;            // 9.0 by default
  gapToTarget: number;            // targetScore - overallScore
  items: MasterplanItem[];
  criticalCount: number;          // P0 item count
  majorCount: number;             // P1 item count
  projectedCycles: number;        // rough estimate of cycles to reach target
}

export interface GenerateMasterplanOptions {
  assessment: HarshScoreResult;
  comparison?: CompetitorComparison;
  cycleNumber?: number;
  targetScore?: number;           // 0-10 scale, default: 9.0
  cwd?: string;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  _mkdir?: (dir: string) => Promise<void>;
  _now?: () => string;
}

// ── Dimension metadata ────────────────────────────────────────────────────────

const DIMENSION_METADATA: Record<ScoringDimension, {
  title: string;
  forgeCommand: string;
  verifyCondition: string;
}> = {
  functionality: {
    title: 'Core Functionality Completeness',
    forgeCommand: 'danteforge forge "Complete all missing features and close spec gaps" --max-waves 8',
    verifyCondition: 'All SPEC requirements implemented + danteforge verify passes',
  },
  testing: {
    title: 'Test Coverage & Quality',
    forgeCommand: 'danteforge forge "Add comprehensive tests: unit, integration, edge cases" --max-waves 6',
    verifyCondition: 'Coverage >= 85%, all tests pass, npm run verify passes',
  },
  errorHandling: {
    title: 'Error Handling & Resilience',
    forgeCommand: 'danteforge forge "Add robust error handling, try/catch, custom errors, graceful degradation" --max-waves 6',
    verifyCondition: 'All async functions have error handling, no unhandled promise rejections',
  },
  security: {
    title: 'Security Hardening',
    forgeCommand: 'danteforge forge "Fix security issues: input validation, secrets management, injection prevention" --max-waves 6',
    verifyCondition: 'No hardcoded secrets, all inputs validated, npm audit passes',
  },
  uxPolish: {
    title: 'UX Polish & Accessibility',
    forgeCommand: 'danteforge forge "Improve UX: error messages, progress indicators, CLI help text, accessibility" --max-waves 5',
    verifyCondition: 'All CLI commands have --help, error messages are actionable',
  },
  documentation: {
    title: 'Documentation Quality',
    forgeCommand: 'danteforge forge "Improve documentation: README, JSDoc, examples, PDSE clarity" --max-waves 5',
    verifyCondition: 'PDSE documentation score >= 85, README covers install/usage/examples',
  },
  performance: {
    title: 'Performance Optimization',
    forgeCommand: 'danteforge forge "Optimize performance: eliminate N+1 patterns, add caching, async batching" --max-waves 5',
    verifyCondition: 'No nested await loops, no O(n²) patterns in hot paths',
  },
  maintainability: {
    title: 'Code Maintainability',
    forgeCommand: 'danteforge forge "Improve maintainability: reduce complexity, consistent patterns, type safety" --max-waves 6',
    verifyCondition: 'No functions > 100 LOC, TypeScript strict mode passes, no as-any casts',
  },
  developerExperience: {
    title: 'Developer Experience',
    forgeCommand: 'danteforge forge "Improve DX: better error messages, faster onboarding, intuitive CLI design" --max-waves 5',
    verifyCondition: 'New user can run init + first command with no external docs',
  },
  autonomy: {
    title: 'Autonomous Operation Depth',
    forgeCommand: 'danteforge forge "Deepen autonomy: improve self-correction, loop cycles, convergence quality" --max-waves 8',
    verifyCondition: 'Self-improve loop completes without human intervention in dry-run mode',
  },
  planningQuality: {
    title: 'Planning Artifact Quality',
    forgeCommand: 'danteforge forge "Improve planning artifacts: SPEC, PLAN, TASKS completeness and clarity" --max-waves 5',
    verifyCondition: 'All PDSE artifacts score >= 85, no anti-stub patterns',
  },
  selfImprovement: {
    title: 'Self-Improvement Mechanisms',
    forgeCommand: 'danteforge forge "Strengthen self-improvement: lessons capture, retro depth, convergence loops" --max-waves 6',
    verifyCondition: 'Lessons file has >= 10 entries, retro score delta is positive',
  },
  specDrivenPipeline: {
    title: 'Spec-Driven Pipeline Maturity',
    forgeCommand: 'danteforge forge "Improve spec pipeline: CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS artifact quality" --max-waves 6',
    verifyCondition: 'All 5 PDSE artifacts exist with scores >= 80, pipeline reaches tasked stage',
  },
  convergenceSelfHealing: {
    title: 'Convergence & Self-Healing Loops',
    forgeCommand: 'danteforge forge "Strengthen convergence: verify-repair cycles, auto-recovery from failures" --max-waves 8',
    verifyCondition: 'Autoforge completes with self-recovery from at least one simulated failure',
  },
  tokenEconomy: {
    title: 'Token Economy & Budget Controls',
    forgeCommand: 'danteforge forge "Improve token economy: budget fences, task routing, complexity classification" --max-waves 5',
    verifyCondition: 'Budget fence prevents overspend in dry-run mode, task-router routes correctly',
  },
  contextEconomy: {
    title: 'Context Economy & Filter Pipeline (Article XIV)',
    forgeCommand: 'danteforge forge "Implement PRD-26 context filter pipeline: sacred-content preservation, compression, telemetry" --max-waves 8',
    verifyCondition: 'Filter pipeline wired into forge/party, savings ledger written, sacred content never compressed',
  },
  ecosystemMcp: {
    title: 'Ecosystem & MCP Integration',
    forgeCommand: 'danteforge forge "Expand ecosystem: MCP tools, skills, plugin manifest, provider support" --max-waves 6',
    verifyCondition: 'MCP server exposes >= 15 tools, skill registry discovers >= 10 skills',
  },
  enterpriseReadiness: {
    title: 'Enterprise Readiness & Compliance',
    forgeCommand: 'danteforge forge "Improve enterprise readiness: audit trails, safe-self-edit, RBAC foundations, verify receipts" --max-waves 8',
    verifyCondition: 'Audit log > 20 entries, safe-self-edit policy is deny, verify receipts generated',
  },
  communityAdoption: {
    title: 'Community & Adoption Growth',
    forgeCommand: 'danteforge forge "Improve adoption: landing page, docs site, quickstart guide, contribution guidelines" --max-waves 5',
    verifyCondition: 'README has quickstart section, CONTRIBUTING.md exists, SECURITY.md exists',
  },
  causalCoherence: {
    title: 'Causal Coherence (Article XV)',
    forgeCommand: 'danteforge autoforge && danteforge causal-status',
    verifyCondition: 'globalCausalCoherence >= 0.7 after >= 20 attributions in causal-weight-matrix.json',
  },
};

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateMasterplan(opts: GenerateMasterplanOptions): Promise<Masterplan> {
  const now = opts._now ?? (() => new Date().toISOString());
  const targetScore = opts.targetScore ?? 9.0;
  const cycleNumber = opts.cycleNumber ?? 1;
  const cwd = opts.cwd ?? process.cwd();
  const writeFileFn = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf-8'));
  const mkdirFn = opts._mkdir ?? ((d: string) => fs.mkdir(d, { recursive: true }));

  // Build items from gaps
  const items = buildMasterplanItems(
    opts.assessment,
    opts.comparison,
    targetScore,
  );

  // Sort: P0 first, then P1, then P2; within priority by gap size descending
  items.sort((a, b) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2 };
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.estimatedDelta - a.estimatedDelta;
  });

  // Assign IDs
  let p0Count = 0, p1Count = 0, p2Count = 0;
  for (const item of items) {
    switch (item.priority) {
      case 'P0': item.id = `P0-${String(++p0Count).padStart(2, '0')}`; break;
      case 'P1': item.id = `P1-${String(++p1Count).padStart(2, '0')}`; break;
      case 'P2': item.id = `P2-${String(++p2Count).padStart(2, '0')}`; break;
    }
  }

  const plan: Masterplan = {
    generatedAt: now(),
    cycleNumber,
    overallScore: opts.assessment.displayScore,
    targetScore,
    gapToTarget: Math.max(0, Math.round((targetScore - opts.assessment.displayScore) * 10) / 10),
    items,
    criticalCount: p0Count,
    majorCount: p1Count,
    projectedCycles: estimateProjectedCycles(items, opts.assessment.displayScore, targetScore),
  };

  // Persist to disk (best-effort)
  try {
    const danteforgeDir = path.join(cwd, '.danteforge');
    await mkdirFn(danteforgeDir);

    // Machine-readable JSON
    await writeFileFn(
      path.join(danteforgeDir, 'masterplan.json'),
      JSON.stringify(plan, null, 2),
    );

    // Human-readable markdown
    await writeFileFn(
      path.join(danteforgeDir, 'MASTERPLAN.md'),
      formatMasterplanMarkdown(plan),
    );
  } catch { /* best-effort */ }

  return plan;
}

// ── Item builder ──────────────────────────────────────────────────────────────

function buildMasterplanItems(
  assessment: HarshScoreResult,
  comparison: CompetitorComparison | undefined,
  targetScore: number,
): MasterplanItem[] {
  const items: MasterplanItem[] = [];
  const targetInternal = targetScore * 10; // convert 9.0 → 90

  for (const [dimKey, currentInternal] of Object.entries(assessment.dimensions)) {
    const dim = dimKey as ScoringDimension;
    const currentDisplay = Math.round(currentInternal / 10 * 10) / 10;

    // Skip dimensions already at or above target
    if (currentInternal >= targetInternal) continue;

    const meta = DIMENSION_METADATA[dim];
    const gap = targetInternal - currentInternal;
    const priority = assignPriority(currentDisplay, targetScore, comparison, dim);

    // Find competitor context if available
    const compGap = comparison?.gapReport.find((g) => g.dimension === dim);
    const competitorContext = compGap && compGap.delta > 0
      ? `${compGap.bestCompetitor} scores ${(compGap.bestScore / 10).toFixed(1)}/10 here (+${(compGap.delta / 10).toFixed(1)} gap)`
      : undefined;

    items.push({
      id: '',  // assigned after sorting
      priority,
      dimension: dim,
      currentScore: currentDisplay,
      targetScore,
      title: meta.title,
      description: buildDescription(dim, currentDisplay, targetScore, compGap),
      forgeCommand: meta.forgeCommand,
      verifyCondition: meta.verifyCondition,
      estimatedDelta: Math.round(gap / 10 * 10) / 10,
      competitorContext,
    });
  }

  return items;
}

function assignPriority(
  currentDisplay: number,
  _targetScore: number,
  comparison: CompetitorComparison | undefined,
  dim: ScoringDimension,
): MasterplanPriority {
  const compGap = comparison?.gapReport.find((g) => g.dimension === dim);
  const competitorLead = compGap?.delta ?? 0;

  // P0: dimension ≤ 5.0/10 or competitor leads by ≥ 3.0 points (30 internal)
  if (currentDisplay <= 5.0 || competitorLead >= 30) return 'P0';
  // P1: dimension 5.0-7.5 or competitor leads by 1.5-3.0 points
  if (currentDisplay <= 7.5 || competitorLead >= 15) return 'P1';
  // P2: dimension 7.5-9.0
  return 'P2';
}

function buildDescription(
  dim: ScoringDimension,
  current: number,
  target: number,
  compGap: DimensionGap | undefined,
): string {
  const parts = [
    `Current score: ${current}/10 → target: ${target}/10 (gap: ${(target - current).toFixed(1)})`,
  ];
  if (compGap && compGap.delta > 0) {
    parts.push(`Best competitor: ${compGap.bestCompetitor} scores ${(compGap.bestScore / 10).toFixed(1)}/10.`);
  }
  return parts.join(' ');
}

function estimateProjectedCycles(items: MasterplanItem[], currentScore: number, targetScore: number): number {
  const gapToClose = targetScore - currentScore;
  if (gapToClose <= 0) return 0;
  // Assume each cycle gains ~0.5 points on average, with diminishing returns
  return Math.max(1, Math.ceil(gapToClose / 0.5));
}

// ── Markdown formatter ────────────────────────────────────────────────────────

export function formatMasterplanMarkdown(plan: Masterplan): string {
  const lines: string[] = [
    '# DanteForge Gap-Closing Masterplan',
    '',
    `Generated: ${plan.generatedAt}`,
    `Cycle: ${plan.cycleNumber}`,
    `Overall Score: **${plan.overallScore}/10** → Target: **${plan.targetScore}/10** (gap: ${plan.gapToTarget})`,
    `Projected cycles to target: ~${plan.projectedCycles}`,
    '',
    '## Summary',
    '',
    `| Priority | Count | Description |`,
    `| --- | --- | --- |`,
    `| P0 (Critical) | ${plan.criticalCount} | Score ≤ 5.0 or competitor leads by ≥ 3.0 points |`,
    `| P1 (Major)    | ${plan.majorCount} | Score 5.0-7.5 or competitor leads by 1.5-3.0 points |`,
    `| P2 (Minor)    | ${plan.items.filter((i) => i.priority === 'P2').length} | Score 7.5-9.0 |`,
    '',
    '## Action Items',
    '',
  ];

  for (const item of plan.items) {
    lines.push(`### ${item.id} — ${item.title}`);
    lines.push('');
    lines.push(`**Dimension:** ${item.dimension}  **Score:** ${item.currentScore}/10 → ${item.targetScore}/10  **Priority:** ${item.priority}`);
    lines.push('');
    lines.push(item.description);
    if (item.competitorContext) {
      lines.push('');
      lines.push(`> Competitor context: ${item.competitorContext}`);
    }
    lines.push('');
    lines.push(`**Execute:** \`${item.forgeCommand}\``);
    lines.push('');
    lines.push(`**Verify:** ${item.verifyCondition}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Loaders ───────────────────────────────────────────────────────────────────

export async function loadMasterplan(cwd: string): Promise<Masterplan | null> {
  const masterplanPath = path.join(cwd, '.danteforge', 'masterplan.json');
  try {
    const content = await fs.readFile(masterplanPath, 'utf-8');
    return JSON.parse(content) as Masterplan;
  } catch {
    return null;
  }
}
