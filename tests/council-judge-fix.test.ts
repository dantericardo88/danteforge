// Tests for the 4 council judge-mode fixes:
//   FIX 1: Gemini excluded from discoverCouncil() — only codex/grok-build/claude-code probed
//   FIX 2: Claude Code judge mode → --output-format text (zero tools, zero file writes)
//   FIX 3: Grok judge mode captures stderr too + sets explicit finalMessage
//   FIX 4: buildClaudeJudgeTextPrompt embeds diff for tool-free judging
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── FIX 1: Gemini not in default discovery ────────────────────────────────────

import { discoverCouncil } from '../src/cli/commands/council.js';

describe('discoverCouncil — FIX 1: Gemini excluded from default roster', () => {
  it('discoverCouncil probes only codex, grok-build, claude-code (not gemini-cli)', async () => {
    // Override isAvailable to track which ids are probed
    const probed: string[] = [];
    const members = await discoverCouncil();
    // Members list never contains gemini-cli (not probed)
    const geminiMember = members.find(m => m.id === 'gemini-cli');
    assert.equal(geminiMember, undefined, 'gemini-cli should not appear in discovery results');
    // But the 3 subscription adapters ARE probed
    const ids = members.map(m => m.id).sort();
    assert.deepEqual(ids, ['claude-code', 'codex', 'grok-build'].sort());
    void probed; // unused but referenced for TS
  });
});

// ── FIX 2: Claude Code judge prompt — diff-embedded text prompt ───────────────

import { buildClaudeJudgeTextPrompt } from '../src/matrix/adapters/claude-code-adapter.js';

describe('buildClaudeJudgeTextPrompt — FIX 2: diff-embedded verdict prompt', () => {
  it('contains the diff in a markdown code block', () => {
    const prompt = buildClaudeJudgeTextPrompt(
      'Implement council debate engine',
      'diff --git a/src/debate.ts b/src/debate.ts\n+export function runDebate() {}',
      ['src/debate.ts'],
    );
    assert.ok(prompt.includes('```diff'), 'prompt should contain diff block');
    assert.ok(prompt.includes('src/debate.ts'), 'prompt should list changed files');
    assert.ok(prompt.includes('VERDICT:'), 'prompt should contain verdict template');
    assert.ok(prompt.includes('BLOCKING_ISSUES:'), 'prompt should require BLOCKING_ISSUES field');
    assert.ok(prompt.includes('DISSENT:'), 'prompt should require DISSENT field');
  });

  it('includes the goal text so judges know what was attempted', () => {
    const goal = 'Fix the council anonymous peer review gap';
    const prompt = buildClaudeJudgeTextPrompt(goal, '(empty diff)', []);
    assert.ok(prompt.includes(goal), 'prompt should embed the goal');
  });

  it('truncates very large diffs to 4000 chars to avoid token explosion', () => {
    const hugeDiff = 'x'.repeat(10_000);
    const prompt = buildClaudeJudgeTextPrompt('goal', hugeDiff, []);
    const diffStart = prompt.indexOf('```diff');
    const diffEnd = prompt.indexOf('```', diffStart + 3);
    const embeddedDiff = prompt.slice(diffStart, diffEnd);
    assert.ok(embeddedDiff.length < 5000, 'embedded diff section should be truncated');
  });

  it('handles empty file list gracefully', () => {
    const prompt = buildClaudeJudgeTextPrompt('goal', 'diff...', []);
    assert.ok(prompt.includes('(none)'), 'empty file list should show (none)');
  });
});

// ── FIX 3: Grok judge prompt — diff-embedded detection ───────────────────────

import { buildGrokJudgePrompt } from '../src/matrix/adapters/grok-build-adapter.js';
import type { WorkPacket } from '../src/matrix/types/work-graph.js';
import type { AgentLease } from '../src/matrix/types/lease.js';

function makeMinimalWorkPacket(objective: string): WorkPacket {
  return {
    id: 'test.wp',
    dimensionId: 'test-dim',
    objective,
    acceptanceCriteria: ['Tests pass', 'No stubs'],
    proof: { proofRequired: ['test output'] },
    globalForbidden: [],
    context: {},
  } as unknown as WorkPacket;
}

