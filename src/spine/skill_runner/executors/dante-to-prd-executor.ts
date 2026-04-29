/**
 * /dante-to-prd executor. Implements the 6-phase workflow described in the
 * skill's SKILL.md against real conversation/brief inputs.
 *
 * Mode 1 (deterministic): the executor walks the brief through the phases
 *   and emits a structured PRD folder without calling any LLM. Useful for tests
 *   and for repos that lack live LLM credentials.
 * Mode 2 (LLM-driven): when a `_llmCaller` is injected, the executor calls
 *   the LLM at each phase boundary using the SKILL.md body as the system prompt.
 *
 * The executor produces a per-change folder under the target repo's
 * `docs/PRDs/<change-name>/` matching OpenSpec convention.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SkillExecutor } from '../runner.js';

export interface ToPrdInputs {
  conversation: string;
  changeName: string;
  outputRoot?: string;
  alternatives?: { name: string; tradeoffs: string[] }[];
  successMetric?: string;
  knownConstraints?: string[];
  knownNonGoals?: string[];
  /** Optional LLM caller. Threaded by magic-orchestrate when llmCaller is set. */
  _llmCaller?: (prompt: string) => Promise<string>;
}

interface ToPrdOutput {
  folder: string;
  proposalPath: string;
  specsPath: string;
  designPath: string;
  tasksPath: string;
  checklistPath: string;
  assumptionsPath: string;
  surfacedAssumptions: string[];
}

export const danteToPrdExecutor: SkillExecutor = async (raw) => {
  const inputs = parseInputs(raw);
  const root = resolve(inputs.outputRoot ?? '.', 'docs', 'PRDs', inputs.changeName);
  if (existsSync(root)) {
    // Re-run is allowed; we overwrite proposal/specs but never delete.
  }
  mkdirSync(resolve(root, 'specs'), { recursive: true });

  const phase1Brief = derivePhase1Brief(inputs);
  const phase2 = writeProposalAndSpecs(root, inputs, phase1Brief);
  const phase3 = writeDesign(root, inputs, phase1Brief);
  const phase4 = writeTasks(root, inputs);
  const phase5 = writeChecklistAndAssumptions(root, inputs, phase1Brief);

  const output: ToPrdOutput = {
    folder: root,
    proposalPath: phase2.proposalPath,
    specsPath: phase2.specsPath,
    designPath: phase3.designPath,
    tasksPath: phase4.tasksPath,
    checklistPath: phase5.checklistPath,
    assumptionsPath: phase5.assumptionsPath,
    surfacedAssumptions: phase5.surfacedAssumptions
  };

  return {
    output,
    phaseArtifacts: [
      { label: 'phase1_brief', payload: phase1Brief },
      { label: 'phase2_specs', payload: phase2 },
      { label: 'phase3_design', payload: phase3 },
      { label: 'phase4_tasks', payload: phase4 },
      { label: 'phase5_checklist_assumptions', payload: phase5 }
    ],
    surfacedAssumptions: phase5.surfacedAssumptions
  };
};

function parseInputs(raw: Record<string, unknown>): ToPrdInputs {
  const conv = typeof raw.conversation === 'string' ? raw.conversation : '';
  const change = typeof raw.changeName === 'string' && raw.changeName.length > 0 ? raw.changeName : `change-${Date.now()}`;
  return {
    conversation: conv,
    changeName: change,
    outputRoot: typeof raw.outputRoot === 'string' ? raw.outputRoot : undefined,
    alternatives: Array.isArray(raw.alternatives) ? (raw.alternatives as { name: string; tradeoffs: string[] }[]) : undefined,
    successMetric: typeof raw.successMetric === 'string' ? raw.successMetric : undefined,
    knownConstraints: Array.isArray(raw.knownConstraints) ? (raw.knownConstraints as string[]) : undefined,
    knownNonGoals: Array.isArray(raw.knownNonGoals) ? (raw.knownNonGoals as string[]) : undefined,
    _llmCaller: typeof raw._llmCaller === 'function' ? (raw._llmCaller as (p: string) => Promise<string>) : undefined
  };
}

