// Provenance cache tests — verify that findDecisionNodeForCommit is served
// from a session-level cache after the first read, and that the cache
// invalidates on mtime change.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  queryLineProvenance,
  clearProvenanceCache,
} from '../src/core/time-machine-provenance.js';
import type { TimeMachineCommit } from '../src/core/time-machine.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeTmpRoot(): Promise<{ cwd: string; root: string }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-prov-cache-'));
  tmpDirs.push(cwd);
  const root = path.join(cwd, '.danteforge', 'time-machine');
  await fs.mkdir(root, { recursive: true });
  return { cwd, root };
}

async function seedDecisionNodes(cwd: string, nodes: Array<{ id: string; fileStateRef: string; prompt: string }>): Promise<void> {
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true });
  const lines = nodes.map(n => JSON.stringify({
    id: n.id,
    schemaVersion: 'danteforge.decision.v1',
    sessionId: 'sess-test',
    timelineId: 'tl-test',
    timestamp: '2026-05-12T00:00:00Z',
    actor: { kind: 'ai', name: 'test-runner', model: 'fake' },
    input: { prompt: n.prompt, context: '', tools: [] },
    output: { fileStateRef: n.fileStateRef, summary: 'noop' },
    integrity: { hash: 'sha256:0', previousHash: null },
  }));
  await fs.writeFile(path.join(dir, 'decision-nodes.jsonl'), lines.join('\n') + '\n', 'utf8');
}

// Bypass writeLineProvenanceIndex (which needs full TimeMachineCommit infra +
// on-disk blob files) by writing the index JSON file directly. queryLineProvenance
// reads `<root>/index/line-provenance-index.json` via loadOrBuildLineProvenanceIndex.
async function seedProvenanceIndex(
  root: string,
  records: Array<{ commitId: string; filePath: string; lines: Array<{ sourceCommitId: string }> }>,
): Promise<void> {
  type IndexShape = {
    schemaVersion: string;
    updatedAt: string;
    commits: Record<string, { files: Record<string, Array<{ commitId: string; label: string; createdAt: string; sourceLine: number }>> }>;
  };
  const commits: IndexShape['commits'] = {};
  for (const r of records) {
    commits[r.commitId] = {
      files: {
        [r.filePath]: r.lines.map((l, i) => ({
          commitId: l.sourceCommitId,
          label: 'fixture',
          createdAt: '2026-05-12T00:00:00Z',
          sourceLine: i + 1,
        })),
      },
    };
  }
  const index: IndexShape = {
    schemaVersion: 'danteforge.time-machine.provenance.v1',
    updatedAt: '2026-05-12T00:00:00Z',
    commits,
  };
  const indexDir = path.join(root, 'index');
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, 'line-provenance-index.json'), JSON.stringify(index) + '\n', 'utf8');
}

// Fake TimeMachineCommit objects used purely as keys for queryLineProvenance's
// `commits` arg — it only checks `commitId` membership to decide whether the
// pre-built index is still valid. None of the other fields are read in the
// cached-lookup path we're testing.
function fakeCommitKey(commitId: string): TimeMachineCommit {
  return { commitId } as unknown as TimeMachineCommit;
}

describe('time-machine-provenance — decision-node cache', () => {
  it('serves repeated queries from the in-memory cache (single JSONL read)', async () => {
    const { cwd, root } = await makeTmpRoot();
    clearProvenanceCache();
    await seedDecisionNodes(cwd, [
      { id: 'node-1', fileStateRef: 'commit-A', prompt: 'first edit' },
      { id: 'node-2', fileStateRef: 'commit-B', prompt: 'second edit' },
    ]);
    const commits = [fakeCommitKey('commit-A'), fakeCommitKey('commit-B')];
    await seedProvenanceIndex(root, [
      { commitId: 'commit-A', filePath: 'src/feature.ts', lines: [{ sourceCommitId: 'commit-A' }, { sourceCommitId: 'commit-A' }] },
      { commitId: 'commit-B', filePath: 'src/feature.ts', lines: [{ sourceCommitId: 'commit-B' }] },
    ]);

    // Spy on fs.readFile to count store reads.
    const origReadFile = fs.readFile.bind(fs);
    let storeReadCount = 0;
    // @ts-expect-error — we deliberately monkey-patch for this test.
    fs.readFile = async (p: string, enc?: BufferEncoding) => {
      if (typeof p === 'string' && p.endsWith('decision-nodes.jsonl')) storeReadCount += 1;
      return origReadFile(p, enc);
    };

    try {
      const r1 = await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 1 });
      const r2 = await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 2 });
      const r3 = await queryLineProvenance({ cwd, root, commits, commitId: 'commit-B', filePath: 'src/feature.ts', line: 1 });
      assert.ok(r1?.decisionNode);
      assert.equal(r1?.decisionNode?.id, 'node-1');
      assert.ok(r2?.decisionNode);
      assert.equal(r2?.decisionNode?.id, 'node-1');
      assert.ok(r3?.decisionNode);
      assert.equal(r3?.decisionNode?.id, 'node-2');
      assert.equal(storeReadCount, 1, `expected exactly 1 JSONL read across 3 queries, observed ${storeReadCount}`);
    } finally {
      // @ts-expect-error restore
      fs.readFile = origReadFile;
    }
  });

  it('invalidates the cache when the JSONL mtime changes', async () => {
    const { cwd, root } = await makeTmpRoot();
    clearProvenanceCache();
    await seedDecisionNodes(cwd, [{ id: 'old', fileStateRef: 'commit-A', prompt: 'old' }]);
    const commits = [fakeCommitKey('commit-A')];
    await seedProvenanceIndex(root, [
      { commitId: 'commit-A', filePath: 'src/feature.ts', lines: [{ sourceCommitId: 'commit-A' }] },
    ]);

    const first = await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 1 });
    assert.equal(first?.decisionNode?.id, 'old');

    // Wait a tick + bump mtime by overwriting the store with a new node.
    await new Promise(r => setTimeout(r, 25));
    await seedDecisionNodes(cwd, [{ id: 'new', fileStateRef: 'commit-A', prompt: 'updated' }]);

    const second = await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 1 });
    assert.equal(second?.decisionNode?.id, 'new', 'cache must reflect the rewritten store');
  });

  it('clearProvenanceCache forces a fresh read on next query', async () => {
    const { cwd, root } = await makeTmpRoot();
    clearProvenanceCache();
    await seedDecisionNodes(cwd, [{ id: 'node-1', fileStateRef: 'commit-A', prompt: 'p' }]);
    const commits = [fakeCommitKey('commit-A')];
    await seedProvenanceIndex(root, [
      { commitId: 'commit-A', filePath: 'src/feature.ts', lines: [{ sourceCommitId: 'commit-A' }] },
    ]);

    const origReadFile = fs.readFile.bind(fs);
    let storeReadCount = 0;
    // @ts-expect-error
    fs.readFile = async (p: string, enc?: BufferEncoding) => {
      if (typeof p === 'string' && p.endsWith('decision-nodes.jsonl')) storeReadCount += 1;
      return origReadFile(p, enc);
    };
    try {
      await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 1 });
      assert.equal(storeReadCount, 1);
      // Second query — cache hit, no read.
      await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 1 });
      assert.equal(storeReadCount, 1);
      // Explicit clear forces another read on the next query.
      clearProvenanceCache();
      await queryLineProvenance({ cwd, root, commits, commitId: 'commit-A', filePath: 'src/feature.ts', line: 1 });
      assert.equal(storeReadCount, 2);
    } finally {
      // @ts-expect-error
      fs.readFile = origReadFile;
    }
  });
});
