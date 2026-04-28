/**
 * Generate a NextAction + human-readable prompt packet from a Verdict.
 * NextAction is the loop's continuation contract; the prompt packet
 * is what an executor (Claude/Codex/Kilo) consumes to do the work.
 */

import type {
  ActionType,
  Executor,
  NextAction,
  Priority,
  Verdict,
  Strictness
} from './types.js';
import { newNextActionId } from './ids.js';

export interface NextActionInputs {
  verdict: Verdict;
  targetRepo: string;
  strictness: Strictness;
  promptUri: string;
}

export function buildNextAction(inputs: NextActionInputs): NextAction {
  const v = inputs.verdict;
  const priority = pickPriority(v);
  const actionType = pickActionType(v);
  const executor = pickExecutor(v, actionType);
  const acceptanceCriteria = buildAcceptance(v, inputs.strictness);
  return {
    nextActionId: newNextActionId(v.runId),
    runId: v.runId,
    priority,
    actionType,
    targetRepo: inputs.targetRepo,
    title: buildTitle(v),
    rationale: buildRationale(v),
    acceptanceCriteria,
    recommendedExecutor: executor,
    promptUri: inputs.promptUri
  };
}

function pickPriority(v: Verdict): Priority {
  if (v.finalStatus === 'blocked' || v.finalStatus === 'escalated_to_human') return 'P0';
  if ((v.contradictedClaims?.length ?? 0) > 0) return 'P0';
  if (v.finalStatus === 'evidence_insufficient' || v.finalStatus === 'progress_real_but_not_done') return 'P1';
  return 'P2';
}

function pickActionType(v: Verdict): ActionType {
  if (v.finalStatus === 'budget_stopped') return 'budget_extension_request';
  if ((v.contradictedClaims?.length ?? 0) > 0) return 'targeted_test_request';
  if (v.finalStatus === 'blocked') return 'human_decision_request';
  if (v.finalStatus === 'evidence_insufficient') return 'evidence_collection';
  return 'implementation_prompt';
}

function pickExecutor(v: Verdict, action: ActionType): Executor {
  if (action === 'human_decision_request' || action === 'budget_extension_request') return 'human';
  if (v.finalStatus === 'blocked') return 'human';
  return 'claude_code';
}

function buildTitle(v: Verdict): string {
  const head = v.finalStatus === 'complete' ? 'Confirm completion' : 'Resolve outstanding gaps';
  return `${head} — ${v.runId}`;
}

function buildRationale(v: Verdict): string {
  const parts: string[] = [v.summary];
  if (v.blockingGaps && v.blockingGaps.length > 0) {
    parts.push(`Blocking gaps: ${v.blockingGaps.slice(0, 5).join('; ')}`);
  }
  return parts.join(' ');
}

function buildAcceptance(v: Verdict, strictness: Strictness): string[] {
  const out: string[] = [];
  if (v.contradictedClaims && v.contradictedClaims.length > 0) {
    for (const c of v.contradictedClaims.slice(0, 5)) {
      out.push(`Resolve contradiction: ${truncate(c, 140)}`);
    }
  }
  if (v.unsupportedClaims && v.unsupportedClaims.length > 0) {
    for (const c of v.unsupportedClaims.slice(0, 5)) {
      out.push(`Provide evidence for: ${truncate(c, 140)}`);
    }
  }
  if (out.length === 0) {
    out.push(`Verify ${v.supportedClaims?.length ?? 0} supported claim(s) hold under ${strictness} strictness`);
  }
  return out;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function renderPromptPacket(action: NextAction, verdict: Verdict): string {
  const lines: string[] = [];
  lines.push(`# Next Action — ${action.title}`);
  lines.push('');
  lines.push(`**Run:** ${verdict.runId}`);
  lines.push(`**Priority:** ${action.priority}`);
  lines.push(`**Action type:** ${action.actionType}`);
  lines.push(`**Recommended executor:** ${action.recommendedExecutor}`);
  lines.push(`**Target repo:** ${action.targetRepo}`);
  lines.push('');
  lines.push('## Rationale');
  lines.push(action.rationale);
  lines.push('');
  lines.push('## Acceptance criteria');
  for (const c of action.acceptanceCriteria) lines.push(`- ${c}`);
  lines.push('');
  lines.push('## Verdict summary');
  lines.push(verdict.summary);
  if (verdict.blockingGaps && verdict.blockingGaps.length > 0) {
    lines.push('');
    lines.push('## Blocking gaps');
    for (const g of verdict.blockingGaps) lines.push(`- ${g}`);
  }
  return lines.join('\n');
}
