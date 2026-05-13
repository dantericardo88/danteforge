// Phase 5 — Ownership Map tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadOwnershipMap,
  pathOwner,
  isPathFrozen,
  pathsForWorkstream,
  isPathGloballyAllowed,
} from '../../src/matrix/engines/ownership-map.js';

function fakeReader(files: Record<string, string>) {
  return async (p: string): Promise<string> => {
    if (files[p] === undefined) throw new Error(`not found: ${p}`);
    return files[p]!;
  };
}

describe('loadOwnershipMap', () => {
  it('returns empty map when files missing', async () => {
    const map = await loadOwnershipMap({
      _readFile: async () => { throw new Error('not found'); },
    });
    assert.equal(Object.keys(map.workstreams).length, 0);
    assert.deepEqual(map.frozenFiles, []);
    assert.deepEqual(map.globalAllowed, []);
  });

  it('reads workstreams from agent-ownership.json', async () => {
    const map = await loadOwnershipMap({
      ownershipPath: '/o.json',
      guardPath: '/g.json',
      _readFile: fakeReader({
        '/o.json': JSON.stringify({
          globalAllowed: ['docs/**'],
          workstreams: {
            'matrix-kernel': { owned: ['src/matrix/**'], shared: ['src/cli/index.ts'] },
            'scoring': { owned: ['src/scoring/**'] },
          },
        }),
        '/g.json': JSON.stringify({ frozenFiles: ['src/cli/index.ts'] }),
      }),
    });
    assert.equal(Object.keys(map.workstreams).length, 2);
    assert.deepEqual(map.workstreams['matrix-kernel']!.ownedPaths, ['src/matrix/**']);
    assert.deepEqual(map.frozenFiles, ['src/cli/index.ts']);
    assert.deepEqual(map.globalAllowed, ['docs/**']);
  });
});

describe('query helpers', () => {
  const map = {
    version: 1, generatedAt: '',
    globalAllowed: ['docs/**'],
    workstreams: {
      'matrix-kernel': {
        workstream: 'matrix-kernel',
        ownedPaths: ['src/matrix/**'],
      },
      'scoring': {
        workstream: 'scoring',
        ownedPaths: ['src/scoring/**'],
      },
    },
    frozenFiles: ['src/cli/index.ts'],
  };

  it('pathOwner returns workstream for owned path', () => {
    assert.equal(pathOwner(map, 'src/matrix/foo.ts'), 'matrix-kernel');
    assert.equal(pathOwner(map, 'src/scoring/bar.ts'), 'scoring');
  });

  it('pathOwner returns undefined for unowned path', () => {
    assert.equal(pathOwner(map, 'src/random.ts'), undefined);
  });

  it('isPathFrozen detects frozen files', () => {
    assert.equal(isPathFrozen(map, 'src/cli/index.ts'), true);
    assert.equal(isPathFrozen(map, 'src/cli/other.ts'), false);
  });

  it('pathsForWorkstream returns the workstream paths', () => {
    assert.deepEqual(pathsForWorkstream(map, 'matrix-kernel'), ['src/matrix/**']);
  });

  it('isPathGloballyAllowed checks the globalAllowed list', () => {
    assert.equal(isPathGloballyAllowed(map, 'docs/readme.md'), true);
    assert.equal(isPathGloballyAllowed(map, 'src/foo.ts'), false);
  });
});
