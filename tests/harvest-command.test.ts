// harvest-command.test.ts — command-level tests for harvest() via injection seams
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DanteState } from '../src/core/state.js';
import type { HarvestTrack } from '../src/core/harvest-engine.js';
import { harvest } from '../src/cli/commands/harvest.js';

function makeState(): DanteState {
  return {
    project: 'test', workflowStage: 'tasks', currentPhase: 0,
    profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {},
  } as unknown as DanteState;
}

// Mock LLM responses for each step
function makeStep1Json(): string {
  return JSON.stringify({
    objective: 'Build test system',
    donors: [{ name: 'DonorA', why: 'pattern', superpowers: ['fast'] }],
    superpowerClusters: ['efficiency'],
    organs: [{ name: 'Core', mandate: 'process', prohibition: 'mutate' }],
  });
}

function makeStep2Json(): string {
  return JSON.stringify({
    organBehaviors: { Core: { mandates: ['do X'], prohibitions: ['no Y'], states: ['idle'], operations: ['process'] } },
    globalMandates: ['be fast'],
    globalProhibitions: ['no mutation'],
  });
}

function makeStep3Json(): string {
  return JSON.stringify({
    signals: [{ name: 'ping', schema: '{}', invariants: 'always fires' }],
    wiringMap: 'Core -> ping -> Core',
    dependencyGraph: 'Core',
    spineCompliance: { api: true, event: true },
  });
}

function makeStep4Json(): string {
  return JSON.stringify({
    evidenceRules: ['rule 1'],
    testCharters: ['charter 1'],
    goldenFlows: ['flow 1', 'flow 2'],
  });
}

function makeStep5Json(): string {
  return JSON.stringify({
    metacodeCatalog: { patterns: ['p1'], antiPatterns: ['a1'] },
    gateSheet: { ready: true },
    expansionReadiness: 8,
    reflection: 'looks good',
  });
}

type HarvestOpts = Parameters<typeof harvest>[1];

function makeHarvestOpts(overrides: Partial<HarvestOpts> = {}): HarvestOpts & { saved: DanteState[] } {
  const state = makeState();
  const saved: DanteState[] = [];

  // Cycle through step responses for the 5 LLM calls
  const stepResponses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
  let callCount = 0;

  return {
    _isLLMAvailable: async () => false,
    _loadState: async () => ({ ...state, auditLog: [...state.auditLog] } as DanteState),
    _saveState: async (s: DanteState) => { saved.push(s); },
    _savePrompt: async (_name: string, _template: string) => '/tmp/harvest.md',
    _displayPrompt: (_template: string, _msg: string) => {},
    _writeTrackFiles: async (_track: HarvestTrack) => ({ trackPath: '/tmp/track.json', summaryPath: '/tmp/summary.md' }),
    _loadTrackCount: async () => 1,
    _shouldTriggerMetaEvolution: (_count: number) => false,
    _computeTrackHash: (_track: HarvestTrack) => 'abc123hash',
    _auditSelfEdit: async (_entry: unknown) => {},
    _llmCaller: async (_prompt: string) => {
      const response = stepResponses[callCount % stepResponses.length]!;
      callCount++;
      return response;
    },
    saved,
    ...overrides,
  };
}

// ── Prompt mode ───────────────────────────────────────────────────────────────

describe('harvest command: prompt mode', () => {
  it('calls _savePrompt with system name in the prompt name', async () => {
    const calls: Array<[string, string]> = [];
    const opts = makeHarvestOpts({
      _savePrompt: async (name, template) => { calls.push([name, template]); return '/tmp/harvest.md'; },
    });
    await harvest('my-system', { ...opts, prompt: true });
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0]![0].includes('my-system'), 'savePrompt name should include system name');
  });

  it('writes audit log entry with "prompt generated" in state', async () => {
    const opts = makeHarvestOpts();
    await harvest('payment-system', { ...opts, prompt: true });
    assert.ok(opts.saved.length > 0, 'state should be saved');
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.ok(entry.includes('prompt generated'), 'audit entry should say prompt generated');
    assert.ok(entry.includes('payment-system'), 'audit entry should include system name');
  });

  it('does NOT call _isLLMAvailable in prompt mode', async () => {
    let checked = false;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => { checked = true; return false; },
    });
    await harvest('system', { ...opts, prompt: true });
    assert.strictEqual(checked, false, '_isLLMAvailable should not be called in prompt mode');
  });
});

// ── LLM mode — pipeline ───────────────────────────────────────────────────────

