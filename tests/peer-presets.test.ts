// Tests for src/core/peer-presets.ts — the per-project peer preset resolver.
// Covers: preset catalog correctness, identity heuristics, and override paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getPeerPreset,
  listAvailablePresets,
  isPeerPreset,
  resolveProjectPreset,
  resolveProjectCompetitors,
} from '../src/core/peer-presets.js';

function mkTmpProject(opts: { packageName?: string; peersJson?: object } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dante-peer-presets-'));
  mkdirSync(join(dir, '.danteforge'), { recursive: true });
  if (opts.packageName !== undefined) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: opts.packageName }));
  }
  if (opts.peersJson) {
    writeFileSync(join(dir, '.danteforge', 'peers.json'), JSON.stringify(opts.peersJson));
  }
  return dir;
}

// ── Preset catalog ────────────────────────────────────────────────────────────

test('listAvailablePresets returns all three named presets', () => {
  const names = listAvailablePresets();
  assert.deepEqual(new Set(names), new Set(['coding-assistant', 'dev-tool-optimizer', 'agent-framework']));
});

test('isPeerPreset accepts valid preset names, rejects others', () => {
  assert.equal(isPeerPreset('coding-assistant'), true);
  assert.equal(isPeerPreset('dev-tool-optimizer'), true);
  assert.equal(isPeerPreset('agent-framework'), true);
  assert.equal(isPeerPreset('bogus'), false);
  assert.equal(isPeerPreset(''), false);
  assert.equal(isPeerPreset(42), false);
  assert.equal(isPeerPreset(null), false);
});

test('coding-assistant preset includes Cursor, Aider, Cline, OpenHands — NOT spec-kit', () => {
  const list = getPeerPreset('coding-assistant');
  assert.ok(list.length >= 15, `expected >= 15 entries, got ${list.length}`);
  assert.ok(list.some(c => /^Cursor$/i.test(c)), 'Cursor in coding-assistant');
  assert.ok(list.some(c => /Aider/i.test(c)), 'Aider in coding-assistant');
  assert.ok(list.some(c => /Cline/i.test(c)), 'Cline in coding-assistant');
  assert.ok(list.some(c => /OpenHands/i.test(c)), 'OpenHands in coding-assistant');
  assert.ok(list.some(c => /Continue/i.test(c)), 'Continue in coding-assistant');
  assert.ok(!list.some(c => /^spec-kit/i.test(c)), 'spec-kit should NOT be in coding-assistant preset');
  assert.ok(!list.some(c => /BMad/i.test(c)), 'BMad should NOT be in coding-assistant preset');
});

test('dev-tool-optimizer preset includes spec-kit, BMAD, claude-skills — NOT Cursor', () => {
  const list = getPeerPreset('dev-tool-optimizer');
  assert.ok(list.length >= 14, `expected >= 14 entries, got ${list.length}`);
  assert.ok(list.some(c => /spec-kit/i.test(c)), 'spec-kit in dev-tool-optimizer');
  assert.ok(list.some(c => /BMad/i.test(c)), 'BMad-METHOD in dev-tool-optimizer');
  assert.ok(list.some(c => /claude-skills/i.test(c)), 'claude-skills in dev-tool-optimizer');
  assert.ok(list.some(c => /DSPy/i.test(c)), 'DSPy in dev-tool-optimizer');
  assert.ok(!list.some(c => /^Cursor$/i.test(c)), 'Cursor should NOT be in dev-tool-optimizer preset');
  assert.ok(!list.some(c => /^Devin/i.test(c)), 'Devin should NOT be in dev-tool-optimizer preset');
});

test('agent-framework preset includes MetaGPT, CrewAI, AutoGen', () => {
  const list = getPeerPreset('agent-framework');
  assert.ok(list.length >= 5, `expected >= 5 entries, got ${list.length}`);
  assert.ok(list.some(c => /MetaGPT/i.test(c)));
  assert.ok(list.some(c => /CrewAI/i.test(c)));
  assert.ok(list.some(c => /AutoGen/i.test(c)));
});

test('getPeerPreset throws on unknown preset name', () => {
  // @ts-expect-error — runtime check for invalid input
  assert.throws(() => getPeerPreset('nope'), /Unknown peer preset/);
});

