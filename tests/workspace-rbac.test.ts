import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRbacAllowed,
  assertRbacAllowed,
  getRoleForUser,
  RBAC_POLICIES,
  listRestrictedCommands,
  type WorkspaceRole,
} from '../src/core/workspace-rbac.js';

// ── checkRbacAllowed ──────────────────────────────────────────────────────────

describe('checkRbacAllowed', () => {
  it('allows owner to run forge', () => {
    assert.equal(checkRbacAllowed('forge', 'owner'), true);
  });

  it('allows editor to run forge', () => {
    assert.equal(checkRbacAllowed('forge', 'editor'), true);
  });

  it('denies reviewer from running forge', () => {
    assert.equal(checkRbacAllowed('forge', 'reviewer'), false);
  });

  it('allows owner to run ship (owner-only command)', () => {
    assert.equal(checkRbacAllowed('ship', 'owner'), true);
  });

  it('denies editor from running ship (owner-only)', () => {
    assert.equal(checkRbacAllowed('ship', 'editor'), false);
  });

  it('denies reviewer from running ship (owner-only)', () => {
    assert.equal(checkRbacAllowed('ship', 'reviewer'), false);
  });

  it('allows reviewer to run verify', () => {
    assert.equal(checkRbacAllowed('verify', 'reviewer'), true);
  });

  it('allows reviewer to run assess', () => {
    assert.equal(checkRbacAllowed('assess', 'reviewer'), true);
  });

  it('allows reviewer to run score', () => {
    assert.equal(checkRbacAllowed('score', 'reviewer'), true);
  });

  it('allows any role to run an unlisted command (no policy = open)', () => {
    assert.equal(checkRbacAllowed('wiki-ingest', 'reviewer'), true);
    assert.equal(checkRbacAllowed('prime', 'reviewer'), true);
  });

  it('denies editor from config (owner-only)', () => {
    assert.equal(checkRbacAllowed('config', 'editor'), false);
  });

  it('denies reviewer from compete', () => {
    assert.equal(checkRbacAllowed('compete', 'reviewer'), false);
  });
});

// ── assertRbacAllowed ─────────────────────────────────────────────────────────

describe('assertRbacAllowed', () => {
  it('does not throw when role is allowed', () => {
    assert.doesNotThrow(() => assertRbacAllowed('forge', 'owner'));
    assert.doesNotThrow(() => assertRbacAllowed('forge', 'editor'));
    assert.doesNotThrow(() => assertRbacAllowed('verify', 'reviewer'));
  });

  it('throws when role is not allowed', () => {
    assert.throws(
      () => assertRbacAllowed('ship', 'editor'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('RBAC denied'));
        assert.ok(err.message.includes('ship'));
        assert.ok(err.message.includes('editor'));
        return true;
      },
    );
  });

  it('throws with descriptive message listing allowed roles', () => {
    assert.throws(
      () => assertRbacAllowed('forge', 'reviewer'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('owner'));
        assert.ok(err.message.includes('editor'));
        return true;
      },
    );
  });

  it('does not throw for unlisted command regardless of role', () => {
    const roles: WorkspaceRole[] = ['owner', 'editor', 'reviewer'];
    for (const role of roles) {
      assert.doesNotThrow(() => assertRbacAllowed('unknown-command', role));
    }
  });
});

// ── getRoleForUser ────────────────────────────────────────────────────────────

describe('getRoleForUser', () => {
  it('returns null when the workspace.yaml does not exist', async () => {
    const role = await getRoleForUser('/nonexistent/path', async () => null);
    assert.equal(role, null);
  });

  it('returns the role read from workspace.yaml', async () => {
    const yaml = 'role: editor\n';
    const role = await getRoleForUser('/any/cwd', async () => yaml);
    assert.equal(role, 'editor');
  });

  it('returns owner when workspace.yaml has role: owner', async () => {
    const role = await getRoleForUser('/any/cwd', async () => 'role: owner\n');
    assert.equal(role, 'owner');
  });

  it('returns reviewer when workspace.yaml has role: reviewer', async () => {
    const role = await getRoleForUser('/any/cwd', async () => 'role: reviewer\n');
    assert.equal(role, 'reviewer');
  });

  it('returns null when workspace.yaml has an unrecognised role value', async () => {
    const role = await getRoleForUser('/any/cwd', async () => 'role: superadmin\n');
    assert.equal(role, null);
  });

  it('returns null when workspace.yaml is empty', async () => {
    const role = await getRoleForUser('/any/cwd', async () => '');
    assert.equal(role, null);
  });

  it('returns null when workspace.yaml YAML is malformed', async () => {
    const role = await getRoleForUser('/any/cwd', async () => ': bad : yaml : [');
    assert.equal(role, null);
  });
});

// ── RBAC_POLICIES table integrity ─────────────────────────────────────────────

describe('RBAC_POLICIES', () => {
  it('every policy has at least one allowed role', () => {
    for (const p of RBAC_POLICIES) {
      assert.ok(p.allowedRoles.length > 0, `${p.command} has no allowed roles`);
    }
  });

  it('every allowed role is one of: owner | editor | reviewer', () => {
    const valid: WorkspaceRole[] = ['owner', 'editor', 'reviewer'];
    for (const p of RBAC_POLICIES) {
      for (const r of p.allowedRoles) {
        assert.ok(valid.includes(r), `${p.command} has invalid role: ${r}`);
      }
    }
  });

  it('owner-only commands do not include editor or reviewer', () => {
    const ownerOnly = RBAC_POLICIES.filter(
      p => p.allowedRoles.length === 1 && p.allowedRoles[0] === 'owner',
    );
    assert.ok(ownerOnly.length > 0, 'Expected at least one owner-only command');
    for (const p of ownerOnly) {
      assert.ok(!p.allowedRoles.includes('editor'));
      assert.ok(!p.allowedRoles.includes('reviewer'));
    }
  });
});

// ── listRestrictedCommands ────────────────────────────────────────────────────

describe('listRestrictedCommands', () => {
  it('returns commands restricted to owner-tier', () => {
    const cmds = listRestrictedCommands('owner');
    assert.ok(cmds.includes('ship'));
    assert.ok(cmds.includes('config'));
    assert.ok(cmds.includes('reset'));
  });
});
