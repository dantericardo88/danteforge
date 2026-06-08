// project-detect.test.ts — infer a ProjectIntent from a cold repo (package.json + README), fully
// seamed (no real disk). Confidence must scale with signal so a bare repo is honestly low-confidence.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProjectIntent } from '../src/matrix-orchestration/discovery/project-detect.js';

// A fake fs: map of relative filename -> content. Missing files reject (as fs.readFile does).
function fakeRepo(files: Record<string, string>) {
  return async (p: string): Promise<string> => {
    const key = Object.keys(files).find(k => p.replace(/\\/g, '/').endsWith(k));
    if (key) return files[key]!;
    throw new Error('ENOENT');
  };
}
const now = () => '2026-06-08T00:00:00.000Z';

describe('detectProjectIntent — project type detection', () => {
  test('a package with a bin field → cli_tool, name de-scoped, keywords → categories', async () => {
    const intent = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({
        'package.json': JSON.stringify({ name: '@acme/zap', description: 'A fast task runner', bin: { zap: 'cli.js' }, keywords: ['task-runner', 'build', 'cli'] }),
      }),
    });
    assert.equal(intent.projectType, 'cli_tool');
    assert.equal(intent.projectName, 'zap', 'npm scope stripped');
    assert.equal(intent.goal, 'A fast task runner');
    assert.ok(intent.competitiveCategoryBoundary.direct.includes('cli tool'));
    assert.ok(intent.competitiveCategoryBoundary.direct.includes('task-runner'));
    assert.ok(intent.confidence >= 0.6, 'pkg + description + keywords → usable confidence');
  });

  test('engines.vscode → ide_extension even with react in deps (specific signal wins)', async () => {
    const intent = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({ 'package.json': JSON.stringify({ name: 'cool-ext', engines: { vscode: '^1.80.0' }, dependencies: { react: '^18' } }) }),
    });
    assert.equal(intent.projectType, 'ide_extension');
  });

  test('react/next deps → web_app', async () => {
    const intent = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({ 'package.json': JSON.stringify({ name: 'site', dependencies: { next: '^14', react: '^18' } }) }),
    });
    assert.equal(intent.projectType, 'web_app');
  });

  test('an LLM SDK + agent language → agent_runtime; a bare lib → library', async () => {
    const agent = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({ 'package.json': JSON.stringify({ name: 'swarm', description: 'autonomous agent orchestrator', dependencies: { '@anthropic-ai/sdk': '^0.30' } }) }),
    });
    assert.equal(agent.projectType, 'agent_runtime');
    const lib = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({ 'package.json': JSON.stringify({ name: 'leftpad', main: 'index.js' }) }),
    });
    assert.equal(lib.projectType, 'library');
  });
});

describe('detectProjectIntent — README mining + honest confidence', () => {
  test('pulls features from README bullets/headings and a goal from the first paragraph', async () => {
    const readme = [
      '# CoolTool', '', '![badge](x)', '', 'CoolTool makes your builds reproducible and fast.', '',
      '## Reproducible builds', '## Remote caching', '## Installation', '- Deterministic hashing', '- Parallel execution',
    ].join('\n');
    const intent = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({ 'package.json': JSON.stringify({ name: 'cooltool' }), 'README.md': readme }),
    });
    assert.match(intent.goal, /reproducible and fast/);
    assert.ok(intent.keyFeatures.includes('Reproducible builds'));
    assert.ok(intent.keyFeatures.includes('Deterministic hashing'));
    assert.ok(!intent.keyFeatures.includes('Installation'), 'boilerplate headings excluded');
  });

  test('a bare repo (no package.json, no README) is honestly LOW confidence (<0.6) and type=other', async () => {
    const intent = await detectProjectIntent('/some/empty-repo', { _now: now, _readFile: fakeRepo({}) });
    assert.equal(intent.projectType, 'other');
    assert.equal(intent.projectName, 'empty-repo', 'falls back to the directory name');
    assert.ok(intent.confidence < 0.6, `bare repo must be sub-threshold, got ${intent.confidence}`);
  });

  test('security/perf wording → constraintEmphasis; enterprise wording → targetUser', async () => {
    const intent = await detectProjectIntent('/repo', {
      _now: now,
      _readFile: fakeRepo({ 'package.json': JSON.stringify({ name: 'vault', description: 'enterprise secrets manager with encryption and low-latency access', keywords: ['security', 'performance'] }) }),
    });
    assert.ok(intent.constraintEmphasis.includes('security_critical'));
    assert.ok(intent.constraintEmphasis.includes('performance_critical'));
    assert.equal(intent.targetUser, 'enterprise');
  });
});
