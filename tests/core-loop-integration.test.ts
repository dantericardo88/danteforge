// Core Loop Integration Test
// Proves the pipeline is wired end-to-end by testing artifact creation,
// gate enforcement, and state progression in an isolated tmpdir.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireSpec, requireClarify, requirePlan, GateError } from '../src/core/gates.js';
import { runRespec } from '../src/cli/commands/respec.js';
import { runRefusedPatterns } from '../src/cli/commands/refused-patterns.js';
import { runCrossSynthesize } from '../src/cli/commands/cross-synthesize.js';
import type { AttributionRecord } from '../src/core/causal-attribution.js';

const MOCK_SPEC = '# Test App Spec\n\n## Feature\nBuild a test application.\n\n## Tasks\n1. Create entry point\n2. Add tests';
const MOCK_CLARIFY = '# Clarification\n\nQ: What language?\nA: TypeScript';
const MOCK_PLAN = '# Implementation Plan\n\n## Phase 1\n- Set up project structure';

let tmpdir: string;

before(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-core-loop-'));
  await fs.mkdir(path.join(tmpdir, '.danteforge'), { recursive: true });
});

after(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true });
});

describe('Core Loop Integration', () => {

  it('T1: requireSpec throws GateError when SPEC.md is absent', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gate-'));
    await fs.mkdir(path.join(emptyDir, '.danteforge'), { recursive: true });
    try {
      await assert.rejects(
        () => requireSpec(false, emptyDir),
        (err: Error) => err instanceof GateError && err.gate === 'requireSpec',
      );
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('T2: requireSpec passes once SPEC.md exists in .danteforge/', async () => {
    await fs.writeFile(path.join(tmpdir, '.danteforge', 'SPEC.md'), MOCK_SPEC, 'utf8');
    await assert.doesNotReject(() => requireSpec(false, tmpdir));
  });

  it('T3: requireClarify throws GateError when CLARIFY.md is absent', async () => {
    await assert.rejects(
      () => requireClarify(false, tmpdir),
      (err: Error) => err instanceof GateError && err.gate === 'requireClarify',
    );
  });

  it('T4: requireClarify passes once CLARIFY.md exists', async () => {
    await fs.writeFile(path.join(tmpdir, '.danteforge', 'CLARIFY.md'), MOCK_CLARIFY, 'utf8');
    await assert.doesNotReject(() => requireClarify(false, tmpdir));
  });

  it('T5: requirePlan throws GateError when PLAN.md is absent', async () => {
    await assert.rejects(
      () => requirePlan(false, tmpdir),
      (err: Error) => err instanceof GateError && err.gate === 'requirePlan',
    );
  });

  it('T6: requirePlan passes once PLAN.md exists', async () => {
    await fs.writeFile(path.join(tmpdir, '.danteforge', 'PLAN.md'), MOCK_PLAN, 'utf8');
    await assert.doesNotReject(() => requirePlan(false, tmpdir));
  });

  it('T7: respec reads SPEC.md + lessons, calls LLM, writes revised SPEC.md in tmpdir', async () => {
    let written = '';
    const result = await runRespec({
      cwd: tmpdir,
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => '- Use dependency injection for all I/O',
      _loadRefused: async () => ({ version: '1.0.0', patterns: [], updatedAt: '' }),
      _callLLM: async () => '# Revised Spec\n\nImproved content.',
      _writeSpec: async (content) => { written = content; },
    });
    assert.strictEqual(result.revised, true);
    assert.ok(written.includes('Revised Spec'), 'revised spec must be written');
    assert.ok(result.lessonsInjected > 0, 'lessons must be counted');
  });

  it('T8: full recovery pipeline — refused-patterns + respec + cross-synthesize in sequence', async () => {
    // Step 1: Add a refused pattern
    const refusedStore = { version: '1.0.0' as const, patterns: [] as ReturnType<typeof Array>, updatedAt: '' };
    await runRefusedPatterns({
      add: 'lazy-polling',
      _load: async () => refusedStore,
      _save: async (s) => { Object.assign(refusedStore, s); },
    });
    assert.strictEqual(refusedStore.patterns.length, 1);

    // Step 2: Respec with the refused pattern injected
    let respecPrompt = '';
    await runRespec({
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => null,
      _loadRefused: async () => refusedStore,
      _callLLM: async (p) => { respecPrompt = p; return '# Revised'; },
      _writeSpec: async () => {},
    });
    assert.ok(respecPrompt.includes('lazy-polling'), 'refused pattern must appear in respec prompt');

    // Step 3: Cross-synthesize from attribution history
    const records: AttributionRecord[] = [
      {
        patternName: 'event-driven', sourceRepo: 'acme/repo',
        adoptedAt: new Date().toISOString(),
        preAdoptionScore: 5.0, postAdoptionScore: 7.0, scoreDelta: 2.0,
        verifyStatus: 'pass', filesModified: [],
      },
    ];
    const result = await runCrossSynthesize({
      _loadAttribution: async () => records,
      _loadUPR: async () => null,
      _callLLM: async () => '# Cross Synthesis\n\nEvent-driven architecture is the winner.',
      _writeReport: async () => {},
    });
    assert.strictEqual(result.written, true);
    assert.strictEqual(result.winnersFound, 1);
  });
});
