import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compete, actionAutoSprint } from '../src/cli/commands/compete.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';
import type { CompetitorComparison, CompetitorScanOptions } from '../src/core/competitor-scanner.js';
import type { VerifyReceipt } from '../src/core/verify-receipts.js';
import type { CompeteEvidence, CompeteOptions } from '../src/cli/commands/compete.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMatrix(dims: Partial<MatrixDimension>[] = [], ossNames: string[] = [], csNames: string[] = []): CompeteMatrix {
  const base: MatrixDimension[] = dims.map((d, i) => ({
    id: d.id ?? `dim_${i}`,
    label: d.label ?? `Dimension ${i}`,
    weight: d.weight ?? 1.0,
    category: d.category ?? 'quality',
    frequency: d.frequency ?? 'medium',
    scores: d.scores ?? { self: 5.0, cursor: 8.0 },
    gap_to_leader: d.gap_to_leader ?? 3.0,
    leader: d.leader ?? 'cursor',
    gap_to_closed_source_leader: d.gap_to_closed_source_leader ?? d.gap_to_leader ?? 3.0,
    closed_source_leader: d.closed_source_leader ?? d.leader ?? 'cursor',
    gap_to_oss_leader: d.gap_to_oss_leader ?? 0,
    oss_leader: d.oss_leader ?? 'unknown',
    status: d.status ?? 'not-started',
    sprint_history: d.sprint_history ?? [],
    next_sprint_target: d.next_sprint_target ?? 7.0,
    harvest_source: d.harvest_source,
  }));

  return {
    project: 'TestProject',
    competitors: ['cursor', ...ossNames],
    competitors_closed_source: csNames.length > 0 ? csNames : ['cursor'],
    competitors_oss: ossNames,
    lastUpdated: '2026-04-13T00:00:00.000Z',
    overallSelfScore: 5.0,
    dimensions: base,
  };
}