describe('harvest command: LLM mode — full pipeline', () => {
  it('calls _llmCaller exactly 5 times in full mode', async () => {
    let callCount = 0;
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => {
        const resp = responses[callCount % responses.length]!;
        callCount++;
        return resp;
      },
    });
    await harvest('full-system', { ...opts });
    assert.strictEqual(callCount, 5, 'should call LLM exactly 5 times in full mode');
  });

  it('calls _llmCaller exactly 4 times in lite mode (step 4 skipped)', async () => {
    let callCount = 0;
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep5Json()];
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => {
        const resp = responses[callCount % responses.length]!;
        callCount++;
        return resp;
      },
    });
    await harvest('lite-system', { ...opts, lite: true });
    assert.strictEqual(callCount, 4, 'should call LLM exactly 4 times in lite mode');
  });

  it('calls _writeTrackFiles after all steps complete', async () => {
    let writeTrackCalled = false;
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
    let callCount = 0;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { const r = responses[callCount++ % responses.length]!; return r; },
      _writeTrackFiles: async (_track) => { writeTrackCalled = true; return { trackPath: '/tmp/t.json', summaryPath: '/tmp/s.md' }; },
    });
    await harvest('system', { ...opts });
    assert.ok(writeTrackCalled, '_writeTrackFiles should be called');
  });

  it('calls _loadTrackCount and _shouldTriggerMetaEvolution after writing', async () => {
    let countLoaded = false;
    let evolutionChecked = false;
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
    let callCount = 0;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { const r = responses[callCount++ % responses.length]!; return r; },
      _loadTrackCount: async () => { countLoaded = true; return 5; },
      _shouldTriggerMetaEvolution: (count) => { evolutionChecked = true; return count > 100; },
    });
    await harvest('system', { ...opts });
    assert.ok(countLoaded, '_loadTrackCount should be called');
    assert.ok(evolutionChecked, '_shouldTriggerMetaEvolution should be called');
  });

  it('writes WARNING to audit log when meta-evolution is triggered', async () => {
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
    let callCount = 0;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { const r = responses[callCount++ % responses.length]!; return r; },
      _shouldTriggerMetaEvolution: () => true,
    });
    await harvest('system', { ...opts });
    const allEntries = opts.saved[0]!.auditLog.join('\n');
    assert.ok(allEntries.includes('WARNING') || allEntries.includes('meta-evolution'), 'should log meta-evolution warning');
  });

  it('calls _auditSelfEdit with system name in reason', async () => {
    const auditCalls: unknown[] = [];
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
    let callCount = 0;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { const r = responses[callCount++ % responses.length]!; return r; },
      _auditSelfEdit: async (entry) => { auditCalls.push(entry); },
    });
    await harvest('payment-api', { ...opts });
    assert.strictEqual(auditCalls.length, 1);
    const entry = auditCalls[0] as Record<string, unknown>;
    assert.ok(String(entry.reason).includes('payment-api'), 'audit entry should include system name');
  });
});

// ── LLM mode — error handling ─────────────────────────────────────────────────

describe('harvest command: LLM mode — error handling', () => {
  it('falls back to local template display when _llmCaller throws', async () => {
    let displayCalled = false;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { throw new Error('API timeout'); },
      _displayPrompt: () => { displayCalled = true; },
    });
    await assert.doesNotReject(async () => {
      await harvest('system', { ...opts });
    });
    assert.ok(displayCalled, '_displayPrompt should be called in fallback after LLM error');
  });

  it('saves state even when LLM throws (fallback path)', async () => {
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { throw new Error('API error'); },
    });
    await harvest('system', { ...opts });
    assert.ok(opts.saved.length > 0, 'state should be saved in fallback path');
  });

  it('falls back to local template when LLM returns malformed JSON', async () => {
    let displayCalled = false;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => '{ invalid json }',
      _displayPrompt: () => { displayCalled = true; },
    });
    await harvest('system', { ...opts });
    assert.ok(displayCalled, '_displayPrompt should be called when extractJson throws');
  });

  it('saves state even when LLM returns malformed JSON', async () => {
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => 'not json at all',
    });
    await harvest('system', { ...opts });
    assert.ok(opts.saved.length > 0, 'state should be saved even on JSON parse failure');
  });
});

// ── Fallback mode ─────────────────────────────────────────────────────────────

describe('harvest command: fallback mode', () => {
  it('calls _displayPrompt when LLM unavailable', async () => {
    let displayCalled = false;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => false,
      _displayPrompt: () => { displayCalled = true; },
    });
    await harvest('system', { ...opts });
    assert.ok(displayCalled, '_displayPrompt should be called in fallback mode');
  });

  it('does NOT call _llmCaller when LLM unavailable', async () => {
    let llmCalled = false;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => false,
      _llmCaller: async () => { llmCalled = true; return '{}'; },
    });
    await harvest('system', { ...opts });
    assert.strictEqual(llmCalled, false, '_llmCaller should NOT be called in fallback mode');
  });

  it('saves state with "local template displayed" audit entry in fallback mode', async () => {
    const opts = makeHarvestOpts({ _isLLMAvailable: async () => false });
    await harvest('my-service', { ...opts });
    assert.ok(opts.saved.length > 0, 'state should be saved');
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.ok(entry.includes('local template displayed'), 'audit entry should mention local template');
    assert.ok(entry.includes('my-service'), 'audit entry should include system name');
  });
});

// ── Audit log ────────────────────────────────────────────────────────────────

describe('harvest command: audit log', () => {
  it('LLM success path writes audit log entry with system name and track info', async () => {
    const responses = [makeStep1Json(), makeStep2Json(), makeStep3Json(), makeStep4Json(), makeStep5Json()];
    let callCount = 0;
    const opts = makeHarvestOpts({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { const r = responses[callCount++ % responses.length]!; return r; },
    });
    await harvest('data-pipeline', { ...opts });
    const allEntries = opts.saved[0]!.auditLog.join('\n');
    assert.ok(allEntries.includes('harvest'), 'audit should contain "harvest"');
    assert.ok(allEntries.includes('ratified'), 'audit should mention ratified');
  });
});
