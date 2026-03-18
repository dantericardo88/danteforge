import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createSkeletonOP,
  stringifyOP,
  parseOP,
  validateOP,
} from '../src/harvested/openpencil/op-codec.js';

describe('design command', () => {
  it('exports design function', async () => {
    const mod = await import('../src/cli/commands/design.js');
    assert.strictEqual(typeof mod.design, 'function');
  });

  it('design module resolves all dependencies', async () => {
    // Importing the module verifies that all internal imports resolve
    const mod = await import('../src/cli/commands/design.js');
    assert.ok(mod);
    assert.ok(Object.keys(mod).length > 0);
  });
});

describe('design command - createSkeletonOP roundtrip', () => {
  it('creates a skeleton that can be stringified', () => {
    const doc = createSkeletonOP('Test Project');
    const json = stringifyOP(doc);
    assert.ok(json.length > 0);
    assert.ok(json.startsWith('{'));
  });

  it('stringified skeleton can be re-parsed', () => {
    const doc = createSkeletonOP('Test Project');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.document.name, 'Test Project');
    assert.ok(Array.isArray(reparsed.nodes));
    assert.ok(reparsed.nodes.length >= 1);
  });

  it('re-parsed skeleton validates successfully', () => {
    const doc = createSkeletonOP('Test Project');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    const result = validateOP(reparsed);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('skeleton preserves project name through roundtrip', () => {
    const doc = createSkeletonOP('My App');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.document.name, 'My App');
  });

  it('skeleton preserves page configuration through roundtrip', () => {
    const doc = createSkeletonOP('Dashboard', 'Overview');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.document.pages[0].name, 'Overview');
  });

  it('skeleton preserves root frame dimensions through roundtrip', () => {
    const doc = createSkeletonOP('Layout Test');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.nodes[0].width, 1440);
    assert.strictEqual(reparsed.nodes[0].height, 900);
    assert.strictEqual(reparsed.nodes[0].type, 'frame');
  });
});
