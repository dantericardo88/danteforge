import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runSkill, type SkillExecutor } from '../src/spine/skill_runner/runner.js';
import { parseFrontmatterFromString } from '../src/spine/skill_runner/frontmatter.js';
import { validate } from '../src/spine/truth_loop/schema-validator.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-skill-runner-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

test('frontmatter parser: reads name, description, and dimension list', () => {
  const raw = `---
name: dante-tdd
description: "Use when implementing"
based_on: mattpocock/skills/tdd
license: MIT
required_dimensions:
  - testing
  - errorHandling
sacred_content_types:
  - test_names
---

body content
`;
  const fm = parseFrontmatterFromString(raw);
  assert.equal(fm.name, 'dante-tdd');
  assert.equal(fm.basedOn, 'mattpocock/skills/tdd');
  assert.deepEqual(fm.requiredDimensions, ['testing', 'errorHandling']);
  assert.deepEqual(fm.sacredContentTypes, ['test_names']);
});

test('frontmatter parser: missing fence throws', () => {
  assert.throws(() => parseFrontmatterFromString('no frontmatter here'));
});

test('skill runner: green path with all dimensions ≥9.0 emits complete verdict', async () => {
  const executor: SkillExecutor = async () => ({
    output: { artifact: 'foo' },
    surfacedAssumptions: ['founder confirmed empanada flavors are stable']
  });

  const result = await runSkill(executor, {
    skillName: 'dante-test-skill',
    repo: workspace,
    inputs: { x: 1 },
    runId: 'run_20260428_701',
    frontmatter: {
      name: 'dante-test-skill',
      description: 'test',
      requiredDimensions: ['testing', 'errorHandling']
    },
    scorer: () => ({ testing: 9.5, errorHandling: 9.2 })
  });

  assert.equal(result.gate.overall, 'green');
  assert.equal(result.verdict.finalStatus, 'complete');
  assert.equal(validate('verdict', result.verdict).valid, true);
  assert.equal(validate('next_action', result.nextAction).valid, true);
  assert.ok(existsSync(resolve(result.outputDir, 'verdict.json')));
  assert.ok(existsSync(resolve(result.outputDir, 'next_action_prompt.md')));
});

test('skill runner: proof-seals artifacts with provided git SHA before promotion', async () => {
  const executor: SkillExecutor = async () => ({ output: { artifact: 'sealed' } });

  const result = await runSkill(executor, {
    skillName: 'dante-proofed-skill',
    repo: workspace,
    inputs: {},
    runId: 'run_20260428_711',
    gitSha: 'abc123',
    frontmatter: {
      name: 'dante-proofed-skill',
      description: 'test',
      requiredDimensions: ['testing']
    },
    scorer: () => ({ testing: 9.5 })
  });

  assert.equal(result.gate.overall, 'green');
  assert.ok(result.artifacts.every(a => a.proof?.gitSha === 'abc123'));
});

test('skill runner: red path when a required dimension scores below 9.0', async () => {
  const executor: SkillExecutor = async () => ({ output: 'meh' });

  const result = await runSkill(executor, {
    skillName: 'dante-test-skill',
    repo: workspace,
    inputs: {},
    runId: 'run_20260428_702',
    frontmatter: {
      name: 'dante-test-skill',
      description: 'test',
      requiredDimensions: ['testing', 'maintainability']
    },
    scorer: () => ({ testing: 9.5, maintainability: 6.0 })
  });

  assert.equal(result.gate.overall, 'red');
  assert.notEqual(result.verdict.finalStatus, 'complete');
  assert.ok(result.gate.blockingReasons.some(r => r.includes('maintainability')));
});

