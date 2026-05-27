// Tests for the frontier loop engines:
//   - council-forge-brief.ts (data layer)
//   - council-research-phase.ts (research runner)
//   - council-frontier-loop.ts (orchestrator)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  tickChecklist,
  recordVerification,
  buildBriefPromptPrefix,
  buildVerifierPrompt,
  parseVerifierResponse,
  saveForgeBrief,
  loadForgeBrief,
  loadAllBriefs,
} from '../src/matrix/engines/council-forge-brief.js';
import type { ForgeBrief, ChecklistItem } from '../src/matrix/engines/council-forge-brief.js';
import { runResearchPhase } from '../src/matrix/engines/council-research-phase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeBrief(overrides: Partial<ForgeBrief> = {}): ForgeBrief {
  return {
    dimId: 'autonomy',
    dimName: 'Autonomy & Self-Direction',
    currentScore: 6.5,
    targetScore: 9.0,
    researchedBy: 'codex',
    researchedAt: '2026-01-01T00:00:00.000Z',
    ossCapabilities: [
      {
        leader: 'OpenHands',
        capability: 'autonomous retry with backoff',
        theirImplementation: 'src/core/retry.py',
        ourGap: 'no retry engine in src/core',
      },
    ],
    checklist: [
      {
        id: 'item-1',
        description: 'Implement retry engine',
        productionCallsite: 'src/core/autonomous-retry.ts:autoRetry',
        observableOutput: '[autoretry] attempt 2/3',
        testCommand: 'npx tsx --test tests/autonomous-retry.test.ts',
        effort: 'M',
        completed: false,
      },
      {
        id: 'item-2',
        description: 'Goal stack persistence',
        productionCallsite: 'src/core/goal-stack.ts:saveGoalStack',
        observableOutput: '.danteforge/goal-stack.json written on SIGINT',
        testCommand: 'npx tsx --test tests/goal-stack.test.ts',
        effort: 'S',
        completed: false,
      },
      {
        id: 'item-3',
        description: 'Self-heal on lint failure',
        productionCallsite: 'src/core/self-heal.ts:selfHealOnLint',
        observableOutput: '[self-heal] lint failed, retrying',
        testCommand: 'npx tsx --test tests/self-heal.test.ts',
        effort: 'L',
        completed: false,
      },
    ],
    completionState: {
      lastChecked: '2026-01-01T00:00:00.000Z',
      itemsComplete: [],
      itemsMissing: ['item-1', 'item-2', 'item-3'],
      projectedScore: 6.5,
    },
    verificationHistory: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ForgeBrief data layer
// ─────────────────────────────────────────────────────────────────────────────

describe('council-forge-brief', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-brief-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('tickChecklist marks items complete and updates completionState', () => {
    const brief = makeBrief();
    const updated = tickChecklist(brief, ['item-1', 'item-3']);

    assert.equal(updated.checklist.find(i => i.id === 'item-1')!.completed, true);
    assert.equal(updated.checklist.find(i => i.id === 'item-2')!.completed, false);
    assert.equal(updated.checklist.find(i => i.id === 'item-3')!.completed, true);

    assert.deepEqual(updated.completionState.itemsComplete, ['item-1', 'item-3']);
    assert.deepEqual(updated.completionState.itemsMissing, ['item-2']);
    // 2/3 complete → projectedScore between currentScore and targetScore
    assert.ok(updated.completionState.projectedScore > 6.5);
    assert.ok(updated.completionState.projectedScore < 9.0);
  });

  test('tickChecklist does not double-count already completed items', () => {
    const brief = makeBrief();
    const once = tickChecklist(brief, ['item-1']);
    const twice = tickChecklist(once, ['item-1', 'item-2']);
    assert.equal(twice.completionState.itemsComplete.length, 2);
  });

  test('tickChecklist with all items → projectedScore equals targetScore', () => {
    const brief = makeBrief();
    const updated = tickChecklist(brief, ['item-1', 'item-2', 'item-3']);
    assert.equal(updated.completionState.projectedScore, 9.0);
  });

  test('recordVerification appends round and optionally updates score', () => {
    const brief = makeBrief();
    const updated = recordVerification(brief, {
      cycle: 1,
      verifiedBy: 'grok-build',
      confirmedBy: 'codex',
      verdict: 'PASS',
      itemsBuilt: ['item-1'],
      itemsMissing: ['item-2', 'item-3'],
      notes: 'Retry engine wired correctly',
    }, 7.5);

    assert.equal(updated.verificationHistory.length, 1);
    assert.equal(updated.verificationHistory[0]!.verdict, 'PASS');
    assert.equal(updated.currentScore, 7.5);
    assert.ok(updated.verificationHistory[0]!.timestamp);
  });

  test('recordVerification FAIL does not update score unless explicitly provided', () => {
    const brief = makeBrief();
    const updated = recordVerification(brief, {
      cycle: 1,
      verifiedBy: 'grok-build',
      confirmedBy: 'codex',
      verdict: 'FAIL',
      itemsBuilt: [],
      itemsMissing: ['item-1', 'item-2', 'item-3'],
      notes: 'No changes found',
    });
    assert.equal(updated.currentScore, 6.5); // unchanged
  });

  test('buildBriefPromptPrefix returns empty string when all items complete', () => {
    const brief = makeBrief();
    const allDone = tickChecklist(brief, ['item-1', 'item-2', 'item-3']);
    const prefix = buildBriefPromptPrefix(allDone);
    assert.equal(prefix, '');
  });

  test('buildBriefPromptPrefix includes all missing items', () => {
    const brief = makeBrief();
    const prefix = buildBriefPromptPrefix(brief);
    assert.ok(prefix.includes('item-1'));
    assert.ok(prefix.includes('item-2'));
    assert.ok(prefix.includes('item-3'));
    assert.ok(prefix.includes('Autonomy'));
    assert.ok(prefix.includes('No stubs'));
  });

  test('buildBriefPromptPrefix only includes missing items after tick', () => {
    const brief = makeBrief();
    const ticked = tickChecklist(brief, ['item-1']);
    const prefix = buildBriefPromptPrefix(ticked);
    assert.ok(!prefix.includes('[item-1]'));
    assert.ok(prefix.includes('[item-2]'));
    assert.ok(prefix.includes('[item-3]'));
  });

  test('buildVerifierPrompt includes checklist items and diff', () => {
    const brief = makeBrief();
    const prompt = buildVerifierPrompt(brief, 'diff --git a/src/core/retry.ts...');
    assert.ok(prompt.includes('item-1'));
    assert.ok(prompt.includes('diff --git'));
    assert.ok(prompt.includes('BUILT:'));
    assert.ok(prompt.includes('MISSING:'));
  });

  test('parseVerifierResponse extracts built and missing IDs', () => {
    const checklist: ChecklistItem[] = [
      { id: 'item-1', description: 'A', productionCallsite: '', observableOutput: '', testCommand: '', effort: 'S', completed: false },
      { id: 'item-2', description: 'B', productionCallsite: '', observableOutput: '', testCommand: '', effort: 'M', completed: false },
      { id: 'item-3', description: 'C', productionCallsite: '', observableOutput: '', testCommand: '', effort: 'L', completed: false },
    ];

    const response = 'YES item-1 implemented. NO item-2 missing. YES item-3.\nBUILT: [item-1, item-3]\nMISSING: [item-2]';
    const { built, missing } = parseVerifierResponse(response, checklist);

    assert.deepEqual(built, ['item-1', 'item-3']);
    assert.deepEqual(missing, ['item-2']);
  });

  test('parseVerifierResponse handles empty lists gracefully', () => {
    const checklist: ChecklistItem[] = [
      { id: 'item-1', description: 'A', productionCallsite: '', observableOutput: '', testCommand: '', effort: 'S', completed: false },
    ];
    const { built, missing } = parseVerifierResponse('BUILT: []\nMISSING: []', checklist);
    assert.deepEqual(built, []);
    assert.deepEqual(missing, []);
  });

  test('parseVerifierResponse ignores IDs not in checklist', () => {
    const checklist: ChecklistItem[] = [
      { id: 'item-1', description: 'A', productionCallsite: '', observableOutput: '', testCommand: '', effort: 'S', completed: false },
    ];
    const { built } = parseVerifierResponse('BUILT: [item-1, item-99, fake-id]\nMISSING: []', checklist);
    assert.deepEqual(built, ['item-1']);
  });

  test('saveForgeBrief and loadForgeBrief round-trip correctly', async () => {
    const brief = makeBrief();
    await saveForgeBrief(tmpDir, brief);
    const loaded = await loadForgeBrief(tmpDir, 'autonomy');
    assert.ok(loaded !== null);
    assert.equal(loaded!.dimId, 'autonomy');
    assert.equal(loaded!.checklist.length, 3);
    assert.equal(loaded!.currentScore, 6.5);
  });

  test('loadForgeBrief returns null for non-existent dim', async () => {
    const result = await loadForgeBrief(tmpDir, 'nonexistent-dim');
    assert.equal(result, null);
  });

  test('loadAllBriefs returns all saved briefs', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-briefs-all-'));
    try {
      await saveForgeBrief(dir2, makeBrief({ dimId: 'autonomy', dimName: 'Autonomy' }));
      await saveForgeBrief(dir2, makeBrief({ dimId: 'testing', dimName: 'Testing' }));
      const all = await loadAllBriefs(dir2);
      assert.equal(all.length, 2);
      const ids = all.map(b => b.dimId).sort();
      assert.deepEqual(ids, ['autonomy', 'testing']);
    } finally {
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  test('loadAllBriefs returns empty array when dir does not exist', async () => {
    const result = await loadAllBriefs('/nonexistent/path/that/does/not/exist');
    assert.deepEqual(result, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ResearchPhase (with mocked adapter)
// ─────────────────────────────────────────────────────────────────────────────

describe('council-research-phase', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-phase-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('runResearchPhase writes briefs parsed from adapter output', async () => {
    const mockOutput = [
      '```forge-brief',
      JSON.stringify({
        dimId: 'autonomy',
        dimName: 'Autonomy & Self-Direction',
        ossCapabilities: [{ leader: 'OpenHands', capability: 'retry', theirImplementation: 'retry.py', ourGap: 'no retry' }],
        checklist: [
          { id: 'item-1', description: 'Add retry', productionCallsite: 'src/core/retry.ts', observableOutput: 'log line', testCommand: 'npx tsx --test tests/retry.test.ts', effort: 'M' },
        ],
      }),
      '```',
    ].join('\n');

    const mockRunAdapter = async () => ({ output: mockOutput, exitCode: 0, filesChanged: [] as string[] });

    const result = await runResearchPhase({
      projectPath: tmpDir,
      targets: [{ dimId: 'autonomy', dimName: 'Autonomy', currentScore: 6.5, targetScore: 9.0 }],
      researchers: ['codex'],
      skipExisting: false,
      _runAdapter: mockRunAdapter as never,
    });

    assert.deepEqual(result.written, ['autonomy']);
    assert.deepEqual(result.failed, []);

    const brief = await loadForgeBrief(tmpDir, 'autonomy');
    assert.ok(brief !== null);
    assert.equal(brief!.checklist.length, 1);
    assert.equal(brief!.researchedBy, 'codex');
    assert.equal(brief!.ossCapabilities[0]!.leader, 'OpenHands');
  });

  test('runResearchPhase skips dims with existing briefs when skipExisting=true', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skip-'));
    try {
      // Pre-write a brief
      await saveForgeBrief(dir2, makeBrief({ dimId: 'testing', dimName: 'Testing' }));

      let adapterCalled = false;
      const mockRunAdapter = async () => {
        adapterCalled = true;
        return { output: '', exitCode: 0, filesChanged: [] as string[] };
      };

      const result = await runResearchPhase({
        projectPath: dir2,
        targets: [{ dimId: 'testing', dimName: 'Testing', currentScore: 7.0, targetScore: 9.0 }],
        researchers: ['codex'],
        skipExisting: true,
        _runAdapter: mockRunAdapter as never,
      });

      assert.deepEqual(result.skipped, ['testing']);
      assert.equal(adapterCalled, false, 'adapter should not be called for existing briefs');
    } finally {
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  test('runResearchPhase divides dims across multiple researchers', async () => {
    const dir3 = await fs.mkdtemp(path.join(os.tmpdir(), 'research-divide-'));
    try {
      const callLog: string[] = [];
      const mockRunAdapter = async (_adapter: unknown, _input: unknown) => {
        // Identify which adapter is being called
        const adapter = _adapter as { id?: string };
        callLog.push(adapter?.id ?? 'unknown');
        return { output: '', exitCode: 0, filesChanged: [] as string[] };
      };

      await runResearchPhase({
        projectPath: dir3,
        targets: [
          { dimId: 'autonomy', dimName: 'Autonomy', currentScore: 6.5, targetScore: 9.0 },
          { dimId: 'testing', dimName: 'Testing', currentScore: 7.0, targetScore: 9.0 },
        ],
        researchers: ['codex', 'grok-build'],
        skipExisting: false,
        _runAdapter: mockRunAdapter as never,
      });

      // Both researchers should have been called
      assert.equal(callLog.length, 2);
    } finally {
      await fs.rm(dir3, { recursive: true, force: true });
    }
  });

  test('runResearchPhase handles adapter failure gracefully', async () => {
    const dir4 = await fs.mkdtemp(path.join(os.tmpdir(), 'research-fail-'));
    try {
      const mockRunAdapter = async () => {
        throw new Error('adapter unavailable');
      };

      const result = await runResearchPhase({
        projectPath: dir4,
        targets: [{ dimId: 'autonomy', dimName: 'Autonomy', currentScore: 6.5, targetScore: 9.0 }],
        researchers: ['codex'],
        skipExisting: false,
        _runAdapter: mockRunAdapter as never,
      });

      assert.deepEqual(result.written, []);
      assert.deepEqual(result.failed, ['autonomy']);
    } finally {
      await fs.rm(dir4, { recursive: true, force: true });
    }
  });
});
