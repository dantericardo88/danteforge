import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkToolCompatibility, type CompatibilityCheck } from '../src/core/compatibility-engine.js';

describe('checkToolCompatibility', () => {
  it('returns an array of CompatibilityCheck objects', async () => {
    const results = await checkToolCompatibility();
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it('every result has tool, version, compatible, issues, recommendations', async () => {
    const results = await checkToolCompatibility();
    for (const r of results) {
      assert.ok(typeof r.tool === 'string', 'tool should be string');
      assert.ok(typeof r.version === 'string', 'version should be string');
      assert.ok(typeof r.compatible === 'boolean', 'compatible should be boolean');
      assert.ok(Array.isArray(r.issues), 'issues should be array');
      assert.ok(Array.isArray(r.recommendations), 'recommendations should be array');
    }
  });

  it('includes Claude Code in results', async () => {
    const results = await checkToolCompatibility();
    const claudeCheck = results.find(r => r.tool === 'Claude Code');
    assert.ok(claudeCheck, 'should include Claude Code check');
  });

  it('includes Cursor in results', async () => {
    const results = await checkToolCompatibility();
    assert.ok(results.some(r => r.tool === 'Cursor'));
  });

  it('Windsurf check is always compatible (assumed compatible)', async () => {
    const results = await checkToolCompatibility();
    const ws = results.find(r => r.tool === 'Windsurf');
    assert.ok(ws, 'Windsurf should be in results');
    assert.equal(ws!.compatible, true);
  });

  it('Codex check is always compatible (assumed compatible)', async () => {
    const results = await checkToolCompatibility();
    const codex = results.find(r => r.tool === 'Codex');
    assert.ok(codex, 'Codex should be in results');
    assert.equal(codex!.compatible, true);
  });
});