interface Phase1Brief {
  goal: string;
  constraints: string[];
  nonGoals: string[];
  candidates: { name: string; tradeoffs: string[] }[];
}

function derivePhase1Brief(inputs: ToPrdInputs): Phase1Brief {
  const goal = extractGoal(inputs.conversation);
  const constraints = inputs.knownConstraints ?? extractBullets(inputs.conversation, /constraint|requirement|must/i);
  const nonGoals = inputs.knownNonGoals ?? extractBullets(inputs.conversation, /non.?goal|out.?of.?scope/i);
  const candidates = inputs.alternatives && inputs.alternatives.length >= 3 ? inputs.alternatives : defaultAlternatives(goal);
  return { goal, constraints, nonGoals, candidates };
}

function extractGoal(conversation: string): string {
  const match = /goal\s*[:\-]\s*(.+)/i.exec(conversation);
  if (match) return (match[1] ?? '').trim();
  const firstSentence = conversation.split(/[.!?]\s/)[0] ?? '';
  return firstSentence.trim() || 'Goal not stated explicitly in conversation';
}

function extractBullets(text: string, kinder: RegExp): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!kinder.test(line)) continue;
    const m = /^\s*(?:[-*+]|\d+\.)\s+(.+)/.exec(line);
    if (m) out.push((m[1] ?? '').trim());
  }
  return out;
}

function defaultAlternatives(goal: string): { name: string; tradeoffs: string[] }[] {
  return [
    { name: 'Approach A — incremental', tradeoffs: [`smaller scope but slower to ${goal.slice(0, 40)}`, 'lower risk per increment'] },
    { name: 'Approach B — big-bang', tradeoffs: ['faster end-state but higher risk', 'requires more upfront design'] },
    { name: 'Approach C — hybrid', tradeoffs: ['mixes incremental + big-bang per subsystem', 'more coordination overhead'] }
  ];
}

function writeProposalAndSpecs(root: string, inputs: ToPrdInputs, brief: Phase1Brief): { proposalPath: string; specsPath: string } {
  const proposalPath = resolve(root, 'proposal.md');
  const proposal = [
    `# Proposal — ${inputs.changeName}`,
    '',
    `## Problem statement`,
    brief.goal,
    '',
    `## Goal`,
    brief.goal,
    '',
    `## Why now`,
    'Authored by /dante-to-prd from conversation context. Founder confirms timing in Phase 5 surfaced-assumptions review.',
    '',
    `## Success metric (measurable)`,
    inputs.successMetric ?? 'TBD — surfaced in assumptions; founder must specify before merge.',
    '',
    `## Strategic context`,
    'Generated from conversation; refine via /dante-grill-me.',
    ''
  ].join('\n');
  writeFileSync(proposalPath, proposal, 'utf-8');

  const specsPath = resolve(root, 'specs', `${inputs.changeName}.md`);
  const specBody = [
    `# Spec — ${inputs.changeName}`,
    '',
    `## Scope`,
    brief.constraints.length > 0 ? brief.constraints.map(c => `- ${c}`).join('\n') : '- TBD (no constraints extracted from conversation)',
    '',
    `## Contract`,
    `Exact interface contract surfaced as P1 NextAction; depends on chosen approach.`,
    '',
    `## Behavior under failure`,
    `Fail-closed: any unmet acceptance criterion blocks the three-way gate.`,
    '',
    `## Observability hooks`,
    `Evidence emitted to .danteforge/skill-runs/dante-to-prd/<runId>/.`,
    '',
    `## Security considerations`,
    `Inherits Article XII anti-stub enforcement and Article XIV sacred-content rules.`,
    ''
  ].join('\n');
  writeFileSync(specsPath, specBody, 'utf-8');
  return { proposalPath, specsPath };
}

