// Pass 21 G4 — conversational ledger recall test.
// Uses an isolated tmp Time Machine workspace so the test is hermetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

import { createTimeMachineCommit, queryTimeMachine, verifyTimeMachine } from '../src/core/time-machine.js';

interface SyntheticEntry {
  id: number;
  topic: string;
  decision: string;
  tags: string[];
}

const ENTRIES: SyntheticEntry[] = [
  { id: 1, topic: 'time-machine-schema-version', decision: 'Pin Time Machine schema at v0.1 for the publication-plan release.', tags: ['schema', 'v0.1'] },
  { id: 2, topic: 'delegate52-license', decision: 'Use 48-domain CDLA Permissive 2.0 public release only.', tags: ['delegate52', 'license'] },
  { id: 3, topic: 'gate-1-budget', decision: 'Cap GATE-1 live run at 80 USD; agent cannot trigger live mode.', tags: ['gate-1', 'budget'] },
];

test('G4 — conversational ledger anchored to Time Machine, recall returns specific commits', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'g4-ledger-'));
  try {
    mkdirSync(resolve(workspace, 'conversations'), { recursive: true });
    const commits: Array<{ id: number; commitId: string; label: string }> = [];

    for (const entry of ENTRIES) {
      const filename = `conversations/entry_${entry.id}.json`;
      writeFileSync(resolve(workspace, filename), JSON.stringify({ ...entry, isSynthetic: true }, null, 2), 'utf8');
      const commit = await createTimeMachineCommit({
        cwd: workspace,
        paths: [filename],
        label: `truth-loop conversation: ${entry.topic} — decision recorded`,
        runId: `g4_test_${entry.id}`,
        gitSha: null,
        now: () => new Date(2026, 3, 29, 10, 0, entry.id).toISOString(),
      });
      commits.push({ id: entry.id, commitId: commit.commitId, label: commit.label });
    }

    // Recall #1: file-history finds the structural causal chain for entry-2.
    const fh = await queryTimeMachine({ cwd: workspace, kind: 'file-history', path: 'conversations/entry_2.json' });
    assert.equal(fh.status, 'ok');
    assert.equal(fh.results.length, 1);
    assert.equal((fh.results[0] as { commitId: string }).commitId, commits[1]!.commitId);

    // Recall #2: keyword recall over labels — "what did I decide about delegate52?"
    const recall = commits.filter(c => c.label.toLowerCase().includes('delegate52'));
    assert.equal(recall.length, 1);
    assert.equal(recall[0]!.id, 2);

    // Recall #3: chain integrity intact across all 3 commits.
    const verify = await verifyTimeMachine({ cwd: workspace });
    assert.equal(verify.valid, true);
    assert.equal(verify.commitsChecked, 3);
    assert.deepEqual(verify.errors, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
