// Tests for Council Ask consultation mode.
// All tests use injection seams — no real subprocesses, no disk I/O.
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import { runCouncilAsk } from '../src/cli/commands/council-ask.js';
import type { CouncilMember } from '../src/cli/commands/council.js';

function fakeMembers(ids: Array<'codex' | 'gemini-cli' | 'grok-build' | 'claude-code'>): CouncilMember[] {
  const labels: Record<string, string> = {
    'codex': 'OpenAI Codex',
    'gemini-cli': 'Gemini CLI',
    'grok-build': 'Grok Build',
    'claude-code': 'Claude Code',
  };
  return ids.map(id => ({ id, label: labels[id]!, available: true }));
}

describe('runCouncilAsk', () => {
  // runCouncilAsk sets process.exitCode=3 on a sub-quorum panel (the loop-pause signal). Several fixtures
  // here deliberately produce <2 responders; reset between tests so they don't make the file exit non-zero.
  afterEach(() => { process.exitCode = 0; });

  it('quorum MET when >= 2 substantive responses (panel can cross-check)', async () => {
    const result = await runCouncilAsk({
      question: 'q',
      _discover: async () => fakeMembers(['codex', 'grok-build']),
      _dispatch: async (id) => `ASSESSMENT: ${id} ok.\nRECOMMENDATION:\n- go\nRISKS:\n- none`,
    });
    assert.equal(result.membersResponded, 2);
    assert.equal(result.quorumMet, true);
    assert.equal(result.minQuorum, 2);
  });

  it('quorum NOT met + exit 3 when < 2 respond (the unattended-loop PAUSE signal)', async () => {
    const result = await runCouncilAsk({
      question: 'q',
      _discover: async () => fakeMembers(['codex', 'grok-build']),
      _dispatch: async (id) => {
        if (id === 'grok-build') throw new Error('service down');
        return 'ASSESSMENT: ok.\nRECOMMENDATION:\n- go\nRISKS:\n- none';
      },
    });
    assert.equal(result.membersResponded, 1);
    assert.equal(result.quorumMet, false);
    assert.equal(process.exitCode, 3, 'a degraded panel sets exit 3 so a loop pauses instead of acting');
  });

  it('dispatches question to all available members', async () => {
    const called: string[] = [];
    const result = await runCouncilAsk({
      question: 'What is the biggest risk in the adapter layer?',
      _discover: async () => fakeMembers(['codex', 'gemini-cli']),
      _dispatch: async (memberId, question, _cwd) => {
        called.push(memberId);
        assert.equal(question, 'What is the biggest risk in the adapter layer?');
        return `ASSESSMENT: ${memberId} thinks the risk is timeout handling.\nRECOMMENDATION:\n- Add deadline propagation\nRISKS:\n- Silent failures`;
      },
    });
    assert.equal(result.membersAsked, 2);
    assert.equal(result.membersResponded, 2);
    assert.equal(result.membersErrored, 0);
    assert.ok(called.includes('codex'));
    assert.ok(called.includes('gemini-cli'));
  });

  it('records errors from members that fail', async () => {
    const result = await runCouncilAsk({
      question: 'Should we refactor the scheduler?',
      _discover: async () => fakeMembers(['codex', 'grok-build']),
      _dispatch: async (memberId, _q, _cwd) => {
        if (memberId === 'grok-build') throw new Error('binary not found');
        return 'ASSESSMENT: Yes.\nRECOMMENDATION:\n- Extract to module\nRISKS:\n- Regression';
      },
    });
    assert.equal(result.membersAsked, 2);
    assert.equal(result.membersResponded, 1);
    assert.equal(result.membersErrored, 1);
    const errored = result.perspectives.find(p => p.memberId === 'grok-build');
    assert.ok(errored?.error?.includes('binary not found'));
  });

  it('returns empty result when no members available', async () => {
    const result = await runCouncilAsk({
      question: 'Anything?',
      _discover: async () => [],
      _dispatch: async () => 'should not be called',
    });
    assert.equal(result.membersAsked, 0);
    assert.equal(result.perspectives.length, 0);
  });

  it('preserves question in result', async () => {
    const q = 'Is the council scheduler profile-aware routing correct?';
    const result = await runCouncilAsk({
      question: q,
      _discover: async () => fakeMembers(['claude-code']),
      _dispatch: async () => 'ASSESSMENT: Yes.\nRECOMMENDATION:\n- Keep it\nRISKS:\n- None',
    });
    assert.equal(result.question, q);
  });

  it('runs all dispatches in parallel (settled even if some throw)', async () => {
    const order: string[] = [];
    const result = await runCouncilAsk({
      question: 'Which adapters are ready?',
      _discover: async () => fakeMembers(['codex', 'gemini-cli', 'grok-build', 'claude-code']),
      _dispatch: async (memberId) => {
        order.push(memberId);
        if (memberId === 'gemini-cli') throw new Error('timeout');
        return `ASSESSMENT: ${memberId} is ready.\nRECOMMENDATION:\n- Use it\nRISKS:\n- None`;
      },
    });
    assert.equal(result.membersAsked, 4);
    assert.equal(result.membersResponded, 3);
    assert.equal(result.membersErrored, 1);
  });
});
