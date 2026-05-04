// canonical-compete.test.ts — Blade Group 5: compete enhancements
// Tests: --raise-ready dispatches to frontierGap, deep runs frontierGap after CHL,
//        add/dossier sub-actions dispatch correctly

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCompete } from '../src/cli/commands/canonical.js';

function makeCompeteFns(called: string[]) {
  return {
    assess: async () => { called.push('assess'); },
    universe: async () => { called.push('universe'); },
    compete: async () => { called.push('compete'); },
    frontierGap: async () => { called.push('frontierGap'); },
    addCompetitor: async (n: string) => { called.push('add:' + n); },
    dossier: async (n: string) => { called.push('dossier:' + n); },
  };
}

describe('canonicalCompete — --raise-ready', () => {
  it('calls frontierGap only', async () => {
    const called: string[] = [];
    await canonicalCompete({ raiseReady: true, _fns: makeCompeteFns(called) });
    assert.deepEqual(called, ['frontierGap']);
  });
});

describe('canonicalCompete — deep includes frontierGap', () => {
  it('runs compete then frontierGap', async () => {
    const called: string[] = [];
    await canonicalCompete({ level: 'deep', _fns: makeCompeteFns(called) });
    assert.ok(called.includes('compete'), 'compete CHL loop should run');
    assert.ok(called.includes('frontierGap'), 'frontierGap should run after CHL');
    assert.ok(called.indexOf('compete') < called.indexOf('frontierGap'), 'compete before frontierGap');
  });
});

describe('canonicalCompete — action: add', () => {
  it('calls addCompetitor with name and returns', async () => {
    const called: string[] = [];
    await canonicalCompete({ action: 'add', name: 'NewCo', _fns: makeCompeteFns(called) });
    assert.deepEqual(called, ['add:NewCo']);
  });
});

describe('canonicalCompete — action: dossier', () => {
  it('calls dossier with name and returns', async () => {
    const called: string[] = [];
    await canonicalCompete({ action: 'dossier', name: 'RivalCo', _fns: makeCompeteFns(called) });
    assert.deepEqual(called, ['dossier:RivalCo']);
  });
});
