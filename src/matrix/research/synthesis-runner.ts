// Synthesis runner — Phase P of docs/PRDs/autonomous-frontier-reaching.md.
//
// Deterministic 3-outcome synthesis: PROMOTE | CONFLICT | CAP. Reads the
// council agents' outputs from `.danteforge/research/<waveId>/<role-id>/`
// and applies the PRD's section 7 logic:
//
//   PROMOTE iff:
//     1. constitutional-reviewer has zero blocking violations
//     2. sovereignty-auditor has zero rejected dependencies
//     3. wiring-validator finds at least one proposal with low orphan-risk
//     4. cost-complexity-analyzer ranks exactly one proposal as top
//     5. AND that #1 proposal survived #1-#3
//
//   CONFLICT iff:
//     2+ proposals survive #1-#3 but cost-complexity doesn't pick a single
//     winner (i.e. multiple ranked at #1, or top-2 within 20%)
//
//   CAP iff:
//     0 proposals survive #1-#3
//     OR no constructive hypothesis was produced at all
//
// The synthesizer's verdict is BLOCKING at the substrate level. When
// PROMOTE, the operator runs `danteforge research resolve <wave-id>` to
// land the change. When CONFLICT, the dim is marked human_review_pending
// and refuses further research until the operator resolves. When CAP, the
// dim's declared_ceiling is updated and the dim is excluded from future
// research.
//
// If a `hybrid-synthesizer` agent ran and produced a non-empty
// synthesis-recommendation.md, the substrate uses ITS recommendation. The
// deterministic logic is the fallback when no LLM-driven synthesizer ran
// or when its output was malformed.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ResearchWaveOutcome } from './types.js';

export interface SynthesisInput {
  waveDir: string;
  /** Role IDs that participated in the wave (for verdict counting). */
  roleIds: string[];
  /**
   * Phase P.2: when set, the substrate runs the harden gate against the
   * dimension after a PROMOTE verdict. If the gate fails, the verdict is
   * downgraded to CONFLICT (operator must decide) — never silently dropped
   * to CAP. Pass `null` to disable (tests).
   */
  hardenGateOptions?: {
    dimensionId: string;
    dim: import('../../core/compete-matrix.js').MatrixDimension;
    cwd: string;
  } | null;
}

