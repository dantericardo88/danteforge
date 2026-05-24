// examples-registry.test.ts — Node built-in test runner
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLES,
  getExamplesForCommand,
  getExamplesForDimension,
  getQuickStartExamples,
} from '../src/core/examples-registry.js';

// ---------------------------------------------------------------------------
// EXAMPLES catalogue shape
// ---------------------------------------------------------------------------

describe('EXAMPLES catalogue', () => {
  it('has at least 30 entries', () => {
    assert.ok(
      EXAMPLES.length >= 30,
      `expected >= 30 examples, got ${EXAMPLES.length}`,
    );
  });

  it('every entry has a non-empty command string', () => {
    for (const ex of EXAMPLES) {
      assert.ok(
        typeof ex.command === 'string' && ex.command.trim().length > 0,
        `example has empty command: ${JSON.stringify(ex)}`,
      );
    }
  });

  it('every entry has a non-empty description', () => {
    for (const ex of EXAMPLES) {
      assert.ok(
        typeof ex.description === 'string' && ex.description.trim().length > 0,
        `example has empty description: ${ex.command}`,
      );
    }
  });

  it('every entry has at least one tag', () => {
    for (const ex of EXAMPLES) {
      assert.ok(
        Array.isArray(ex.tags) && ex.tags.length > 0,
        `example has no tags: ${ex.command}`,
      );
    }
  });

  it('all commands start with "danteforge "', () => {
    for (const ex of EXAMPLES) {
      assert.ok(
        ex.command.startsWith('danteforge '),
        `command should start with "danteforge ": ${ex.command}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// getExamplesForCommand
// ---------------------------------------------------------------------------

describe('getExamplesForCommand', () => {
  it('returns examples matching the given command name', () => {
    const results = getExamplesForCommand('forge');
    assert.ok(results.length > 0, 'should find forge examples');
    for (const ex of results) {
      assert.ok(
        ex.command.toLowerCase().includes('forge'),
        `command should contain "forge": ${ex.command}`,
      );
    }
  });

  it('returns an empty array for an unknown command', () => {
    const results = getExamplesForCommand('xyzzy-nonexistent');
    assert.equal(results.length, 0);
  });

  it('returns a subset of EXAMPLES (not all)', () => {
    const results = getExamplesForCommand('verify');
    assert.ok(results.length < EXAMPLES.length, 'should return fewer than all examples');
  });

  it('is case-insensitive in matching', () => {
    const lower = getExamplesForCommand('score');
    const upper = getExamplesForCommand('SCORE');
    // Both should find the same examples (same commands)
    const lowerCmds = lower.map((e) => e.command).sort();
    const upperCmds = upper.map((e) => e.command).sort();
    assert.deepEqual(lowerCmds, upperCmds);
  });
});

// ---------------------------------------------------------------------------
// getExamplesForDimension
// ---------------------------------------------------------------------------

describe('getExamplesForDimension', () => {
  it('returns only examples tagged with the specified dimension', () => {
    const results = getExamplesForDimension('testing');
    assert.ok(results.length > 0, 'should find testing dimension examples');
    for (const ex of results) {
      assert.equal(ex.dimension?.toLowerCase(), 'testing');
    }
  });

  it('returns empty array for an unknown dimension', () => {
    const results = getExamplesForDimension('nonexistent-dimension');
    assert.equal(results.length, 0);
  });

  it('returns examples for documentation dimension', () => {
    const results = getExamplesForDimension('documentation');
    assert.ok(results.length > 0, 'should find documentation dimension examples');
  });
});

// ---------------------------------------------------------------------------
// getQuickStartExamples
// ---------------------------------------------------------------------------

describe('getQuickStartExamples', () => {
  it('returns only examples tagged "beginner"', () => {
    const results = getQuickStartExamples();
    assert.ok(results.length > 0, 'should return at least one beginner example');
    for (const ex of results) {
      assert.ok(
        ex.tags.includes('beginner'),
        `example should have "beginner" tag: ${ex.command}`,
      );
    }
  });

  it('does not include advanced-only examples', () => {
    const results = getQuickStartExamples();
    for (const ex of results) {
      // If it's in quickstart it must have the beginner tag
      assert.ok(ex.tags.includes('beginner'));
    }
  });

  it('includes the init command as a quick-start example', () => {
    const results = getQuickStartExamples();
    const hasInit = results.some((ex) => ex.command.includes('init'));
    assert.ok(hasInit, 'init should be in quick-start examples');
  });
});
