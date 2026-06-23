import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFrontierLoop, classifyCourtOutput, type FrontierLoopSeams } from '../src/core/frontier-loop.js';

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-loop-')); }
const ready = async () => ({ courtReady: true, tier: 'T7', reason: '' });
// parseCourtFeedback reads `frontier-review --json` output: { result: { vote:{summary}, dissent:[...] } }.
const rejectJson = (dissent: string) => JSON.stringify({ result: { vote: { summary: 'FAIL: 0% weighted pass' }, dissent: [dissent] } });

// The convergence/ceiling logic is pure orchestration over injected seams — this pins it without spawning agents.

test('VALIDATED on the first court run → stops with validated=true (the 9)', async () => {
  const seams: FrontierLoopSeams = {
    authorLadder: ready,
    runCourt: async () => ({ verdict: 'VALIDATED', stdout: 'VALIDATED' }),
    reauthor: async () => { throw new Error('should not re-author after a validation'); },
  };
  const r = await runFrontierLoop({ dimId: 'd', configPath: 'c.json', maxIters: 3, cwd: tmp() }, seams);
  assert.equal(r.validated, true);
  assert.equal(r.iterations.length, 1);
  assert.match(r.stoppedReason, /VALIDATED/);
});

test('REJECTED then VALIDATED → re-authors once, then validates', async () => {
  let courtCalls = 0; let reauthored = 0;
  const seams: FrontierLoopSeams = {
    authorLadder: ready,
    runCourt: async () => { courtCalls++; return courtCalls === 1 ? { verdict: 'REJECTED', stdout: rejectJson('unify the isolated governance mechanisms into one routed policy engine') } : { verdict: 'VALIDATED', stdout: 'VALIDATED' }; },
    reauthor: async () => { reauthored++; },
  };
  const r = await runFrontierLoop({ dimId: 'd', configPath: 'c.json', maxIters: 3, cwd: tmp() }, seams);
  assert.equal(r.validated, true);
  assert.equal(reauthored, 1);          // re-authored evidence between the reject and the pass
  assert.equal(r.iterations.length, 2);
});

test('evidence not court-ready → stops honestly (does not run the court)', async () => {
  let courtCalls = 0;
  const seams: FrontierLoopSeams = {
    authorLadder: async () => ({ courtReady: false, tier: 'T2', reason: 'a rung failed' }),
    runCourt: async () => { courtCalls++; return { verdict: 'VALIDATED', stdout: '' }; },
    reauthor: async () => {},
  };
  const r = await runFrontierLoop({ dimId: 'd', configPath: 'c.json', maxIters: 3, cwd: tmp() }, seams);
  assert.equal(r.validated, false);
  assert.equal(courtCalls, 0);          // never ran the court on un-ready evidence
  assert.match(r.stoppedReason, /not reach a clean court-ready T7/);
});

// Codex's required pin: a court PASS that CIP blocks must NOT register as VALIDATED (no false 9).
test('classifyCourtOutput: VALIDATED only when validatedWritten && !ceilingWritten', () => {
  assert.equal(classifyCourtOutput(JSON.stringify({ result: { verdict: 'VALIDATED' }, validatedWritten: true, ceilingWritten: false })), 'VALIDATED');
  // court said VALIDATED but CIP blocked it → a ceiling was written, NOT a 9:
  assert.equal(classifyCourtOutput(JSON.stringify({ result: { verdict: 'VALIDATED' }, validatedWritten: false, ceilingWritten: true })), 'REJECTED');
  assert.equal(classifyCourtOutput(JSON.stringify({ result: { verdict: 'REJECTED' }, validatedWritten: false, ceilingWritten: false })), 'REJECTED');
  // a bare textual "VALIDATED" with no validatedWritten proof is NEVER trusted:
  assert.equal(classifyCourtOutput('the court said VALIDATED'), 'ERROR');
  assert.equal(classifyCourtOutput('frontier review needs 2 independent judges'), 'INSUFFICIENT');
});

test('the SAME objection twice → honest ceiling (no infinite re-rolling)', async () => {
  const sameDissent = rejectJson('the capability is not genuinely superior versus the named competitor on this governance axis');
  let reauthored = 0;
  const seams: FrontierLoopSeams = {
    authorLadder: ready,
    runCourt: async () => ({ verdict: 'REJECTED', stdout: sameDissent }),
    reauthor: async () => { reauthored++; },
  };
  const r = await runFrontierLoop({ dimId: 'd', configPath: 'c.json', maxIters: 9, cwd: tmp() }, seams);
  assert.equal(r.validated, false);
  assert.match(r.stoppedReason, /honest ceiling/);
  assert.ok(reauthored <= 1, 'stops re-authoring once the objection repeats — not an infinite loop');
});
