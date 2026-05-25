// Tests for the 3 council orchestration gaps:
//   GAP 1: Anonymous peer review (candidateId in MergeCourtResult)
//   GAP 2: Typed persona protocol (blockingConcerns, dissentSummary in MemberVerdict)
//   GAP 3: Persisted CouncilSessionState with resume
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// ── GAP 1+2: MemberVerdict shape ────────────────────────────────────────────

import type { MemberVerdict } from '../src/matrix/engines/council-merge-court.js';

describe('MemberVerdict — GAP 1+2 shape', () => {
  it('has blockingConcerns and dissentSummary fields', () => {
    const v: MemberVerdict = {
      judgeId: 'codex',
      verdict: 'PASS',
      confidence: 'HIGH',
      scoreSuggestion: 8,
      reason: 'Solid implementation',
      blockingConcerns: [],
      dissentSummary: 'Minor: could use more edge case tests',
      rawOutput: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Solid\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: Minor: could use more edge case tests',
    };
    assert.equal(Array.isArray(v.blockingConcerns), true);
    assert.equal(typeof v.dissentSummary, 'string');
    assert.ok(v.dissentSummary.includes('edge case'));
  });
});

// ── GAP 2: Persona protocol ──────────────────────────────────────────────────

import { COUNCIL_PROFILES } from '../src/matrix/engines/council-member-profiles.js';

describe('CouncilMemberProfiles — GAP 2 persona', () => {
  it('all profiles have a non-empty persona string', () => {
    for (const [id, profile] of Object.entries(COUNCIL_PROFILES)) {
      assert.ok(
        typeof profile.persona === 'string' && profile.persona.length > 10,
        `Profile ${id} missing persona (got: "${String(profile.persona)}")`,
      );
    }
  });

  it('codex persona reflects security/testing orientation', () => {
    const p = COUNCIL_PROFILES['codex'];
    const lower = p.persona.toLowerCase();
    assert.ok(
      lower.includes('test') || lower.includes('security') || lower.includes('engineer'),
      `Codex persona should reflect testing/security: "${p.persona}"`,
    );
  });

  it('gemini-cli persona reflects documentation/UX orientation', () => {
    const p = COUNCIL_PROFILES['gemini-cli'];
    const lower = p.persona.toLowerCase();
    assert.ok(
      lower.includes('doc') || lower.includes('ux') || lower.includes('developer'),
      `Gemini persona should reflect docs/UX: "${p.persona}"`,
    );
  });

  it('grok-build persona reflects architecture orientation', () => {
    const p = COUNCIL_PROFILES['grok-build'];
    const lower = p.persona.toLowerCase();
    assert.ok(
      lower.includes('architect') || lower.includes('system') || lower.includes('structure'),
      `Grok persona should reflect architecture: "${p.persona}"`,
    );
  });

  it('claude-code persona reflects integration/pipeline orientation', () => {
    const p = COUNCIL_PROFILES['claude-code'];
    const lower = p.persona.toLowerCase();
    assert.ok(
      lower.includes('integration') || lower.includes('pipeline') || lower.includes('spec'),
      `Claude persona should reflect integration/pipeline: "${p.persona}"`,
    );
  });
});

// ── GAP 1: Anonymization map ─────────────────────────────────────────────────

import type { MergeCourtResult } from '../src/matrix/engines/council-merge-court.js';

describe('MergeCourtResult — GAP 1 anonymization fields', () => {
  it('result has anonymizationMap and dissentLog fields', () => {
    const r: MergeCourtResult = {
      memberId: 'codex',
      worktreePath: '/tmp/test',
      changedFiles: ['src/foo.ts'],
      verdicts: [],
      consensus: 'PASS',
      merged: true,
      anonymizationMap: { 'Candidate-Alpha': 'codex' },
      dissentLog: [],
    };
    assert.ok(r.anonymizationMap !== undefined);
    assert.equal(r.anonymizationMap['Candidate-Alpha'], 'codex');
    assert.equal(Array.isArray(r.dissentLog), true);
  });

  it('dissentLog captures minority positions even on PASS', () => {
    const r: MergeCourtResult = {
      memberId: 'grok-build',
      worktreePath: '/tmp/test',
      changedFiles: ['src/bar.ts'],
      verdicts: [],
      consensus: 'PASS',
      merged: true,
      anonymizationMap: { 'Candidate-Beta': 'grok-build' },
      dissentLog: ['[codex] Lacks comprehensive error handling in edge cases'],
    };
    assert.equal(r.dissentLog.length, 1);
    assert.ok(r.dissentLog[0]!.includes('[codex]'));
  });
});

