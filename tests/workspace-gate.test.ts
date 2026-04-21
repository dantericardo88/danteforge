import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  requireWorkspaceRole,
  WorkspacePermissionError,
} from '../src/core/workspace-gate.js';

const TEST_USER = process.env['DANTEFORGE_USER'] ?? process.env['USERNAME'] ?? process.env['USER'] ?? 'test-user';

function makeWorkspace(role: string, userId = TEST_USER) {
  return {
    id: 'ws-1',
    name: 'test-workspace',
    members: [{ id: userId, role, addedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    signingKeySalt: 'abc',
  };
}

describe('WorkspacePermissionError', () => {
  it('has correct name', () => {
    const err = new WorkspacePermissionError('no access', 'fix it');
    assert.equal(err.name, 'WorkspacePermissionError');
  });

  it('includes message', () => {
    const err = new WorkspacePermissionError('no access', 'fix it');
    assert.ok(err.message.includes('no access'));
  });
});

describe('requireWorkspaceRole', () => {
  it('passes silently when no workspace is active', async () => {
    await assert.doesNotReject(() =>
      requireWorkspaceRole('admin', {
        _getWorkspaceId: async () => null,
      })
    );
  });

  it('passes silently when workspace config is missing', async () => {
    await assert.doesNotReject(() =>
      requireWorkspaceRole('admin', {
        _getWorkspaceId: async () => 'ws-1',
        _loadWorkspace: async () => null,
      })
    );
  });

  it('throws WorkspacePermissionError when user lacks required role', async () => {
    const ws = makeWorkspace('reviewer');
    await assert.rejects(
      () => requireWorkspaceRole('owner', {
        _getWorkspaceId: async () => 'ws-1',
        _loadWorkspace: async () => ws as any,
      }),
      WorkspacePermissionError,
    );
  });

  it('passes when user has sufficient role (owner)', async () => {
    const ws = makeWorkspace('owner');
    await assert.doesNotReject(() =>
      requireWorkspaceRole('owner', {
        _getWorkspaceId: async () => 'ws-1',
        _loadWorkspace: async () => ws as any,
      })
    );
  });
});
