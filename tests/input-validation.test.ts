import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { sanitizePath, validateProviderName, validateSubcommand } from '../src/core/input-validation.js';

describe('input-validation', () => {
  const baseDir = path.join(os.tmpdir(), 'test-project');

  describe('sanitizePath', () => {
    it('resolves a relative path within base', () => {
      const result = sanitizePath('src/core/foo.ts', baseDir);
      assert.ok(result.includes('src'));
      assert.ok(result.startsWith(baseDir));
    });

    it('rejects directory traversal', () => {
      assert.throws(
        () => sanitizePath('../../etc/passwd', baseDir),
        /traversal rejected/,
      );
    });

    it('accepts absolute paths within base', () => {
      const absPath = path.join(baseDir, 'src', 'foo.ts');
      const result = sanitizePath(absPath, baseDir);
      assert.ok(result.startsWith(baseDir));
    });
  });

  describe('validateProviderName', () => {
    it('accepts known providers', () => {
      assert.equal(validateProviderName('ollama'), 'ollama');
      assert.equal(validateProviderName('Claude'), 'claude');
      assert.equal(validateProviderName('OPENAI'), 'openai');
    });

    it('rejects unknown providers', () => {
      assert.throws(() => validateProviderName('foobar'), /Unknown provider/);
    });
  });

  describe('validateSubcommand', () => {
    it('accepts valid subcommands', () => {
      assert.equal(validateSubcommand('compare', ['compare', 'report']), 'compare');
    });

    it('rejects invalid subcommands', () => {
      assert.throws(
        () => validateSubcommand('hack', ['compare', 'report']),
        /Unknown subcommand/,
      );
    });
  });
});
