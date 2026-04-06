import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  issueWorkspaceToken,
  verifyWorkspaceToken,
  saveWorkspaceToken,
  loadWorkspaceToken,
} from '../src/core/workspace.js';

describe('workspace tokens', () => {
  const makeMockOps = () => {
    const files = new Map<string, string>();
    return {
      _readFile: async (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`File not found: ${p}`);
        return v;
      },
      _writeFile: async (p: string, content: string) => { files.set(p, content); },
      _mkdir: async () => {},
      _homedir: () => '/tmp/test-home',
      files,
    };
  };

  it('createWorkspace generates a signingKeySalt (32 hex chars)', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    assert.ok(ws.signingKeySalt, 'Expected signingKeySalt to be set');
    assert.match(ws.signingKeySalt!, /^[0-9a-f]{32}$/);
  });

  it('issueWorkspaceToken returns a two-segment dot-delimited string', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const parts = token.split('.');
    assert.equal(parts.length, 2);
  });

  it('verifyWorkspaceToken returns payload for valid token', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const payload = verifyWorkspaceToken(token, ws, 'alice', ops);
    assert.ok(payload !== null);
    assert.equal(payload!.userId, 'alice');
    assert.equal(payload!.role, 'editor');
  });

  it('returns null for tampered payload', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 'bob', role: 'owner' })).toString('base64url');
    const tampered = `${tamperedPayload}.${parts[1]}`;
    const result = verifyWorkspaceToken(tampered, ws, 'bob', ops);
    assert.equal(result, null);
  });

  it('returns null for tampered HMAC', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const parts = token.split('.');
    const tampered = `${parts[0]}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const result = verifyWorkspaceToken(tampered, ws, 'alice', ops);
    assert.equal(result, null);
  });

  it('returns null for expired token', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    // Issue with _now returning past time
    const pastOps = { ...ops, _now: () => Date.now() - 8 * 24 * 60 * 60 * 1000 };
    const token = issueWorkspaceToken(ws, 'alice', 'editor', pastOps);
    // Verify with current time (future relative to issuance)
    const result = verifyWorkspaceToken(token, ws, 'alice', ops);
    assert.equal(result, null, 'Expired token should return null');
  });

  it('returns null for wrong userId', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const result = verifyWorkspaceToken(token, ws, 'bob', ops);
    assert.equal(result, null);
  });

  it('saveWorkspaceToken / loadWorkspaceToken round-trip via memory ops', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('testws', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    await saveWorkspaceToken(ws.id, 'alice', token, ops);
    const loaded = await loadWorkspaceToken(ws.id, 'alice', ops);
    assert.equal(loaded, token);
  });
});