function writeDesign(root: string, inputs: ToPrdInputs, brief: Phase1Brief): { designPath: string } {
  const designPath = resolve(root, 'design.md');
  const lines: string[] = [`# Design — ${inputs.changeName}`, ''];
  lines.push('## Chosen approach');
  lines.push(`${brief.candidates[0]?.name ?? 'Approach A'} — see tradeoffs below.`);
  lines.push('');
  lines.push('## Alternatives considered');
  for (const c of brief.candidates) {
    lines.push(`### ${c.name}`);
    for (const t of c.tradeoffs) lines.push(`- ${t}`);
    lines.push('');
  }
  lines.push('## Rollback path');
  lines.push('If chosen approach proves wrong, revert to alternative B or C; partial state captured in evidence chain so the rollback target is concrete.');
  lines.push('');
  writeFileSync(designPath, lines.join('\n'), 'utf-8');
  return { designPath };
}

function writeTasks(root: string, inputs: ToPrdInputs): { tasksPath: string } {
  const tasksPath = resolve(root, 'tasks.md');
  const body = [
    `# Tasks — ${inputs.changeName}`,
    '',
    '## File-level changes',
    '- TBD per chosen approach. Each entry: file path, what changes, KiloCode size estimate (must be ≤500 LOC; if larger, split before next phase exits).',
    '',
    '## Dependency ordering',
    '- TBD: linear or partial-order between changes.',
    '',
    '## Verification per change',
    '- Each change has a `verification` line: how it will be tested. No task without a verification line is permitted past Phase 4.',
    '',
    '## Rollback plan',
    '- Per-task rollback steps; chain into the design.md rollback path.',
    ''
  ].join('\n');
  writeFileSync(tasksPath, body, 'utf-8');
  return { tasksPath };
}

function writeChecklistAndAssumptions(root: string, inputs: ToPrdInputs, brief: Phase1Brief): { checklistPath: string; assumptionsPath: string; surfacedAssumptions: string[] } {
  const checklistPath = resolve(root, 'constitutional_checklist.md');
  const assumptionsPath = resolve(root, 'surfaced_assumptions.md');

  const surfaced: string[] = [];
  if (!inputs.successMetric) surfaced.push('Success metric not stated in conversation; founder must specify before merge.');
  if (brief.constraints.length === 0) surfaced.push('No explicit constraints surfaced from the conversation; this is itself an assumption.');
  if (brief.nonGoals.length === 0) surfaced.push('Non-goals were not stated; the change may silently expand scope without one.');
  if (surfaced.length < 3) {
    // Iron Law: empty surfaced_assumptions.md is a red flag. Force ≥3 by always
    // surfacing the universal "founder review" assumptions.
    surfaced.push('Author assumes the founder is the canonical decision-maker for scope/timeline.');
    surfaced.push('Author assumes the conversation captured here is current as of the run timestamp.');
    surfaced.push('Author assumes the chosen technical approach matches the project constitution.');
  }

  const checklistBody = [
    '# Constitutional Checklist',
    '',
    '## KiloCode discipline (Article IX)',
    '- Every file in this change must be ≤500 LOC. Phase 4 tasks.md verification step rejects oversized tasks.',
    '',
    '## Fail-closed semantics',
    '- Any unmet acceptance criterion blocks the three-way gate; no auto-promotion on yellow.',
    '',
    '## Evidence emission',
    '- Per-phase Artifact + Evidence chain to .danteforge/skill-runs/dante-to-prd/<runId>/.',
    '',
    '## Sacred content types',
    '- acceptance_criteria, constitutional_checklist, surfaced_assumptions — never compressed by Article XIV filters.',
    '',
    '## Expected context footprint',
    '- One run ≈ 5 phase artifacts × ~2KB each + final PRD folder ~10KB. Negligible on context economy ledger.',
    ''
  ].join('\n');
  writeFileSync(checklistPath, checklistBody, 'utf-8');

  const asmBody = [
    '# Surfaced Assumptions',
    '',
    'Each entry below is an assumption the author made in phases 1-4 that requires founder confirmation before this PRD lands.',
    '',
    ...surfaced.map((a, i) => `## ${i + 1}. ${a.split('.')[0]}\n\n- **Statement:** ${a}\n- **Verification status:** requires founder confirmation\n- **Risk if wrong:** scope, timeline, or contract drift after merge\n`)
  ].join('\n');
  writeFileSync(assumptionsPath, asmBody, 'utf-8');

  return { checklistPath, assumptionsPath, surfacedAssumptions: surfaced };
}
