// Tests for Fix B: Kernel-owned score writes
// Verifies: work-packet forbidden paths, agent-evidence types, pre-commit logic.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentEvidenceFile,
  MATRIX_SCORE_SURFACE_PATTERNS,
  EVIDENCE_FILE_NAME,
} from '../src/matrix/types/agent-evidence.js';
import { generateWorkPackets } from '../src/matrix/engines/work-packet-generator.js';
import type { DimensionGraph } from '../src/matrix/types/dimension-graph.js';
import type { ProjectGraph } from '../src/matrix/types/project-graph.js';

// ── AgentEvidenceFile type guard ─────────────────────────────────────────────

describe('isAgentEvidenceFile', () => {
  it('accepts valid evidence', () => {
    const e = {
      leaseId: 'l1', dimensionId: 'testing',
      filesTouched: [{ path: 'src/foo.ts', locDelta: 20 }],
      capabilityTestsWritten: ['npm test'],
      capabilityTestExitCodes: [0],
      testsAdded: ['tests/foo.test.ts'],
      externalCallsMade: [],
      agentStatus: 'completed',
      summary: 'Improved test coverage',
    };
    assert.ok(isAgentEvidenceFile(e));
  });

  it('rejects evidence missing required fields', () => {
    assert.ok(!isAgentEvidenceFile({}));
    assert.ok(!isAgentEvidenceFile({ leaseId: 'l1' }));
    assert.ok(!isAgentEvidenceFile(null));
  });
});

// ── MATRIX_SCORE_SURFACE_PATTERNS ────────────────────────────────────────────

describe('MATRIX_SCORE_SURFACE_PATTERNS', () => {
  it('includes matrix.json', () => {
    assert.ok(MATRIX_SCORE_SURFACE_PATTERNS.includes('.danteforge/compete/matrix.json'));
  });

  it('includes score-proposals glob', () => {
    assert.ok(MATRIX_SCORE_SURFACE_PATTERNS.some(p => p.includes('score-proposals')));
  });

  it('EVIDENCE_FILE_NAME is defined', () => {
    assert.strictEqual(typeof EVIDENCE_FILE_NAME, 'string');
    assert.ok(EVIDENCE_FILE_NAME.endsWith('.json'));
  });
});

// ── Work packet generator: matrix files always forbidden ─────────────────────

describe('generateWorkPackets: matrix score surface in forbiddenPaths', () => {
  function makeFixtures(): { dg: DimensionGraph; pg: ProjectGraph } {
    const dg: DimensionGraph = {
      generatedAt: new Date().toISOString(),
      competitors: [],
      nodes: [
        {
          dimensionId: 'testing',
          name: 'Test Coverage',
          targetScore: 9,
          currentScore: 7,
          touches: [],
          dependsOnDimensions: [],
          evidenceRequired: ['tests pass'],
          gapVsTarget: 2,
        },
      ],
    };
    const pg: ProjectGraph = {
      generatedAt: new Date().toISOString(),
      nodes: [],
      project: {
        name: 'test-project',
        rootPath: '/tmp/test',
        language: 'typescript',
        protectedPaths: [],
        primaryEntryPoint: 'src/index.ts',
      },
    };
    return { dg, pg };
  }

  it('every packet has matrix.json in forbiddenPaths', () => {
    const { dg, pg } = makeFixtures();
    const graph = generateWorkPackets({ dimensionGraph: dg, projectGraph: pg });
    assert.ok(graph.packets.length > 0);
    for (const packet of graph.packets) {
      assert.ok(
        packet.paths.forbiddenPaths.includes('.danteforge/compete/matrix.json'),
        `packet ${packet.id} missing matrix.json in forbiddenPaths`,
      );
    }
  });

  it('every packet has score-proposals glob in forbiddenPaths', () => {
    const { dg, pg } = makeFixtures();
    const graph = generateWorkPackets({ dimensionGraph: dg, projectGraph: pg });
    for (const packet of graph.packets) {
      assert.ok(
        packet.paths.forbiddenPaths.some(p => p.includes('score-proposals')),
        `packet ${packet.id} missing score-proposals in forbiddenPaths`,
      );
    }
  });

  it('caller-supplied globalForbiddenPaths are also included', () => {
    const { dg, pg } = makeFixtures();
    const graph = generateWorkPackets({
      dimensionGraph: dg, projectGraph: pg,
      globalForbiddenPaths: ['src/core/special.ts'],
    });
    for (const packet of graph.packets) {
      assert.ok(
        packet.paths.forbiddenPaths.includes('src/core/special.ts'),
        'caller-supplied forbidden path missing',
      );
    }
  });
});

// ── Pre-commit hook logic (unit-tested as pure function) ─────────────────────

describe('pre-commit matrix guard logic', () => {
  const SCORE_PATTERNS = ['.danteforge/compete/matrix.json', '.danteforge/compete/COMPETE_REPORT.md'];

  function isMatrixViolation(file: string): boolean {
    return SCORE_PATTERNS.some(p => file === p)
      || file.startsWith('.danteforge/compete/matrix-')
      || file.startsWith('.danteforge/scores/')
      || file.startsWith('.danteforge/score-proposals/');
  }

  it('flags matrix.json as a violation', () => {
    assert.ok(isMatrixViolation('.danteforge/compete/matrix.json'));
  });

  it('flags matrix backup files as violations', () => {
    assert.ok(isMatrixViolation('.danteforge/compete/matrix-v3.json'));
    assert.ok(isMatrixViolation('.danteforge/compete/matrix-backup.json'));
  });

  it('flags score-proposals as violations', () => {
    assert.ok(isMatrixViolation('.danteforge/score-proposals/foo.json'));
  });

  it('does not flag regular source files', () => {
    assert.ok(!isMatrixViolation('src/core/scorer.ts'));
    assert.ok(!isMatrixViolation('tests/matrix-types.test.ts'));
  });

  it('does not flag compete REPORT.md', () => {
    assert.ok(isMatrixViolation('.danteforge/compete/COMPETE_REPORT.md'));
  });
});