// ── Identity heuristics ───────────────────────────────────────────────────────

test('resolveProjectPreset: package.json name="danteforge" → dev-tool-optimizer', async () => {
  const dir = mkTmpProject({ packageName: 'danteforge' });
  const result = await resolveProjectPreset(dir);
  assert.equal(result.preset, 'dev-tool-optimizer');
  assert.match(result.reason, /package\.json/);
});

test('resolveProjectPreset: package.json name="@danteforge/cli" → dev-tool-optimizer', async () => {
  const dir = mkTmpProject({ packageName: '@danteforge/cli' });
  const result = await resolveProjectPreset(dir);
  assert.equal(result.preset, 'dev-tool-optimizer');
});

test('resolveProjectPreset: package.json name="dantecode" → coding-assistant (matches keyword)', async () => {
  const dir = mkTmpProject({ packageName: 'dantecode' });
  const result = await resolveProjectPreset(dir);
  assert.equal(result.preset, 'coding-assistant');
});

test('resolveProjectPreset: state.project="my-ide-agent" → coding-assistant (keyword match)', async () => {
  const dir = mkTmpProject();
  const result = await resolveProjectPreset(dir, { project: 'my-ide-agent' });
  assert.equal(result.preset, 'coding-assistant');
});

test('resolveProjectPreset: nothing matches → null with configuration hint', async () => {
  const dir = mkTmpProject();
  const result = await resolveProjectPreset(dir);
  assert.equal(result.preset, null);
  assert.match(result.reason, /configure|unknown|peers\.json/);
});

// ── Override paths ────────────────────────────────────────────────────────────

test('resolveProjectPreset: .danteforge/peers.json with preset wins over package.json identity', async () => {
  const dir = mkTmpProject({
    packageName: 'danteforge',
    peersJson: { preset: 'agent-framework' },
  });
  const result = await resolveProjectPreset(dir);
  assert.equal(result.preset, 'agent-framework');
  assert.match(result.reason, /peers\.json/);
});

test('resolveProjectPreset: .danteforge/peers.json with literal competitors returns null preset + literal list', async () => {
  const dir = mkTmpProject({
    peersJson: { competitors: ['CustomPeerA', 'CustomPeerB'] },
  });
  const result = await resolveProjectPreset(dir);
  assert.equal(result.preset, null);
  assert.deepEqual(result.literalCompetitors, ['CustomPeerA', 'CustomPeerB']);
});

test('resolveProjectPreset: state.peerPreset overrides identity heuristic', async () => {
  const dir = mkTmpProject({ packageName: 'danteforge' });
  const result = await resolveProjectPreset(dir, { peerPreset: 'coding-assistant' });
  assert.equal(result.preset, 'coding-assistant');
  assert.match(result.reason, /state\.peerPreset/);
});

// ── Convenience: resolveProjectCompetitors ────────────────────────────────────

test('resolveProjectCompetitors returns the right list for a DanteForge cwd', async () => {
  const dir = mkTmpProject({ packageName: 'danteforge' });
  const { competitors, preset } = await resolveProjectCompetitors(dir);
  assert.equal(preset, 'dev-tool-optimizer');
  assert.ok(competitors.some(c => /spec-kit/i.test(c)));
});

test('resolveProjectCompetitors returns the right list for a DanteCode cwd', async () => {
  const dir = mkTmpProject({ packageName: 'dantecode' });
  const { competitors, preset } = await resolveProjectCompetitors(dir);
  assert.equal(preset, 'coding-assistant');
  assert.ok(competitors.some(c => /^Cursor$/i.test(c)));
});

test('resolveProjectCompetitors returns literal competitors when peers.json supplies them', async () => {
  const dir = mkTmpProject({
    peersJson: { competitors: ['CustomA', 'CustomB'] },
  });
  const { competitors, preset } = await resolveProjectCompetitors(dir);
  assert.equal(preset, null);
  assert.deepEqual(competitors, ['CustomA', 'CustomB']);
});

test('resolveProjectCompetitors returns empty list when nothing matches', async () => {
  const dir = mkTmpProject();
  const { competitors, preset } = await resolveProjectCompetitors(dir);
  assert.equal(preset, null);
  assert.deepEqual(competitors, []);
});
