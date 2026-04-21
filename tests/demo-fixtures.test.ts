import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_FIXTURES,
  getDemoFixture,
  listDemoFixtures,
} from '../src/core/demo-fixtures.js';

describe('DEMO_FIXTURES', () => {
  it('is a non-empty array', () => {
    assert.ok(DEMO_FIXTURES.length > 0);
  });

  it('every fixture has name, description, rawPrompt', () => {
    for (const f of DEMO_FIXTURES) {
      assert.ok(typeof f.name === 'string' && f.name.length > 0, `missing name`);
      assert.ok(typeof f.description === 'string', `${f.name} missing description`);
      assert.ok(typeof f.rawPrompt === 'string', `${f.name} missing rawPrompt`);
    }
  });

  it('every fixture has artifactSet with constitution, spec, plan', () => {
    for (const f of DEMO_FIXTURES) {
      assert.ok(typeof f.artifactSet.constitution === 'string', `${f.name} missing constitution`);
      assert.ok(typeof f.artifactSet.spec === 'string', `${f.name} missing spec`);
      assert.ok(typeof f.artifactSet.plan === 'string', `${f.name} missing plan`);
    }
  });

  it('every fixture has numeric pdseScore and rawScore', () => {
    for (const f of DEMO_FIXTURES) {
      assert.ok(typeof f.expectedPdseScore === 'number', `${f.name} missing expectedPdseScore`);
      assert.ok(typeof f.expectedRawScore === 'number', `${f.name} missing expectedRawScore`);
    }
  });

  it('names are unique', () => {
    const names = DEMO_FIXTURES.map(f => f.name);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('getDemoFixture', () => {
  it('returns undefined for unknown name', () => {
    const result = getDemoFixture('does-not-exist-xyz');
    assert.equal(result, undefined);
  });

  it('returns fixture for known name', () => {
    const first = DEMO_FIXTURES[0];
    if (!first) return;
    const result = getDemoFixture(first.name);
    assert.ok(result !== undefined);
    assert.equal(result!.name, first.name);
  });

  it('finds all registered fixtures by name', () => {
    for (const fixture of DEMO_FIXTURES) {
      const found = getDemoFixture(fixture.name);
      assert.ok(found !== undefined, `getDemoFixture should find: ${fixture.name}`);
    }
  });
});

describe('listDemoFixtures', () => {
  it('returns array of strings', () => {
    const list = listDemoFixtures();
    assert.ok(Array.isArray(list));
    for (const name of list) {
      assert.ok(typeof name === 'string');
    }
  });

  it('has same length as DEMO_FIXTURES', () => {
    assert.equal(listDemoFixtures().length, DEMO_FIXTURES.length);
  });

  it('all names match DEMO_FIXTURES fixture names', () => {
    const list = listDemoFixtures();
    for (const name of list) {
      assert.ok(DEMO_FIXTURES.some(f => f.name === name));
    }
  });
});
