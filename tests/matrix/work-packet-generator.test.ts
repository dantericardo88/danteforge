// Phase 4 — Work Packet generator tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorkPackets } from '../../src/matrix/engines/work-packet-generator.js';
import type {
  DimensionGraph, ProjectGraph,
} from '../../src/matrix/types/index.js';

function fixtureProject(): ProjectGraph {
  return {
    project: {
      projectId: 'fixture', rootPath: '/tmp', detectedAt: '',
      buildCommands: [], verifyCommands: [],
      protectedPaths: ['src/core/frozen.ts'],
      ownershipPath: '', evidenceDir: '',
    },
    nodes: [
      { nodeId: 'file.src.core.foo.ts', type: 'file', paths: ['src/core/foo.ts'] },
      { nodeId: 'file.src.cli.commands.bar.ts', type: 'cli-command', paths: ['src/cli/commands/bar.ts'] },
      { nodeId: 'file.docs.guide.md', type: 'file', paths: ['docs/guide.md'] },
    ],
    generatedAt: '',
  };
}

function fixtureDimensions(): DimensionGraph {
  return {
    generatedAt: '',
    competitors: [],
    nodes: [
      {
        dimensionId: 'core-feature',
        name: 'Core feature delivery',
        targetScore: 9, currentScore: 3,
        touches: ['file.src.core.foo.ts'],
        dependsOnDimensions: [],
        evidenceRequired: ['feature implemented'],
        gapVsTarget: 6, gapVsOssFrontier: 4, gapVsClosedFrontier: 6,
      },
      {
        dimensionId: 'cli-ux',
        name: 'CLI UX polish',
        targetScore: 9, currentScore: 8,
        touches: ['file.src.cli.commands.bar.ts'],
        dependsOnDimensions: [],
        evidenceRequired: ['CLI works'],
        gapVsTarget: 1, gapVsOssFrontier: 0, gapVsClosedFrontier: 1,
      },
      {
        dimensionId: 'no-gap',
        name: 'Already at target',
        targetScore: 9, currentScore: 9,
        touches: [],
        dependsOnDimensions: [],
        evidenceRequired: [],
        gapVsTarget: 0,
      },
    ],
  };
}

describe('generateWorkPackets', () => {
  it('skips dimensions already at target', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    // 'no-gap' has gapVsTarget=0 and should not generate a packet
    assert.equal(graph.packets.length, 2);
    assert.ok(!graph.packets.some(p => p.dimensionId === 'no-gap'));
  });

  it('produces a packet per dimension with positive gap', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    assert.ok(graph.packets.some(p => p.dimensionId === 'core-feature'));
    assert.ok(graph.packets.some(p => p.dimensionId === 'cli-ux'));
  });

  it('assigns ownedPaths from the dimension touches', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    const corePacket = graph.packets.find(p => p.dimensionId === 'core-feature')!;
    assert.deepEqual(corePacket.paths.ownedPaths, ['src/core/foo.ts']);
  });

  it('forbids paths owned by OTHER dimensions', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    const corePacket = graph.packets.find(p => p.dimensionId === 'core-feature')!;
    assert.ok(
      corePacket.paths.forbiddenPaths.includes('src/cli/commands/bar.ts'),
      'core-feature should not be able to write to cli-ux paths',
    );
  });

  it('includes globally protected paths in forbidden', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    const corePacket = graph.packets.find(p => p.dimensionId === 'core-feature')!;
    assert.ok(corePacket.paths.forbiddenPaths.includes('src/core/frozen.ts'));
  });

  it('flags CLI command packets as tasteGateRequired', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    const cliPacket = graph.packets.find(p => p.dimensionId === 'cli-ux')!;
    assert.equal(cliPacket.tasteGateRequired, true);
  });

  it('flags high-gap packets as redTeamRequired', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    const corePacket = graph.packets.find(p => p.dimensionId === 'core-feature')!;
    assert.equal(corePacket.redTeamRequired, true, 'gap of 6 should require red-team');
  });

  it('produces packets with full acceptance + proof + rollback', () => {
    const graph = generateWorkPackets({
      dimensionGraph: fixtureDimensions(),
      projectGraph: fixtureProject(),
    });
    for (const packet of graph.packets) {
      assert.ok(packet.acceptanceCriteria.length > 0, `${packet.id} should have acceptance criteria`);
      assert.ok(packet.proof.proofRequired.length > 0, `${packet.id} should have proof requirements`);
      assert.ok(packet.rollbackPlan.length > 0, `${packet.id} should have rollback plan`);
    }
  });
});