// ── GAP 3: CouncilSessionState ───────────────────────────────────────────────

import {
  makeSessionId,
  makeInitialState,
  writeSessionState,
  loadSessionState,
  listSessions,
} from '../src/matrix/engines/council-session-state.js';

describe('CouncilSessionState — GAP 3 persistence', () => {
  it('makeSessionId returns a non-empty string', () => {
    const id = makeSessionId();
    assert.ok(typeof id === 'string' && id.startsWith('cs.'));
  });

  it('makeInitialState creates state with correct defaults', () => {
    const state = makeInitialState('cs.test.abc', 'Implement X', ['codex', 'grok-build'], 3);
    assert.equal(state.runId, 'cs.test.abc');
    assert.equal(state.goal, 'Implement X');
    assert.equal(state.round, 0);
    assert.equal(state.phase, 'schedule');
    assert.equal(state.maxRounds, 3);
    assert.equal(state.memberIds.length, 2);
    assert.equal(state.totalMerged, 0);
  });

  it('writeSessionState + loadSessionState round-trips correctly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'council-session-test-'));
    try {
      const runId = 'cs.roundtrip.test';
      const state = makeInitialState(runId, 'Build council features', ['codex', 'claude-code'], 5);
      state.round = 2;
      state.phase = 'merge';
      state.totalMerged = 3;
      state.mergeResults = [{
        memberId: 'codex', consensus: 'PASS', merged: true,
        changedFiles: ['src/a.ts'], dissentLog: [],
      }];

      await writeSessionState(tmpDir, state);
      const loaded = await loadSessionState(tmpDir, runId);

      assert.ok(loaded !== null, 'State should be loadable after write');
      assert.equal(loaded!.runId, runId);
      assert.equal(loaded!.round, 2);
      assert.equal(loaded!.phase, 'merge');
      assert.equal(loaded!.totalMerged, 3);
      assert.equal(loaded!.mergeResults.length, 1);
      assert.equal(loaded!.mergeResults[0]!.memberId, 'codex');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  });

  it('loadSessionState returns null for non-existent runId', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'council-session-missing-'));
    try {
      const result = await loadSessionState(tmpDir, 'cs.nonexistent.xyz');
      assert.equal(result, null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  });

  it('listSessions returns saved sessions sorted newest-first', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'council-session-list-'));
    try {
      const s1 = makeInitialState('cs.older.aaa', 'Goal A', ['codex'], 1);
      const s2 = makeInitialState('cs.newer.bbb', 'Goal B', ['grok-build'], 1);
      await writeSessionState(tmpDir, s1);
      await new Promise(r => setTimeout(r, 10)); // ensure mtime difference
      await writeSessionState(tmpDir, s2);

      const sessions = await listSessions(tmpDir);
      assert.ok(sessions.length >= 2);
      // Newest should come first
      const newerIdx = sessions.findIndex(s => s.runId === 'cs.newer.bbb');
      const olderIdx = sessions.findIndex(s => s.runId === 'cs.older.aaa');
      assert.ok(newerIdx < olderIdx, `Newer session (idx ${newerIdx}) should appear before older (idx ${olderIdx})`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  });

  it('writeSessionState does not throw if .danteforge dir does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'council-session-mkdir-'));
    try {
      const state = makeInitialState('cs.mkdirtest.xyz', 'test', ['codex'], 1);
      // tmpDir exists but .danteforge subdir does not
      await assert.doesNotReject(() => writeSessionState(tmpDir, state));
      const loaded = await loadSessionState(tmpDir, 'cs.mkdirtest.xyz');
      assert.ok(loaded !== null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  });
});
