import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { evaluatePolicy, loadPolicyConfig, runPolicyGate, writePolicyReceipt } from '../src/core/policy-gate.js';
import type { PolicyConfig } from '../src/core/policy-gate.js';

describe('evaluatePolicy', () => {
  it('allows a command in allowedCommands', () => {
    const policy: PolicyConfig = { allowedCommands: ['assess', 'measure'] };
    const d = evaluatePolicy('assess', policy);
    assert.equal(d.allowed, true);
    assert.equal(d.requiresApproval, false);
    assert.equal(d.bypassActive, false);
  });

  it('blocks a command not in allowedCommands', () => {
    const policy: PolicyConfig = { allowedCommands: ['assess', 'measure'] };
    const d = evaluatePolicy('forge', policy);
    assert.equal(d.allowed, false);
    assert.equal(d.requiresApproval, false);
    assert.match(d.reason, /not in allowedCommands/);
  });

  it('blocks a command in blockedCommands', () => {
    const policy: PolicyConfig = { blockedCommands: ['nuke'] };
    const d = evaluatePolicy('nuke', policy);
    assert.equal(d.allowed, false);
    assert.match(d.reason, /blockedCommands/);
  });

  it('blocked takes priority over allowed', () => {
    const policy: PolicyConfig = { allowedCommands: ['forge'], blockedCommands: ['forge'] };
    const d = evaluatePolicy('forge', policy);
    assert.equal(d.allowed, false);
    assert.match(d.reason, /blockedCommands/);
  });

  it('flags requiresApproval for commands in requireApproval list', () => {
    const policy: PolicyConfig = { requireApproval: ['forge', 'autoforge'] };
    const d = evaluatePolicy('forge', policy);
    assert.equal(d.allowed, true);
    assert.equal(d.requiresApproval, true);
    assert.match(d.reason, /requires human approval/);
  });

  it('allows non-approval command when only requireApproval set', () => {
    const policy: PolicyConfig = { requireApproval: ['forge'] };
    const d = evaluatePolicy('assess', policy);
    assert.equal(d.allowed, true);
    assert.equal(d.requiresApproval, false);
  });

  it('bypass window allows blocked command', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const policy: PolicyConfig = { blockedCommands: ['forge'], bypassUntil: future };
    const d = evaluatePolicy('forge', policy);
    assert.equal(d.allowed, true);
    assert.equal(d.bypassActive, true);
    assert.match(d.reason, /bypass window/);
  });

  it('expired bypass does not grant access', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const policy: PolicyConfig = { blockedCommands: ['forge'], bypassUntil: past };
    const d = evaluatePolicy('forge', policy);
    assert.equal(d.allowed, false);
    assert.equal(d.bypassActive, false);
  });

  it('includes teamId in decision when set', () => {
    const policy: PolicyConfig = { teamId: 'team-alpha' };
    const d = evaluatePolicy('assess', policy);
    assert.equal(d.teamId, 'team-alpha');
  });

  it('returns command in decision', () => {
    const d = evaluatePolicy('measure', {});
    assert.equal(d.command, 'measure');
    assert.equal(d.allowed, true);
  });

  it('empty policy allows everything', () => {
    const d = evaluatePolicy('forge', {});
    assert.equal(d.allowed, true);
    assert.equal(d.requiresApproval, false);
  });
});

describe('loadPolicyConfig', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-gate-test-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no policy.yaml exists', async () => {
    const result = await loadPolicyConfig(tmpDir);
    assert.equal(result, null);
  });

  it('parses inline list syntax for allowedCommands', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.danteforge', 'policy.yaml'),
      'allowedCommands: [assess, measure, verify]\nrequireApproval: [forge]\n',
    );
    const config = await loadPolicyConfig(tmpDir);
    assert.ok(config);
    assert.deepEqual(config.allowedCommands, ['assess', 'measure', 'verify']);
    assert.deepEqual(config.requireApproval, ['forge']);
  });

  it('parses selfEditPolicy field', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.danteforge', 'policy.yaml'),
      'selfEditPolicy: deny\n',
    );
    const config = await loadPolicyConfig(tmpDir);
    assert.ok(config);
    assert.equal(config.selfEditPolicy, 'deny');
  });

  it('parses null teamId and bypassUntil', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.danteforge', 'policy.yaml'),
      'teamId: null\nbypassUntil: null\n',
    );
    const config = await loadPolicyConfig(tmpDir);
    assert.ok(config);
    assert.equal(config.teamId, null);
    assert.equal(config.bypassUntil, null);
  });

  it('ignores comment lines', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.danteforge', 'policy.yaml'),
      '# this is a comment\nallowedCommands: [assess]\n',
    );
    const config = await loadPolicyConfig(tmpDir);
    assert.ok(config);
    assert.deepEqual(config.allowedCommands, ['assess']);
  });
});

describe('writePolicyReceipt', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-receipt-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a JSON receipt file and returns the path', async () => {
    const decision = {
      command: 'forge',
      allowed: false,
      requiresApproval: false,
      reason: 'blocked',
      bypassActive: false,
      timestamp: new Date().toISOString(),
    };
    const receiptPath = await writePolicyReceipt(decision, tmpDir);
    const raw = await fs.readFile(receiptPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.command, 'forge');
    assert.equal(parsed.allowed, false);
  });

  it('creates the policy subdirectory', async () => {
    const decision = {
      command: 'assess',
      allowed: true,
      requiresApproval: false,
      reason: 'allowed',
      bypassActive: false,
      timestamp: new Date().toISOString(),
    };
    const receiptPath = await writePolicyReceipt(decision, tmpDir);
    assert.ok(receiptPath.includes('policy'));
    assert.ok(receiptPath.endsWith('.json'));
  });
});

describe('runPolicyGate', () => {
  it('returns allowed when no policy configured', async () => {
    const decision = await runPolicyGate('forge', '/nonexistent-dir-xyz');
    assert.equal(decision.allowed, true);
    assert.match(decision.reason, /no policy configured/);
  });

  it('uses injected _loadPolicy', async () => {
    const mockPolicy: PolicyConfig = { blockedCommands: ['forge'] };
    const decision = await runPolicyGate('forge', '/irrelevant', async () => mockPolicy);
    assert.equal(decision.allowed, false);
  });

  it('allows assess through default policy with allowedCommands', async () => {
    const mockPolicy: PolicyConfig = { allowedCommands: ['assess'], requireApproval: ['forge'] };
    const decision = await runPolicyGate('assess', '/irrelevant', async () => mockPolicy);
    assert.equal(decision.allowed, true);
    assert.equal(decision.requiresApproval, false);
  });

  it('flags forge as requiresApproval via injected policy', async () => {
    const mockPolicy: PolicyConfig = { requireApproval: ['forge', 'autoforge'] };
    const decision = await runPolicyGate('forge', '/irrelevant', async () => mockPolicy);
    assert.equal(decision.allowed, true);
    assert.equal(decision.requiresApproval, true);
  });
});