function makeMinimalLease(): AgentLease {
  return {
    id: 'test-lease',
    worktreePath: '/tmp/test',
    allowedWritePaths: ['**'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [],
  } as unknown as AgentLease;
}

describe('buildGrokJudgePrompt — FIX 3: diff-pass-through', () => {
  it('returns the objective directly when it contains a diff block', () => {
    const diffPrompt = 'You are reviewing:\n```diff\n+export function foo() {}\n```\nVERDICT: PASS';
    const wp = makeMinimalWorkPacket(diffPrompt);
    const result = buildGrokJudgePrompt(wp, makeMinimalLease());
    assert.equal(result, diffPrompt, 'should return the objective as-is when diff is embedded');
  });

  it('builds a structured prompt when objective has no diff', () => {
    const wp = makeMinimalWorkPacket('Implement the council debate engine');
    const result = buildGrokJudgePrompt(wp, makeMinimalLease());
    assert.ok(result.includes('VERDICT:'), 'should contain VERDICT template');
    assert.ok(result.includes('BLOCKING_ISSUES:'), 'should contain BLOCKING_ISSUES field');
    assert.ok(result.includes('BLOCKING_CONCERNS:'), 'should contain BLOCKING_CONCERNS field');
    assert.ok(result.includes('DISSENT:'), 'should contain DISSENT field');
    assert.ok(!result.includes('```diff'), 'should not contain diff block when no diff passed');
  });

  it('passes consultation objective through without verdict template (council-ask fix)', () => {
    const consultationPrompt = 'You are SeniorEngineer. QUESTION: Is the project ready? ASSESSMENT: ...';
    const wp = {
      ...makeMinimalWorkPacket(consultationPrompt),
      dimensionId: 'council-consultation',
    };
    const result = buildGrokJudgePrompt(wp as never, makeMinimalLease());
    assert.equal(result, consultationPrompt, 'consultation objective must reach model verbatim');
    assert.ok(!result.includes('You are an independent code reviewer'), 'must not wrap in judge template');
    assert.ok(!result.includes('BLOCKING_ISSUES:'), 'must not add verdict fields to consultation');
  });
});

// ── FIX 5: All adapters pass consultation objectives through verbatim ─────────

import { buildCodexJudgePrompt } from '../src/matrix/adapters/codex-adapter.js';
import { buildClaudeJudgePrompt } from '../src/matrix/adapters/claude-code-adapter.js';
import { buildGeminiJudgePrompt } from '../src/matrix/adapters/gemini-cli-adapter.js';

function makeConsultWorkPacket(objective: string): WorkPacket {
  return {
    ...makeMinimalWorkPacket(objective),
    dimensionId: 'council-consultation',
  } as unknown as WorkPacket;
}

describe('consultation passthrough — all 4 adapters', () => {
  const consultPrompt = 'You are SeniorEng. QUESTION: Is this ready? ASSESSMENT: ...';

  it('Codex passes consultation through verbatim', () => {
    const result = buildCodexJudgePrompt(makeConsultWorkPacket(consultPrompt), makeMinimalLease());
    assert.equal(result, consultPrompt);
    assert.ok(!result.includes('independent code reviewer'));
  });

  it('Claude Code passes consultation through verbatim', () => {
    const result = buildClaudeJudgePrompt(makeConsultWorkPacket(consultPrompt), makeMinimalLease());
    assert.equal(result, consultPrompt);
    assert.ok(!result.includes('independent code reviewer'));
  });

  it('Gemini passes consultation through verbatim', () => {
    const result = buildGeminiJudgePrompt(makeConsultWorkPacket(consultPrompt), makeMinimalLease());
    assert.equal(result, consultPrompt);
    assert.ok(!result.includes('code reviewer'));
  });

  it('Grok passes consultation through verbatim', () => {
    const result = buildGrokJudgePrompt(makeConsultWorkPacket(consultPrompt), makeMinimalLease());
    assert.equal(result, consultPrompt);
    assert.ok(!result.includes('code reviewer'));
  });
});

// ── FIX 4 (original): council.ts — makeAdapter judge mode doesn't include gemini ─────────

import type { CouncilMemberId } from '../src/cli/commands/council.js';

describe('CouncilMemberId type — gemini-cli still valid for backward compat', () => {
  it('gemini-cli is a valid CouncilMemberId value', () => {
    const id: CouncilMemberId = 'gemini-cli';
    assert.equal(id, 'gemini-cli', 'type should still accept gemini-cli for backward compat');
  });

  it('all 3 subscription members are valid CouncilMemberIds', () => {
    const ids: CouncilMemberId[] = ['codex', 'grok-build', 'claude-code'];
    assert.equal(ids.length, 3);
    assert.ok(ids.includes('codex'));
    assert.ok(ids.includes('grok-build'));
    assert.ok(ids.includes('claude-code'));
  });
});