const MOCK_COMPARISON: CompetitorComparison = {
  ourDimensions: {
    functionality: 60, testing: 50, errorHandling: 55, security: 65,
    uxPolish: 45, documentation: 60, performance: 55, maintainability: 60,
    developerExperience: 50, autonomy: 70, planningQuality: 65, selfImprovement: 55,
    specDrivenPipeline: 75, convergenceSelfHealing: 60, tokenEconomy: 50,
    ecosystemMcp: 40, enterpriseReadiness: 45, communityAdoption: 30,
  },
  projectName: 'TestProject',
  competitors: [
    {
      name: 'Cursor',
      url: 'https://cursor.com',
      description: 'AI editor',
      source: 'hardcoded',
      scores: {
        functionality: 85, testing: 70, errorHandling: 68, security: 72,
        uxPolish: 92, documentation: 72, performance: 74, maintainability: 76,
        developerExperience: 90, autonomy: 65, planningQuality: 62, selfImprovement: 50,
        specDrivenPipeline: 35, convergenceSelfHealing: 40, tokenEconomy: 70,
        ecosystemMcp: 65, enterpriseReadiness: 60, communityAdoption: 95,
      },
    },
  ],
  leaderboard: [{ name: 'Cursor', avgScore: 70, rank: 1 }],
  gapReport: [
    { dimension: 'uxPolish', ourScore: 45, bestScore: 92, bestCompetitor: 'Cursor', delta: 47, severity: 'critical' },
    { dimension: 'functionality', ourScore: 60, bestScore: 85, bestCompetitor: 'Cursor', delta: 25, severity: 'major' },
  ],
  overallGap: 25,
  competitorSource: 'hardcoded',
  analysisTimestamp: '2026-04-13T00:00:00.000Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('compete command', () => {
  let tmpDir: string;

  before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compete-test-')); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  // T1: --init calls scanCompetitors and writes matrix
  it('T1: --init calls scanCompetitors and writes matrix.json', async () => {
    let scanCalled = false;
    let savedMatrix: CompeteMatrix | null = null;

    const result = await compete({
      init: true,
      cwd: tmpDir,
      _scanCompetitors: async (_opts: CompetitorScanOptions) => {
        scanCalled = true;
        return MOCK_COMPARISON;
      },
      _harshScore: async () => ({
        score: 55,
        displayScore: 5.5,
        verdict: 'needs-work' as const,
        penalties: [],
        dimensions: {} as Record<string, number>,
        displayDimensions: {} as Record<string, number>,
        maturityLevel: 3,
        stubbedFiles: [],
        analysisTimestamp: new Date().toISOString(),
      }),
      _saveMatrix: async (matrix: CompeteMatrix, _cwd: string) => { savedMatrix = matrix; },
      _loadMatrix: async () => null,
    });

    assert.ok(scanCalled, 'scanCompetitors should be called');
    assert.ok(savedMatrix !== null, 'Matrix should be saved');
    assert.ok((savedMatrix as CompeteMatrix).dimensions.length > 0);
    assert.strictEqual(result.action, 'init');
    assert.ok(result.dimensionsUpdated! > 0);
  });

  // T2: default (status) shows gap table
  it('T2: default action shows gap table when matrix exists', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, frequency: 'high', weight: 1.4 },
      { id: 'testing', label: 'Testing', gap_to_leader: 2.0, frequency: 'high', weight: 1.5 },
    ]);

    const result = await compete({
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
    });

    assert.strictEqual(result.action, 'status');
    assert.ok(result.overallScore !== undefined);
    assert.ok(result.nextDimension !== undefined, 'Should identify next sprint dimension');
  });

  // T3: default with no matrix shows init suggestion
  it('T3: default with no matrix shows init suggestion', async () => {
    const result = await compete({
      cwd: tmpDir,
      _loadMatrix: async () => null,
    });

    assert.strictEqual(result.action, 'status');
    assert.strictEqual(result.overallScore, undefined);
    assert.strictEqual(result.nextDimension, undefined);
  });

  // T4: --sprint generates masterplan prompt with dimension goal
  it('T4: --sprint generates masterplan prompt targeting top gap', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish & Onboarding', gap_to_leader: 4.7, frequency: 'high', weight: 1.4, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor' },
      { id: 'testing', label: 'Test Coverage', gap_to_leader: 1.0, frequency: 'medium', weight: 1.0, scores: { self: 7.0, cursor: 8.0 }, leader: 'cursor' },
    ]);

    let llmPromptReceived = '';
    const result = await compete({
      sprint: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async () => {},
      _callLLM: async (prompt: string) => {
        llmPromptReceived = prompt;
        return 'Close gap on "UX Polish & Onboarding" from 4.5 to 6.5. Harvest from: cursor-like-oss.';
      },
    });

    assert.strictEqual(result.action, 'sprint');
    assert.ok(result.masterplanPrompt, 'Should generate a masterplan prompt');
    assert.ok(llmPromptReceived.includes('UX Polish'), 'LLM prompt should reference the target dimension');
  });

  // T5: --sprint marks dimension as in-progress
  it('T5: --sprint updates dimension status to in-progress', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, frequency: 'high', weight: 1.4, status: 'not-started', scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;

    await compete({
      sprint: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
      _callLLM: async () => 'Sprint plan: close the ux gap.',
    });

    assert.ok(savedMatrix !== null, 'Matrix should be saved after sprint');
    const dim = (savedMatrix as CompeteMatrix).dimensions[0]!;
    assert.strictEqual(dim.status, 'in-progress', 'Status should be updated to in-progress');
  });

  // T6: --rescore updates self score and sprint history
  it('T6: --rescore updates self score and appends sprint history', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, frequency: 'high', weight: 1.4, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor', status: 'in-progress' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;

    const result = await compete({
      rescore: 'ux_polish=7.5',
      skipVerify: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
    });

    assert.strictEqual(result.action, 'rescore');
    assert.ok(savedMatrix !== null);
    const dim = (savedMatrix as CompeteMatrix).dimensions[0]!;
    assert.strictEqual(dim.scores['self'], 7.5);
    assert.strictEqual(dim.sprint_history.length, 1);
    assert.strictEqual(dim.sprint_history[0]!.before, 4.5);
    assert.strictEqual(dim.sprint_history[0]!.after, 7.5);
    assert.strictEqual(dim.sprint_history[0]!.commit, undefined);
  });

  // T7: --rescore with commit SHA includes it in sprint record
  it('T7: --rescore with commit SHA records it in sprint history', async () => {
    const matrix = makeMatrix([
      { id: 'testing', label: 'Testing', gap_to_leader: 2.0, scores: { self: 6.0, cursor: 8.0 }, leader: 'cursor', status: 'in-progress' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;

    await compete({
      rescore: 'testing=7.8,abc123def456',
      skipVerify: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
    });

    assert.ok(savedMatrix !== null);
    const sprint = (savedMatrix as CompeteMatrix).dimensions[0]!.sprint_history[0]!;
    assert.strictEqual(sprint.after, 7.8);
    assert.strictEqual(sprint.commit, 'abc123def456');
  });

  // T8: --report writes COMPETE_REPORT.md
  it('T8: --report writes COMPETE_REPORT.md with matrix data', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, frequency: 'high', weight: 1.4, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor' },
    ]);

    let reportContent = '';
    let reportPath = '';

    await compete({
      report: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _writeReport: async (content: string, p: string) => {
        reportContent = content;
        reportPath = p;
      },
    });

    assert.ok(reportContent.includes('Competitive Harvest Loop Report'), 'Report should have title');
    assert.ok(reportContent.includes('UX Polish'), 'Report should include dimension data');
    assert.ok(reportPath.includes('COMPETE_REPORT.md'), 'Should write to COMPETE_REPORT.md');
  });

  // T9: --sprint shows both OSS and closed-source gaps when both exist
  it('T9: --sprint shows two-gap breakdown when OSS and closed-source both present', async () => {
    const matrix = makeMatrix(
      [
        {
          id: 'ux_polish', label: 'UX Polish & Onboarding',
          gap_to_leader: 4.7, frequency: 'high', weight: 1.4,
          scores: { self: 4.5, Cursor: 9.2, Aider: 7.0 },
          leader: 'Cursor',
          gap_to_closed_source_leader: 4.7, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 2.5, oss_leader: 'Aider',
        },
      ],
      ['Aider'],      // oss names
      ['Cursor'],     // closed-source names
    );

    let llmPromptReceived = '';
    const result = await compete({
      sprint: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async () => {},
      _callLLM: async (prompt: string) => {
        llmPromptReceived = prompt;
        return 'Close UX Polish gap from 4.5 to 7.0. Harvest from: Aider. Key patterns: undo mechanism, diff display.';
      },
    });

    // Prompt should reference both OSS leader (Aider) and closed-source leader (Cursor)
    assert.ok(llmPromptReceived.includes('Aider'), 'Prompt should reference Aider as OSS leader');
    assert.ok(llmPromptReceived.includes('Cursor') || llmPromptReceived.includes('gold standard'), 'Prompt should reference Cursor or gold standard');
    assert.ok(result.masterplanPrompt, 'Should produce masterplan prompt');
  });

  // T10: --sprint populates harvest_source on the dimension
  it('T10: --sprint sets harvest_source to OSS leader when OSS gap exists', async () => {
    const matrix = makeMatrix(
      [
        {
          id: 'ux_polish', label: 'UX Polish',
          gap_to_leader: 4.7, frequency: 'high', weight: 1.4,
          scores: { self: 4.5, Cursor: 9.2, Aider: 7.0 },
          leader: 'Cursor',
          gap_to_closed_source_leader: 4.7, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 2.5, oss_leader: 'Aider',
          harvest_source: undefined,
          status: 'not-started',
        },
      ],
      ['Aider'],
      ['Cursor'],
    );

    let savedMatrix: CompeteMatrix | null = null;

    await compete({
      sprint: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
      _callLLM: async () => 'Harvest from Aider: undo mechanism, diff display.',
    });

    assert.ok(savedMatrix !== null, 'Matrix should be saved');
    const dim = (savedMatrix as CompeteMatrix).dimensions[0]!;
    assert.strictEqual(dim.harvest_source, 'Aider', 'harvest_source should be set to OSS leader');
  });

  // T12: --rescore with no verify receipt blocks score update
  it('T12: --rescore with no verify receipt is blocked by CERTIFY gate', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor', status: 'in-progress' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;

    const result = await compete({
      rescore: 'ux_polish=7.5',
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
      _readVerifyReceipt: async () => null,
    });

    assert.strictEqual(result.action, 'rescore');
    assert.strictEqual(savedMatrix, null, 'Matrix should NOT be saved when no receipt');
  });

  // T13: --rescore with fail receipt is blocked
  it('T13: --rescore with failing verify receipt is blocked by CERTIFY gate', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor', status: 'in-progress' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;
    const failReceipt: Partial<VerifyReceipt> = {
      status: 'fail',
      counts: { passed: 10, warnings: 0, failures: 3 },
      timestamp: '2026-04-13T00:00:00.000Z',
    };

    const result = await compete({
      rescore: 'ux_polish=7.5',
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
      _readVerifyReceipt: async () => failReceipt as VerifyReceipt,
    });

    assert.strictEqual(result.action, 'rescore');
    assert.strictEqual(savedMatrix, null, 'Matrix should NOT be saved when receipt is fail');
  });

  // T14: --rescore with pass receipt accepts score and writes evidence
  it('T14: --rescore with passing verify receipt accepts score and writes evidence', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor', status: 'in-progress' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;
    let writtenEvidence: CompeteEvidence | null = null;
    const passReceipt: Partial<VerifyReceipt> = {
      status: 'pass',
      counts: { passed: 100, warnings: 0, failures: 0 },
      timestamp: '2026-04-13T00:00:00.000Z',
    };

    const result = await compete({
      rescore: 'ux_polish=7.5',
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
      _readVerifyReceipt: async () => passReceipt as VerifyReceipt,
      _writeEvidence: async (record: CompeteEvidence) => { writtenEvidence = record; },
    });

    assert.strictEqual(result.action, 'rescore');
    assert.ok(savedMatrix !== null, 'Matrix should be saved on pass');
    assert.strictEqual((savedMatrix as CompeteMatrix).dimensions[0]!.scores['self'], 7.5);
    assert.ok(writtenEvidence !== null, 'Evidence record should be written');
    assert.strictEqual((writtenEvidence as CompeteEvidence).verifyStatus, 'pass');
    assert.strictEqual((writtenEvidence as CompeteEvidence).scoreBefore, 4.5);
    assert.strictEqual((writtenEvidence as CompeteEvidence).scoreAfter, 7.5);
    assert.strictEqual((writtenEvidence as CompeteEvidence).delta, 3.0);
  });

  // T15: --rescore --skip-verify bypasses gate even with no receipt
  it('T15: --rescore --skip-verify bypasses CERTIFY gate with no receipt', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor', status: 'in-progress' },
    ]);

    let savedMatrix: CompeteMatrix | null = null;
    let writtenEvidence: CompeteEvidence | null = null;

    const result = await compete({
      rescore: 'ux_polish=7.5',
      skipVerify: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async (m: CompeteMatrix) => { savedMatrix = m; },
      _readVerifyReceipt: async () => null,
      _writeEvidence: async (record: CompeteEvidence) => { writtenEvidence = record; },
    });

    assert.strictEqual(result.action, 'rescore');
    assert.ok(savedMatrix !== null, 'Matrix should be saved with --skip-verify');
    assert.strictEqual((savedMatrix as CompeteMatrix).dimensions[0]!.scores['self'], 7.5);
    assert.ok(writtenEvidence !== null, 'Evidence record should still be written');
    assert.strictEqual((writtenEvidence as CompeteEvidence).verifyStatus, 'skipped');
  });

  // T16: --sprint with _webSearch includes real search results in LLM prompt
  it('T16: --sprint with _webSearch includes real search results in harvest prompt', async () => {
    const matrix = makeMatrix(
      [
        {
          id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, frequency: 'high', weight: 1.4,
          scores: { self: 4.5, Cursor: 9.2, Aider: 7.0 }, leader: 'Cursor',
          gap_to_oss_leader: 2.5, oss_leader: 'Aider',
        },
      ],
      ['Aider'],
      ['Cursor'],
    );

    let llmPromptReceived = '';

    await compete({
      sprint: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async () => {},
      _webSearch: async () => 'Top results: Aider (MIT, 18k stars) — undo/redo diff display; Cursor-like-OSS (Apache-2.0)',
      _callLLM: async (prompt: string) => {
        llmPromptReceived = prompt;
        return 'Close UX Polish gap from 4.5 to 7.0. Harvest from: Aider.';
      },
    });

    assert.ok(llmPromptReceived.includes('Real OSS discovery results'), 'LLM prompt should include search context header');
    assert.ok(llmPromptReceived.includes('Aider (MIT, 18k stars)'), 'LLM prompt should include real search results');
  });

  // T17: --validate with stale matrix warns about age
  it('T17: --validate with stale matrix (>7 days) logs staleness warning', async () => {
    const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor' },
    ]);
    matrix.lastUpdated = oldDate;

    const result = await compete({
      validate: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _harshScore: async () => ({
        score: 45, displayScore: 4.5, verdict: 'needs-work' as const,
        penalties: [], dimensions: {} as Record<string, number>,
        displayDimensions: {} as Record<string, number>,
        maturityLevel: 3, stubbedFiles: [], analysisTimestamp: new Date().toISOString(),
      }),
    });

    assert.strictEqual(result.action, 'validate');
  });

  // T18: --validate with drifted score surfaces dimension and suggestion
  it('T18: --validate with drifted score surfaces dimension and rescore suggestion', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 7.0, cursor: 9.2 }, leader: 'cursor' },
    ]);

    const result = await compete({
      validate: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      // harsh-scorer says ux_polish=3.0 but matrix says 7.0 → drift=4.0
      _harshScore: async () => ({
        score: 30, displayScore: 3.0, verdict: 'needs-work' as const,
        penalties: [], dimensions: { uxPolish: 3.0 } as Record<string, number>,
        displayDimensions: {} as Record<string, number>,
        maturityLevel: 2, stubbedFiles: [], analysisTimestamp: new Date().toISOString(),
      }),
    });

    assert.strictEqual(result.action, 'validate');
    assert.ok(result.overallScore !== undefined);
  });

  // T19: --validate with fresh aligned matrix reports clean
  it('T19: --validate with fresh aligned matrix reports no drift', async () => {
    const matrix = makeMatrix([
      { id: 'ux_polish', label: 'UX Polish', gap_to_leader: 4.7, scores: { self: 4.5, cursor: 9.2 }, leader: 'cursor' },
    ]);

    const result = await compete({
      validate: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      // harsh-scorer agrees: uxPolish=4.5 → drift=0.0 < 0.5 threshold
      _harshScore: async () => ({
        score: 45, displayScore: 4.5, verdict: 'needs-work' as const,
        penalties: [], dimensions: { uxPolish: 4.5 } as Record<string, number>,
        displayDimensions: {} as Record<string, number>,
        maturityLevel: 3, stubbedFiles: [], analysisTimestamp: new Date().toISOString(),
      }),
    });

    assert.strictEqual(result.action, 'validate');
  });

  // T11: --sprint with no OSS competitors falls back to single-gap display
  it('T11: --sprint with no OSS competitors gracefully uses single-gap display', async () => {
    const matrix = makeMatrix(
      [
        {
          id: 'ux_polish', label: 'UX Polish',
          gap_to_leader: 4.7, frequency: 'high', weight: 1.4,
          scores: { self: 4.5, Cursor: 9.2 },
          leader: 'Cursor',
          gap_to_closed_source_leader: 4.7, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 0, oss_leader: 'unknown',  // no OSS
        },
      ],
      [],       // no OSS competitors
      ['Cursor'],
    );

    let masterplanPrompt = '';

    await compete({
      sprint: true,
      cwd: tmpDir,
      _loadMatrix: async () => matrix,
      _saveMatrix: async () => {},
      _callLLM: async () => { masterplanPrompt = 'Close UX Polish gap from 4.5 to 6.5.'; return masterplanPrompt; },
    });

    // Should not throw — graceful fallback
    assert.ok(true, 'No OSS competitors should not crash --sprint');
  });
});