test('skill runner: writes all artifacts to .danteforge/skill-runs/<skill>/<runId>/', async () => {
  const executor: SkillExecutor = async () => ({
    output: { v: 1 },
    phaseArtifacts: [
      { label: 'phase1', payload: { phase: 1 } },
      { label: 'phase2', payload: { phase: 2 } }
    ]
  });

  const result = await runSkill(executor, {
    skillName: 'dante-multi-phase',
    repo: workspace,
    inputs: {},
    runId: 'run_20260428_703',
    frontmatter: {
      name: 'dante-multi-phase',
      description: 'test',
      requiredDimensions: ['testing']
    },
    scorer: () => ({ testing: 9.5 })
  });

  assert.equal(result.artifacts.length, 3); // 1 primary + 2 phase
  assert.ok(existsSync(resolve(result.outputDir, 'artifacts.json')));
  assert.ok(existsSync(resolve(result.outputDir, 'evidence.json')));
  const persisted = JSON.parse(readFileSync(resolve(result.outputDir, 'artifacts.json'), 'utf-8'));
  assert.equal(persisted.length, 3);
});

test('skill runner: cap-aware gate — declared dim at structural cap promotes overall to green when useRealScorer=true', async () => {
  const executor: SkillExecutor = async () => ({ output: { atCapTest: true } });
  const result = await runSkill(executor, {
    skillName: 'dante-to-prd',
    repo: process.cwd(),
    inputs: {},
    runId: 'run_20260428_901',
    frontmatter: {
      name: 'dante-to-prd',
      description: 'cap-aware test',
      requiredDimensions: ['specDrivenPipeline']
    },
    useRealScorer: true
  });
  assert.equal(result.gate.overall, 'green', `expected green via cap-aware promotion, got ${result.gate.overall}`);
});

test('skill runner: cap-aware gate red when dim is below BOTH 9.0 AND its structural cap', async () => {
  const executor: SkillExecutor = async () => ({ output: { redTest: true } });
  const result = await runSkill(executor, {
    skillName: 'dante-to-prd',
    repo: process.cwd(),
    inputs: {},
    runId: 'run_20260428_902',
    frontmatter: {
      name: 'dante-to-prd',
      description: 'cap-aware red test',
      requiredDimensions: ['specDrivenPipeline']
    },
    scorer: () => ({ specDrivenPipeline: 5.0 })
  });
  assert.equal(result.gate.overall, 'red');
});

test('skill runner: useRealScorer pulls dim scores from the real harsh-scorer (PRD-MASTER §7.5 #2)', async () => {
  // Use the actual DanteForge cwd so the real scorer has a real project to grade.
  // Required dim is `testing` because it's a stable, non-strict-capped dim that should be ≥9.0.
  const executor: SkillExecutor = async () => ({ output: { realTask: 'phase-B-test' } });

  const result = await runSkill(executor, {
    skillName: 'dante-tdd',
    repo: process.cwd(),
    inputs: {},
    runId: 'run_20260428_801',
    frontmatter: {
      name: 'dante-tdd',
      description: 'real-scorer test',
      requiredDimensions: ['testing']  // testing 9.7 in strict mode — should pass
    },
    useRealScorer: true
  });

  // The score must be a real number (not the injected 9.0 default) and reflect actual project state
  const testingScore = result.scoresByDimension.testing;
  assert.ok(typeof testingScore === 'number', 'real-scorer should produce a number');
  assert.ok(testingScore !== 9.0, `expected real-scorer value, got fallback 9.0 (suggests scorer didn't fire)`);
  assert.ok(testingScore >= 0 && testingScore <= 10, `score out of range: ${testingScore}`);
});

test('skill runner: surfacedAssumptions become opinion claims in verdict', async () => {
  const executor: SkillExecutor = async () => ({
    output: 'ok',
    surfacedAssumptions: [
      'we assume Sean Lippay is still at Strategic Food Solutions',
      'we assume the GFSI timeline document is current'
    ]
  });

  const result = await runSkill(executor, {
    skillName: 'dante-grill-me',
    repo: workspace,
    inputs: {},
    runId: 'run_20260428_704',
    frontmatter: {
      name: 'dante-grill-me',
      description: 'test',
      requiredDimensions: ['planningQuality']
    },
    scorer: () => ({ planningQuality: 9.5 })
  });

  assert.equal((result.verdict.opinionClaims?.length ?? 0), 2);
});
