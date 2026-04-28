import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runOutreachWorkflow, SEAN_LIPPAY_BRIEF } from '../src/spine/validation/sean_lippay_outreach.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'sean-lippay-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

test('outreach workflow: stops at human gate (does NOT auto-send)', async () => {
  const result = await runOutreachWorkflow({
    repo: workspace,
    brief: SEAN_LIPPAY_BRIEF
  });

  assert.equal(result.humanGate.status, 'awaiting_founder_review');
  assert.equal(result.nextAction.actionType, 'human_decision_request');
  assert.equal(result.nextAction.recommendedExecutor, 'human');
  assert.equal(result.nextAction.priority, 'P0');
});

test('outreach workflow: produces a final email draft with all required topics', async () => {
  const result = await runOutreachWorkflow({
    repo: workspace,
    brief: SEAN_LIPPAY_BRIEF
  });

  const draft = readFileSync(resolve(result.outDir, 'final_email_draft.md'), 'utf-8');
  assert.match(draft, /Sean Lippay/);
  assert.match(draft, /capacity/i);
  assert.match(draft, /GFSI/);
  assert.match(draft, /pricing/i);
  assert.match(draft, /Rational 202G/);
  assert.match(draft, /MFM 3600/);
});

test('outreach workflow: founder actions enumerate the manual send steps', async () => {
  const result = await runOutreachWorkflow({
    repo: workspace,
    brief: SEAN_LIPPAY_BRIEF
  });

  const actions = result.humanGate.founderActions.join(' ');
  assert.match(actions, /review/i);
  assert.match(actions, /send/i);
  assert.match(actions, /truth-loop/i, 'workflow should require truth-loop confirmation after send');
});

test('outreach workflow: writes evidence + human_gate.json + next_action_prompt.md', async () => {
  const result = await runOutreachWorkflow({
    repo: workspace,
    brief: SEAN_LIPPAY_BRIEF
  });

  assert.ok(existsSync(resolve(result.outDir, 'final_email_draft.md')));
  assert.ok(existsSync(resolve(result.outDir, 'human_gate.json')));
  assert.ok(existsSync(resolve(result.outDir, 'next_action_prompt.md')));
});

test('outreach workflow: surfaced assumptions become opinion claims (founder must confirm)', async () => {
  const result = await runOutreachWorkflow({
    repo: workspace,
    brief: SEAN_LIPPAY_BRIEF
  });

  const opinionCount = result.grillVerdict.opinionClaims?.length ?? 0;
  assert.ok(opinionCount >= 3, `expected ≥3 surfaced assumptions, got ${opinionCount}`);
});

test('outreach workflow: tone preference flows through to synthesis selection', async () => {
  const conciseResult = await runOutreachWorkflow({
    repo: workspace,
    brief: { ...SEAN_LIPPAY_BRIEF, founderTonePreference: 'concise' }
  });

  // Concise draft is the shortest of the three
  const draft = conciseResult.finalEmailDraft;
  assert.match(draft, /Three quick answers/);
});