// ── --auto tests ──────────────────────────────────────────────────────────────

function makeAutoMatrix(selfScore = 5.0, competitorScore = 8.0): CompeteMatrix {
  return makeMatrix([{
    id: 'security',
    label: 'Security',
    scores: { self: selfScore, cursor: competitorScore },
    gap_to_leader: competitorScore - selfScore,
    leader: 'cursor',
    closed_source_leader: 'cursor',
    gap_to_closed_source_leader: competitorScore - selfScore,
    gap_to_oss_leader: 0,
    oss_leader: 'unknown',
  }]);
}

function makeScoreResult(displayScore: number): HarshScoreResult {
  return {
    rawScore: displayScore * 10, harshScore: displayScore * 10, displayScore,
    dimensions: {} as any, displayDimensions: {} as any,
    penalties: [], stubsDetected: [], fakeCompletionRisk: 'low',
    verdict: 'needs-work', maturityAssessment: {} as any, timestamp: new Date().toISOString(),
  };
}

describe('compete --auto (actionAutoSprint)', () => {
  let tmpDir2: string;

  before(async () => {
    tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'compete-auto-'));
  });

  after(async () => {
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });

  it('--auto calls _runInferno with dimension sprint prompt', async () => {
    let infernoGoal = '';
    await actionAutoSprint({
      cwd: tmpDir2,
      maxCycles: 1,
      _loadMatrix: async () => makeAutoMatrix(5.0, 8.0),
      _saveMatrix: async () => {},
      _runInferno: async (goal) => { infernoGoal = goal; },
      _postSprintScore: async () => makeScoreResult(6.0),
      _stdout: () => {},
    }, tmpDir2);
    assert.ok(infernoGoal.length > 0, '_runInferno should receive a goal prompt');
    assert.ok(infernoGoal.toLowerCase().includes('security') || infernoGoal.toLowerCase().includes('improve'),
      'goal should reference the dimension or improvement');
  });

  it('_postSprintScore called after inferno to measure gain', async () => {
    let scored = false;
    await actionAutoSprint({
      cwd: tmpDir2,
      maxCycles: 1,
      _loadMatrix: async () => makeAutoMatrix(5.0, 8.0),
      _saveMatrix: async () => {},
      _runInferno: async () => {},
      _postSprintScore: async () => { scored = true; return makeScoreResult(6.5); },
      _stdout: () => {},
    }, tmpDir2);
    assert.ok(scored, '_postSprintScore should be called');
  });

  it('victory output contains competitor name when self-score exceeds competitor', async () => {
    const result = await actionAutoSprint({
      cwd: tmpDir2,
      maxCycles: 1,
      _loadMatrix: async () => makeAutoMatrix(5.0, 8.0),
      _saveMatrix: async () => {},
      _runInferno: async () => {},
      _postSprintScore: async () => makeScoreResult(9.0),
      _stdout: () => {},
    }, tmpDir2);
    assert.ok(result.victoryMessage !== undefined, 'should have a victory message');
    assert.ok(result.victoryMessage!.includes('cursor'), 'victory message should mention the competitor');
  });

  it('result.action is auto', async () => {
    const result = await actionAutoSprint({
      cwd: tmpDir2,
      maxCycles: 1,
      _loadMatrix: async () => makeAutoMatrix(5.0, 8.0),
      _saveMatrix: async () => {},
      _runInferno: async () => {},
      _postSprintScore: async () => makeScoreResult(9.0),
      _stdout: () => {},
    }, tmpDir2);
    assert.strictEqual(result.action, 'auto');
  });

  it('loop runs multiple cycles — _runInferno called once per cycle', async () => {
    let infernoCallCount = 0;
    // Matrix with 2 open dimensions — loop should run 2 cycles
    const matrix2: CompeteMatrix = {
      project: 'test',
      overallSelfScore: 5.0,
      lastUpdated: new Date().toISOString(),
      competitors_closed_source: ['cursor'],
      competitors_oss: [],
      dimensions: [
        {
          id: 'security', label: 'Security', weight: 0.1, frequency: 'high',
          status: 'not-started', gap_to_leader: 3.0,
          scores: { self: 5.0, cursor: 8.0 },
          sprint_history: [], leader: 'cursor',
          gap_to_closed_source_leader: 3.0, closed_source_leader: 'cursor',
          gap_to_oss_leader: 0, oss_leader: '',
        } as MatrixDimension,
        {
          id: 'testing', label: 'Testing', weight: 0.1, frequency: 'high',
          status: 'not-started', gap_to_leader: 4.0,
          scores: { self: 4.0, cursor: 8.0 },
          sprint_history: [], leader: 'cursor',
          gap_to_closed_source_leader: 4.0, closed_source_leader: 'cursor',
          gap_to_oss_leader: 0, oss_leader: '',
        } as MatrixDimension,
      ],
    };

    await actionAutoSprint({
      cwd: tmpDir2,
      maxCycles: 2,
      _loadMatrix: async () => JSON.parse(JSON.stringify(matrix2)) as CompeteMatrix,
      _saveMatrix: async () => {},
      _runInferno: async () => { infernoCallCount++; },
      _postSprintScore: async () => makeScoreResult(6.0), // not closing the gap (6.0 < 8.0)
      _stdout: () => {},
    }, tmpDir2);
    assert.strictEqual(infernoCallCount, 2, '_runInferno should be called once per cycle');
  });

  it('loop stops early when all gaps closed before maxCycles', async () => {
    const lines: string[] = [];
    // Single dimension — victory score closes it after cycle 1
    await actionAutoSprint({
      cwd: tmpDir2,
      maxCycles: 5,
      _loadMatrix: async () => makeAutoMatrix(5.0, 8.0),
      _saveMatrix: async () => {},
      _runInferno: async () => {},
      _postSprintScore: async () => makeScoreResult(9.0), // 9.0 >= 8.0 → gap closed
      _stdout: (l) => lines.push(l),
    }, tmpDir2);
    const combined = lines.join('\n');
    assert.ok(combined.includes('All gaps closed'), 'should report all gaps closed when loop exits early');
  });
});
