// synthesis-runner.test.ts — Phase P deterministic synthesis correctness.
//
// 3-outcome logic (PROMOTE | CONFLICT | CAP) verified across fixtures.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runDeterministicSynthesis } from '../src/matrix/research/synthesis-runner.js';

let tmpDir = '';
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synth-')); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

async function seedAgent(roleId: string, files: Record<string, string>): Promise<void> {
  const dir = path.join(tmpDir, roleId);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
}

const ALL_ROLES = [
  'benchmark-designer', 'literature-scout', 'frontier-reverse-engineer',
  'adversarial-critic', 'alternative-architect', 'cost-complexity-analyzer',
  'constitutional-reviewer', 'sovereignty-auditor', 'wiring-validator',
  'hybrid-synthesizer',
];

describe('runDeterministicSynthesis — PROMOTE', () => {
  it('promotes single survivor when only one constructive proposal exists', async () => {
    await seedAgent('literature-scout', {
      'hypothesis.md': '# Hypothesis A\n',
    });
    await seedAgent('constitutional-reviewer', {
      'findings.md': '# Review\n\nAll clear.\n',
    });
    await seedAgent('sovereignty-auditor', {
      'dependencies.json': JSON.stringify({ audited: [], auto_quarantined_count: 0 }),
    });
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'promote');
    assert.equal(result.winningAgentId, 'literature-scout');
    assert.match(result.markdown, /Verdict: PROMOTE/);
  });

  it('promotes the clear cost-complexity winner when multiple survive', async () => {
    for (const id of ['literature-scout', 'frontier-reverse-engineer', 'alternative-architect']) {
      await seedAgent(id, { 'hypothesis.md': '# Hypothesis\n' });
    }
    await seedAgent('constitutional-reviewer', { 'findings.md': '# Review\nAll clear.\n' });
    await seedAgent('sovereignty-auditor', {
      'dependencies.json': JSON.stringify({ audited: [], auto_quarantined_count: 0 }),
    });
    await seedAgent('cost-complexity-analyzer', {
      'confidence.json': JSON.stringify({
        ranked_proposals: [
          { agent_id: 'literature-scout', rank: 1, confidence: 0.9 },
          { agent_id: 'alternative-architect', rank: 2, confidence: 0.5 },
          { agent_id: 'frontier-reverse-engineer', rank: 3, confidence: 0.4 },
        ],
        synthesis_recommendation_signal: 'clear_winner',
      }),
    });
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'promote');
    assert.equal(result.winningAgentId, 'literature-scout');
  });
});

describe('runDeterministicSynthesis — CONFLICT', () => {
  it('reports CONFLICT when 2+ survivors and no clear cost-complexity winner', async () => {
    for (const id of ['literature-scout', 'frontier-reverse-engineer', 'alternative-architect']) {
      await seedAgent(id, { 'hypothesis.md': '# Hypothesis\n' });
    }
    await seedAgent('constitutional-reviewer', { 'findings.md': '# Review\nAll clear.\n' });
    await seedAgent('sovereignty-auditor', {
      'dependencies.json': JSON.stringify({ audited: [], auto_quarantined_count: 0 }),
    });
    // cost-complexity says top-2 are within 0.05 — too close to call
    await seedAgent('cost-complexity-analyzer', {
      'confidence.json': JSON.stringify({
        ranked_proposals: [
          { agent_id: 'literature-scout', rank: 1, confidence: 0.6 },
          { agent_id: 'alternative-architect', rank: 2, confidence: 0.58 },
          { agent_id: 'frontier-reverse-engineer', rank: 3, confidence: 0.4 },
        ],
        synthesis_recommendation_signal: 'close_call',
      }),
    });
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'conflict');
    assert.ok(result.conflictingAgentIds && result.conflictingAgentIds.length >= 2);
    assert.match(result.markdown, /Verdict: CONFLICT/);
  });
});

describe('runDeterministicSynthesis — CAP', () => {
  it('caps when no constructive hypotheses exist', async () => {
    // Only critique + validation agents ran; no one proposed code.
    await seedAgent('adversarial-critic', { 'findings.md': '# Critique\n' });
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'cap');
    assert.match(result.markdown, /Verdict: CAP/);
    assert.match(result.reason, /no constructive hypotheses/);
  });

  it('caps when constitutional review blocks every proposal', async () => {
    for (const id of ['literature-scout', 'frontier-reverse-engineer']) {
      await seedAgent(id, { 'hypothesis.md': '# Hypothesis\n' });
    }
    await seedAgent('constitutional-reviewer', {
      'findings.md': '# Review\n\n## Violations (proposals that cannot be promoted)\n\n### literature-scout: invariant I1\n\nproposes external dep\n\n### frontier-reverse-engineer: invariant I2\n\nincorporates competitor code\n',
    });
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'cap');
    assert.match(result.reason, /constitutional/);
  });

  it('caps when sovereignty auditor rejects every proposal', async () => {
    for (const id of ['literature-scout', 'frontier-reverse-engineer']) {
      await seedAgent(id, { 'hypothesis.md': '# Hypothesis\n' });
    }
    await seedAgent('sovereignty-auditor', {
      'dependencies.json': JSON.stringify({
        audited: [
          { name: 'foo', proposed_by: 'literature-scout', verdict: 'reject' },
          { name: 'bar', proposed_by: 'frontier-reverse-engineer', verdict: 'reject' },
        ],
        auto_quarantined_count: 2,
      }),
    });
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'cap');
    assert.match(result.reason, /sovereignty/);
  });
});

describe('runDeterministicSynthesis — synthesizer override', () => {
  it('uses hybrid-synthesizer\'s recommendation when present', async () => {
    await seedAgent('hybrid-synthesizer', {
      'synthesis-recommendation.md': '# Synthesis\n\n## Verdict: CAP\n\n## Reasoning\n\nLLM said cap.\n',
    });
    // No other agents seeded — would normally CAP via "no hypotheses",
    // but synthesizer override should win.
    const result = await runDeterministicSynthesis({ waveDir: tmpDir, roleIds: ALL_ROLES });
    assert.equal(result.outcome, 'cap');
    assert.match(result.markdown, /LLM said cap/);
  });
});
