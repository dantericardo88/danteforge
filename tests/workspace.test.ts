import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  loadWorkspace,
  hasRole,
  addMember,
  type WorkspaceConfig,
} from '../src/core/workspace.js';
import { requireWorkspaceRole } from '../src/core/workspace-gate.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMemoryOps() {
  const store = new Map<string, string>();
  return {
    _readFile: async (p: string) => {
      const v = store.get(p);
      if (!v) throw new Error('not found');
      return v;
    },
    _writeFile: async (p: string, c: string) => { store.set(p, c); },
    _mkdir: async () => {},
    _homedir: () => '/home/testuser',
    store,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createWorkspace', () => {
  it('creates a workspace with owner member', async () => {
    const ops = makeMemoryOps();
    const ws = await createWorkspace('My Team', ops);
    assert.equal(ws.id, 'my-team');
    assert.equal(ws.name, 'My Team');
    assert.equal(ws.members.length, 1);
    assert.equal(ws.members[0]!.role, 'owner');
  });

  it('slugifies the workspace name', async () => {
    const ops = makeMemoryOps();
    const ws = await createWorkspace('Hello World Project!!', ops);
    // Collapses consecutive dashes, lowercases
    assert.match(ws.id, /^hello-world-project/);
  });

  it('persists to store', async () => {
    const ops = makeMemoryOps();
    await createWorkspace('persist-test', ops);
    assert.ok(ops.store.size > 0);
  });
});

describe('loadWorkspace', () => {
  it('returns null when workspace does not exist', async () => {
    const ops = makeMemoryOps();
    const result = await loadWorkspace('nonexistent', ops);
    assert.equal(result, null);
  });

  it('round-trips workspace config', async () => {
    const ops = makeMemoryOps();
    const ws = await createWorkspace('roundtrip', ops);
    const loaded = await loadWorkspace(ws.id, ops);
    assert.ok(loaded !== null);
    assert.equal(loaded!.name, 'roundtrip');
  });
});

describe('hasRole', () => {
  const ws: WorkspaceConfig = {
    id: 'test', name: 'Test',
    members: [
      { id: 'alice', role: 'owner', addedAt: '' },
      { id: 'bob', role: 'editor', addedAt: '' },
      { id: 'carol', role: 'reviewer', addedAt: '' },
    ],
    createdAt: '',
  };

  it('owner has all roles', () => {
    assert.equal(hasRole(ws, 'alice', 'owner'), true);
    assert.equal(hasRole(ws, 'alice', 'editor'), true);
    assert.equal(hasRole(ws, 'alice', 'reviewer'), true);
  });

  it('editor does not have owner role', () => {
    assert.equal(hasRole(ws, 'bob', 'owner'), false);
    assert.equal(hasRole(ws, 'bob', 'editor'), true);
  });

  it('reviewer has only reviewer role', () => {
    assert.equal(hasRole(ws, 'carol', 'reviewer'), true);
    assert.equal(hasRole(ws, 'carol', 'editor'), false);
  });

  it('unknown user has no roles', () => {
    assert.equal(hasRole(ws, 'unknown', 'reviewer'), false);
  });
});

describe('addMember', () => {
  it('adds a new member to workspace', async () => {
    const ops = makeMemoryOps();
    await createWorkspace('addtest', ops);
    const updated = await addMember('addtest', { id: 'dave', role: 'editor', addedAt: new Date().toISOString() }, ops);
    assert.ok(updated.members.some((m) => m.id === 'dave'));
  });

  it('replaces an existing member', async () => {
    const ops = makeMemoryOps();
    const ws = await createWorkspace('replacetest', ops);
    const ownerId = ws.members[0]!.id;
    const updated = await addMember('replacetest', { id: ownerId, role: 'reviewer', addedAt: '' }, ops);
    const member = updated.members.find((m) => m.id === ownerId);
    assert.equal(member?.role, 'reviewer');
  });

  it('throws when workspace not found', async () => {
    const ops = makeMemoryOps();
    await assert.rejects(
      () => addMember('ghost-ws', { id: 'x', role: 'editor', addedAt: '' }, ops),
      /not found/,
    );
  });
});

describe('requireWorkspaceRole', () => {
  it('no-ops when no workspace is active', async () => {
    await assert.doesNotReject(() =>
      requireWorkspaceRole('owner', {
        _getWorkspaceId: async () => null,
      }),
    );
  });

  it('no-ops when workspace config is missing', async () => {
    await assert.doesNotReject(() =>
      requireWorkspaceRole('owner', {
        _getWorkspaceId: async () => 'missing-ws',
        _loadWorkspace: async () => null,
      }),
    );
  });

  it('allows access when user has required role', async () => {
    const ws: WorkspaceConfig = {
      id: 'myws', name: 'My WS',
      members: [{ id: 'alice', role: 'owner', addedAt: '' }],
      createdAt: '',
    };
    const origUser = process.env['DANTEFORGE_USER'];
    process.env['DANTEFORGE_USER'] = 'alice';
    try {
      await assert.doesNotReject(() =>
        requireWorkspaceRole('editor', {
          _getWorkspaceId: async () => 'myws',
          _loadWorkspace: async () => ws,
        }),
      );
    } finally {
      if (origUser !== undefined) process.env['DANTEFORGE_USER'] = origUser;
      else delete process.env['DANTEFORGE_USER'];
    }
  });

  it('throws when user lacks required role', async () => {
    const ws: WorkspaceConfig = {
      id: 'myws', name: 'My WS',
      members: [{ id: 'bob', role: 'reviewer', addedAt: '' }],
      createdAt: '',
    };
    const origUser = process.env['DANTEFORGE_USER'];
    process.env['DANTEFORGE_USER'] = 'bob';
    try {
      await assert.rejects(
        () => requireWorkspaceRole('editor', {
          _getWorkspaceId: async () => 'myws',
          _loadWorkspace: async () => ws,
        }),
        (err: unknown) => (err as { code?: string }).code === 'WORKSPACE_PERMISSION_DENIED',
      );
    } finally {
      if (origUser !== undefined) process.env['DANTEFORGE_USER'] = origUser;
      else delete process.env['DANTEFORGE_USER'];
    }
  });
});