export interface SynthesisRecommendation {
  outcome: ResearchWaveOutcome;
  reason: string;
  /** When PROMOTE, the agent-id of the winning proposal. */
  winningAgentId?: string;
  /** When CONFLICT, the agent-ids of the surviving proposals. */
  conflictingAgentIds?: string[];
  /** When CAP, the structural reason. */
  capReason?: string;
  /** Markdown ready to write to synthesis-recommendation.md. */
  markdown: string;
  /**
   * Phase P.2 result: when PROMOTE survived the post-synthesis harden gate,
   * `null` indicates not-run; otherwise the verdict outcome.
   */
  hardenGateVerdict?: 'allowed' | 'blocked' | 'not-run';
  /** When blocked, list of failed harden checks. */
  hardenGateFailedChecks?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readIfExists(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  const raw = await readIfExists(p);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

interface SovereigntyDeps {
  audited?: Array<{ name?: string; proposed_by?: string; verdict?: string }>;
  auto_quarantined_count?: number;
  approval_blockers?: string[];
}

interface CostConfidence {
  ranked_proposals?: Array<{ agent_id?: string; rank?: number; confidence?: number }>;
  synthesis_recommendation_signal?: 'clear_winner' | 'close_call' | 'all_marginal';
}

// ── Synthesizer-agent override ───────────────────────────────────────────────

async function readSynthesizerOverride(
  waveDir: string,
): Promise<SynthesisRecommendation | null> {
  const candidate = path.join(waveDir, 'hybrid-synthesizer', 'synthesis-recommendation.md');
  const content = await readIfExists(candidate);
  if (!content) return null;
  // Parse the verdict from the first heading. The PRD's hybrid-synthesizer
  // prompt schema starts with `## Verdict: PROMOTE|CONFLICT|CAP`.
  const verdictMatch = content.match(/^##\s+Verdict:\s+(PROMOTE|CONFLICT|CAP)/im);
  if (!verdictMatch) return null;
  const outcome: ResearchWaveOutcome = verdictMatch[1]!.toLowerCase() as ResearchWaveOutcome;
  return {
    outcome,
    reason: 'hybrid-synthesizer agent produced an LLM-driven recommendation',
    markdown: content,
  };
}

// ── Constitutional + sovereignty + wiring filters ────────────────────────────

interface SurvivorRecord {
  agentId: string;
  passedConstitutional: boolean;
  passedSovereignty: boolean;
  passedWiring: boolean;
  costRank?: number;
  costConfidence?: number;
}

async function loadSurvivors(waveDir: string, roleIds: string[]): Promise<SurvivorRecord[]> {
  // Constructive agents: those who produced a hypothesis.md (not just findings).
  // From the canonical 10 roles, these are: literature-scout, frontier-reverse-engineer,
  // alternative-architect, and (sometimes) adversarial-critic when it has a "pivot" recommendation.
  const constructiveCandidates = roleIds.filter(id =>
    ['literature-scout', 'frontier-reverse-engineer', 'alternative-architect'].includes(id),
  );

  // Constitutional review (vetoes proposals listed in violations)
  const constReview = await readIfExists(path.join(waveDir, 'constitutional-reviewer', 'findings.md'));
  const violatingAgents = constReview ? extractViolatingAgents(constReview) : new Set<string>();

  // Sovereignty audit (auto-rejected dependencies disqualify their proposers)
  const sovDeps = await readJsonIfExists<SovereigntyDeps>(
    path.join(waveDir, 'sovereignty-auditor', 'dependencies.json'),
  );
  const quarantinedAgents = new Set<string>();
  if (sovDeps?.audited) {
    for (const d of sovDeps.audited) {
      if (d.verdict === 'reject' && d.proposed_by) quarantinedAgents.add(d.proposed_by);
    }
  }

  // Wiring validator (high orphan-risk proposals disqualified)
  const wiringFindings = await readIfExists(path.join(waveDir, 'wiring-validator', 'findings.md'));
  const orphanRiskAgents = wiringFindings ? extractHighOrphanRisk(wiringFindings) : new Set<string>();

  // Cost-complexity ranking
  const costConf = await readJsonIfExists<CostConfidence>(
    path.join(waveDir, 'cost-complexity-analyzer', 'confidence.json'),
  );

  const survivors: SurvivorRecord[] = [];
  for (const agentId of constructiveCandidates) {
    const hypothesisPath = path.join(waveDir, agentId, 'hypothesis.md');
    if (!(await readIfExists(hypothesisPath))) continue; // Agent didn't produce
    const passedConstitutional = !violatingAgents.has(agentId);
    const passedSovereignty = !quarantinedAgents.has(agentId);
    const passedWiring = !orphanRiskAgents.has(agentId);
    const ranked = costConf?.ranked_proposals?.find(r => r.agent_id === agentId);
    survivors.push({
      agentId,
      passedConstitutional,
      passedSovereignty,
      passedWiring,
      ...(ranked?.rank !== undefined ? { costRank: ranked.rank } : {}),
      ...(ranked?.confidence !== undefined ? { costConfidence: ranked.confidence } : {}),
    });
  }
  return survivors;
}

function extractViolatingAgents(constReview: string): Set<string> {
  // Look for a "## Violations" section and pull agent ids from following "### <agent-id>: ..." headers.
  const out = new Set<string>();
  const violationsBlock = constReview.split(/^##\s+Violations/im)[1];
  if (!violationsBlock) return out;
  // Stop at the next ## heading
  const block = violationsBlock.split(/^##\s+/im)[0]!;
  for (const m of block.matchAll(/^###\s+([\w-]+)/gm)) {
    out.add(m[1]!);
  }
  return out;
}

function extractHighOrphanRisk(wiringFindings: string): Set<string> {
  const out = new Set<string>();
  // Scan for "high orphan-risk" markers under each agent's section
  // Heuristic: find "### <agent-id>'s proposal" then look for "Orphan-risk: high"
  const sections = wiringFindings.split(/^###\s+/m);
  for (const section of sections) {
    const headerMatch = section.match(/^([\w-]+)'s proposal/);
    if (!headerMatch) continue;
    const agentId = headerMatch[1]!;
    if (/Orphan-risk\s*:\s*high/i.test(section)) {
      out.add(agentId);
    }
  }
  return out;
}

// ── Main: deterministic synthesis ────────────────────────────────────────────

export async function runDeterministicSynthesis(input: SynthesisInput): Promise<SynthesisRecommendation> {
  // 1. If hybrid-synthesizer produced a recommendation, use it.
  const override = await readSynthesizerOverride(input.waveDir);
  if (override) return override;

  // 2. Otherwise, deterministic logic.
  const survivors = await loadSurvivors(input.waveDir, input.roleIds);
  const passed = survivors.filter(s => s.passedConstitutional && s.passedSovereignty && s.passedWiring);

  // CAP: zero survivors
  if (passed.length === 0) {
    const why: string[] = [];
    if (survivors.length === 0) why.push('no constructive hypotheses produced');
    else {
      const constFails = survivors.filter(s => !s.passedConstitutional).length;
      const sovFails = survivors.filter(s => !s.passedSovereignty).length;
      const wireFails = survivors.filter(s => !s.passedWiring).length;
      if (constFails > 0) why.push(`${constFails} blocked by constitutional review`);
      if (sovFails > 0) why.push(`${sovFails} blocked by sovereignty auditor`);
      if (wireFails > 0) why.push(`${wireFails} blocked by wiring validator (orphan-risk)`);
    }
    const reason = `No proposal survived gates: ${why.join('; ')}`;
    return {
      outcome: 'cap',
      reason,
      capReason: reason,
      markdown: renderCap(reason, survivors),
    };
  }

  // PROMOTE: exactly one survivor OR one clear top-rank
  const ranked = passed.filter(s => s.costRank !== undefined).sort((a, b) => (a.costRank ?? 99) - (b.costRank ?? 99));
  let promotedWinner: SurvivorRecord | null = null;
  let promoteReason = '';
  if (passed.length === 1) {
    promotedWinner = passed[0]!;
    promoteReason = `Single survivor: ${promotedWinner.agentId}`;
  } else if (ranked.length > 0 && ranked[0]!.costRank === 1) {
    const second = ranked.find(s => s.costRank === 2);
    const firstConf = ranked[0]!.costConfidence ?? 0.5;
    const secondConf = second?.costConfidence ?? 0.5;
    if (!second || firstConf - secondConf > 0.2) {
      promotedWinner = ranked[0]!;
      promoteReason = `Clear cost-complexity winner: ${promotedWinner.agentId} (conf ${firstConf.toFixed(2)} vs runner-up ${secondConf.toFixed(2)})`;
    }
  }

  if (promotedWinner) {
    // Phase P.2: run harden gate against the dim after the synthesis says PROMOTE.
    // If the gate blocks, downgrade to CONFLICT (operator must decide) per PRD invariant I7.
    if (input.hardenGateOptions && input.hardenGateOptions !== null) {
      const { runHardenGate } = await import('../engines/hardener.js');
      const verdict = await runHardenGate({
        dimensionId: input.hardenGateOptions.dimensionId,
        dim: input.hardenGateOptions.dim,
        cwd: input.hardenGateOptions.cwd,
        _noWrite: true,
      });
      if (!verdict.allowed) {
        const failedChecks = verdict.checks.filter(c => !c.passed && !c.skipped).map(c => c.check);
        const conflictIds = passed.map(s => s.agentId);
        const blockReason = `Post-synthesis harden gate BLOCKED promotion of ${promotedWinner.agentId}: ${failedChecks.join(', ')}. Downgraded to CONFLICT per PRD P.2 — operator must decide whether to revise the proposal or accept the gate failure.`;
        return {
          outcome: 'conflict',
          reason: blockReason,
          conflictingAgentIds: conflictIds,
          markdown: renderHardenBlocked(promotedWinner, failedChecks, passed),
          hardenGateVerdict: 'blocked',
          hardenGateFailedChecks: failedChecks,
        };
      }
      // Gate allowed — promotion stands. Record verdict in recommendation.
      return {
        outcome: 'promote',
        reason: promoteReason + ' (post-synthesis harden gate passed)',
        winningAgentId: promotedWinner.agentId,
        markdown: renderPromote(promotedWinner, passed),
        hardenGateVerdict: 'allowed',
      };
    }
    return {
      outcome: 'promote',
      reason: promoteReason,
      winningAgentId: promotedWinner.agentId,
      markdown: renderPromote(promotedWinner, passed),
      hardenGateVerdict: 'not-run',
    };
  }

  // CONFLICT: 2+ survivors with no clear cost-complexity winner
  const conflictIds = passed.map(s => s.agentId);
  return {
    outcome: 'conflict',
    reason: `${passed.length} proposals survived gates with no clear winner: ${conflictIds.join(', ')}`,
    conflictingAgentIds: conflictIds,
    markdown: renderConflict(passed),
  };
}

// ── Markdown renderers ──────────────────────────────────────────────────────

function renderPromote(winner: SurvivorRecord, all: SurvivorRecord[]): string {
  const others = all.filter(s => s.agentId !== winner.agentId);
  return `# Synthesis recommendation

## Verdict: PROMOTE

## Winning proposal
- **Agent**: ${winner.agentId}
- **Cost rank**: ${winner.costRank ?? 'unranked'}
- **Cost confidence**: ${winner.costConfidence?.toFixed(2) ?? 'n/a'}

## Other surviving proposals
${others.map(s => `- ${s.agentId} (rank ${s.costRank ?? '?'}, conf ${s.costConfidence?.toFixed(2) ?? 'n/a'})`).join('\n') || '(none)'}

## Why this wins

This proposal survived all blocking gates (constitutional review, sovereignty audit, wiring validator) and either:
- was the only survivor, OR
- ranked #1 by cost-complexity analyzer with a confidence gap > 0.2 over the runner-up

## Next steps

1. Run \`danteforge research resolve <wave-id>\` to land the proposal
2. The substrate creates a feature branch \`research/<wave-id>/<dim-id>\`
3. Harden gates run automatically before merge
4. Promoted proposal becomes a new outcome on the dim
`;
}

function renderConflict(survivors: SurvivorRecord[]): string {
  return `# Synthesis recommendation

## Verdict: CONFLICT

## Surviving proposals (operator must decide)
${survivors.map(s => `- **${s.agentId}** — cost rank ${s.costRank ?? 'unranked'}, confidence ${s.costConfidence?.toFixed(2) ?? 'n/a'}`).join('\n')}

## Why no clear winner

${survivors.length} proposals passed every blocking gate but the cost-complexity analyzer does not single one out. They likely represent genuinely different architectural directions; operator judgment is required.

## Stop condition

The dimension is now marked \`human_review_pending\`. Further research is refused until the operator resolves the conflict.

## Next steps

1. Read each surviving proposal's \`hypothesis.md\`
2. Write a resolution decision to \`.danteforge/research/<wave-id>/operator-resolution.md\`
3. Run \`danteforge research resolve <wave-id>\` with the chosen agent
4. The substrate proceeds based on the resolution
`;
}

function renderHardenBlocked(
  winner: SurvivorRecord,
  failedChecks: string[],
  all: SurvivorRecord[],
): string {
  return `# Synthesis recommendation

## Verdict: CONFLICT (post-synthesis harden gate blocked promotion)

## Originally-selected proposal
- **Agent**: ${winner.agentId}
- **Cost rank**: ${winner.costRank ?? 'unranked'}
- **Why selected**: would have been PROMOTE — clear cost-complexity winner among survivors

## Why downgraded to CONFLICT

Phase P.2 of the PRD invariant: a proposal that passes the council's gates
(constitutional review, sovereignty audit, wiring validator) is still
subject to the substrate's harden gate before it can land. This proposal
failed the harden gate post-synthesis:

**Failed checks**: ${failedChecks.join(', ')}

Per PRD invariant I7 (stop conditions are mandatory, not silently worked
around), the substrate does NOT promote a proposal that fails any harden
check. It also does NOT silently drop to CAP — the council found this
proposal viable, so the operator gets the final say.

## Survivor list (all passed council gates but ${winner.agentId} hit harden gate)
${all.map(s => `- ${s.agentId}`).join('\n')}

## Next steps

1. Read \`hypothesis.md\` for ${winner.agentId}
2. Run \`danteforge harden --dim <dim> --json\` to see the specific gate failures
3. Either:
   - Revise the proposal to address the harden failures, then re-run wave
   - Write resolution to \`operator-resolution.md\` accepting the failures
     (e.g. with a documented harden_override) and run \`research resolve\`
   - Mark dim CAP if the failures represent architectural ceiling
`;
}

function renderCap(reason: string, survivors: SurvivorRecord[]): string {
  return `# Synthesis recommendation

## Verdict: CAP

## Structural reason
${reason}

## Proposals reviewed
${survivors.length === 0
  ? '(no constructive hypotheses produced)'
  : survivors.map(s => {
      const fails: string[] = [];
      if (!s.passedConstitutional) fails.push('constitutional');
      if (!s.passedSovereignty) fails.push('sovereignty');
      if (!s.passedWiring) fails.push('wiring');
      return `- **${s.agentId}** — blocked by: ${fails.join(', ') || 'none (but no rank either)'}`;
    }).join('\n')}

## Action

- Append to \`.danteforge/lessons.md\` with \`[Research]\` prefix (substrate does this automatically)
- Update dim's \`declared_ceiling\` to current achieved tier
- Mark dim as architecturally capped — excluded from future research waves

## Next steps

The substrate writes the cap state automatically. No operator action required unless the structural reason changes (e.g. a new technique becomes available that wasn't considered in this wave).
`;
}
