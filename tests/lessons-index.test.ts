import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  indexLessons,
  queryLessons,
  injectRelevantLessons,
} from '../src/core/lessons-index.js';

describe('lessons-index', () => {
  let originalCwd: string;
  let tmpDir: string;

  before(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-lessons-test-'));
    process.chdir(tmpDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('indexLessons returns empty array when no file exists', async () => {
    const lessons = await indexLessons();
    assert.ok(Array.isArray(lessons));
    assert.strictEqual(lessons.length, 0);
  });

  it('queryLessons returns empty for no matches', async () => {
    const results = await queryLessons(['nonexistent-keyword-xyz']);
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it('injectRelevantLessons returns original prompt when no lessons', async () => {
    const prompt = 'Build a login form with authentication';
    const result = await injectRelevantLessons(prompt);
    assert.strictEqual(result, prompt);
  });

  it('module exports expected functions', () => {
    assert.strictEqual(typeof indexLessons, 'function');
    assert.strictEqual(typeof queryLessons, 'function');
    assert.strictEqual(typeof injectRelevantLessons, 'function');
  });
});
