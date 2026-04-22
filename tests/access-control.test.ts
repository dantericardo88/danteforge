import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccessControlManager } from '../src/core/access-control.js';

describe('AccessControlManager', () => {
  it('constructs with default options', () => {
    const mgr = new AccessControlManager();
    assert.ok(mgr);
  });

  it('constructs with custom options', () => {
    const mgr = new AccessControlManager({ enableRbac: false, auditAccess: false });
    assert.ok(mgr);
  });

  it('returns false for unknown user', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    const result = await mgr.checkAccess('unknown-user', 'read');
    assert.equal(result, false);
  });

  it('grants access when permission matches action', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    await mgr.addPolicy('alice', ['admin'], ['read', 'write']);
    const result = await mgr.checkAccess('alice', 'read');
    assert.equal(result, true);
  });

  it('grants access with wildcard permission', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    await mgr.addPolicy('superuser', ['admin'], ['*']);
    const result = await mgr.checkAccess('superuser', 'any-action');
    assert.equal(result, true);
  });

  it('denies access when permission missing', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    await mgr.addPolicy('bob', ['viewer'], ['read']);
    const result = await mgr.checkAccess('bob', 'delete');
    assert.equal(result, false);
  });

  it('denies access when resource restriction matched', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    await mgr.addPolicy('carol', ['user'], ['read', 'write']);
    await mgr.addResourceRestriction('carol', 'secret/');
    const result = await mgr.checkAccess('carol', 'read', '/data/secret/file.txt');
    assert.equal(result, false);
  });

  it('allows access when resource does not match restriction', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    await mgr.addPolicy('carol', ['user'], ['read', 'write']);
    await mgr.addResourceRestriction('carol', 'secret/');
    const result = await mgr.checkAccess('carol', 'read', '/data/public/file.txt');
    assert.equal(result, true);
  });

  it('addResourceRestriction is no-op for unknown user', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    // Should not throw
    await mgr.addResourceRestriction('ghost', 'pattern');
    assert.ok(true);
  });

  it('getUserPolicies returns all policies', async () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    await mgr.addPolicy('u1', ['role1'], ['read']);
    await mgr.addPolicy('u2', ['role2'], ['write']);
    const policies = mgr.getUserPolicies();
    assert.equal(policies.length, 2);
    assert.ok(policies.some(p => p.userId === 'u1'));
    assert.ok(policies.some(p => p.userId === 'u2'));
  });

  it('getUserPolicies returns empty array when no policies', () => {
    const mgr = new AccessControlManager({ auditAccess: false });
    assert.deepEqual(mgr.getUserPolicies(), []);
  });

  it('grants access when RBAC disabled (no permission check)', async () => {
    const mgr = new AccessControlManager({ enableRbac: false, auditAccess: false });
    await mgr.addPolicy('dave', [], []); // no permissions
    const result = await mgr.checkAccess('dave', 'anything');
    assert.equal(result, true);
  });
});
