import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProjectsManifest,
  saveProjectsManifest,
  registerProject,
  formatBenchmarkTable,
  buildBenchmarkReport,
  defaultProjectsManifestPath,
  type ProjectRegistryEntry,
  type ProjectRegistryOptions,
} from '../src/core/project-registry.js';

function makeOpts(overrides: Partial<ProjectRegistryOptions> = {}): ProjectRegistryOptions {
  return {
    homeDir: '/tmp/fake-home',
    _readFile: async () => { throw new Error('ENOENT'); },
    _writeFile: async () => {},
    _mkdir: async () => {},
    _now: () => '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ProjectRegistryEntry> = {}): ProjectRegistryEntry {
  return {
    name: 'my-project',
    path: '/projects/my-project',
    lastSnapshot: '2026-01-01T00:00:00.000Z',
    avgScore: 80,
    artifactScores: {},
    topArtifact: null,
    bottomArtifact: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('project-registry: defaultProjectsManifestPath', () => {
  it('includes homeDir in path', () => {
    const p = defaultProjectsManifestPath('/home/user');
    assert.ok(p.includes('.danteforge'), 'should contain .danteforge');
    assert.ok(p.includes('projects.json'), 'should end with projects.json');
  });
});

describe('project-registry: loadProjectsManifest', () => {
  it('returns empty manifest when file not found', async () => {
    const result = await loadProjectsManifest(makeOpts());
    assert.deepEqual(result, { projects: [], lastUpdated: '' });
  });

  it('parses a valid manifest file', async () => {
    const manifest = { projects: [makeEntry()], lastUpdated: '2026-01-01T00:00:00.000Z' };
    const result = await loadProjectsManifest(makeOpts({
      _readFile: async () => JSON.stringify(manifest),
    }));
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].name, 'my-project');
    assert.equal(result.lastUpdated, '2026-01-01T00:00:00.000Z');
  });

  it('handles malformed JSON gracefully', async () => {
    const result = await loadProjectsManifest(makeOpts({
      _readFile: async () => 'not-json',
    }));
    assert.deepEqual(result, { projects: [], lastUpdated: '' });
  });
});

describe('project-registry: saveProjectsManifest', () => {
  it('calls mkdir then writeFile', async () => {
    const calls: string[] = [];
    await saveProjectsManifest(
      { projects: [], lastUpdated: '2026-01-01T00:00:00.000Z' },
      makeOpts({
        _mkdir: async () => { calls.push('mkdir'); },
        _writeFile: async () => { calls.push('write'); },
      }),
    );
    assert.deepEqual(calls, ['mkdir', 'write']);
  });

  it('serializes manifest to JSON', async () => {
    let saved = '';
    await saveProjectsManifest(
      { projects: [makeEntry()], lastUpdated: '2026-01-01T00:00:00.000Z' },
      makeOpts({ _writeFile: async (_p, c) => { saved = c; } }),
    );
    const parsed = JSON.parse(saved);
    assert.equal(parsed.projects[0].name, 'my-project');
  });
});

describe('project-registry: registerProject', () => {
  it('adds a new project to an empty manifest', async () => {
    let saved = '';
    const entry = await registerProject(
      '/projects/new-project',
      { avgScore: 75, scores: { SPEC: { score: 80 }, PLAN: { score: 70 } } },
      makeOpts({ _writeFile: async (_p, c) => { saved = c; } }),
    );
    assert.equal(entry.name, 'new-project');
    assert.equal(entry.avgScore, 75);
    const manifest = JSON.parse(saved);
    assert.equal(manifest.projects.length, 1);
  });

  it('updates an existing project entry by path', async () => {
    const existing = { projects: [makeEntry({ path: '/projects/existing', avgScore: 60 })], lastUpdated: '' };
    let saved = '';
    await registerProject(
      '/projects/existing',
      { avgScore: 90, scores: {} },
      makeOpts({
        _readFile: async () => JSON.stringify(existing),
        _writeFile: async (_p, c) => { saved = c; },
      }),
    );
    const manifest = JSON.parse(saved);
    assert.equal(manifest.projects.length, 1);
    assert.equal(manifest.projects[0].avgScore, 90);
  });

  it('identifies top and bottom artifacts', async () => {
    const entry = await registerProject(
      '/projects/p',
      { avgScore: 80, scores: { SPEC: { score: 90 }, PLAN: { score: 50 }, TESTS: { score: 70 } } },
      makeOpts(),
    );
    assert.equal(entry.topArtifact, 'SPEC');
    assert.equal(entry.bottomArtifact, 'PLAN');
  });

  it('preserves registeredAt for existing projects', async () => {
    const existing = { projects: [makeEntry({ path: '/p', registeredAt: '2025-01-01T00:00:00.000Z' })], lastUpdated: '' };
    let saved = '';
    await registerProject(
      '/p',
      { avgScore: 80, scores: {} },
      makeOpts({
        _readFile: async () => JSON.stringify(existing),
        _writeFile: async (_p, c) => { saved = c; },
      }),
    );
    const manifest = JSON.parse(saved);
    assert.equal(manifest.projects[0].registeredAt, '2025-01-01T00:00:00.000Z');
  });

  it('never throws on I/O failure', async () => {
    const entry = await registerProject(
      '/projects/p',
      { avgScore: 80, scores: {} },
      makeOpts({ _writeFile: async () => { throw new Error('disk full'); } }),
    );
    assert.equal(entry.name, 'p');
    assert.equal(entry.avgScore, 80);
  });
});

describe('project-registry: formatBenchmarkTable', () => {
  it('returns placeholder when no projects', () => {
    const result = formatBenchmarkTable([]);
    assert.ok(result.includes('No projects registered'));
  });

  it('sorts projects by avgScore descending', () => {
    const entries = [
      makeEntry({ name: 'low', avgScore: 50 }),
      makeEntry({ name: 'high', avgScore: 90 }),
    ];
    const result = formatBenchmarkTable(entries);
    assert.ok(result.indexOf('high') < result.indexOf('low'));
  });

  it('includes header row', () => {
    const result = formatBenchmarkTable([makeEntry()]);
    assert.ok(result.includes('AvgScore'));
    assert.ok(result.includes('Top Artifact'));
  });
});

describe('project-registry: buildBenchmarkReport', () => {
  it('includes generated date', () => {
    const result = buildBenchmarkReport([], '2026-01-01');
    assert.ok(result.includes('2026-01-01'));
  });

  it('includes per-project details for non-empty list', () => {
    const result = buildBenchmarkReport([makeEntry({ name: 'alpha', avgScore: 85 })], '2026-01-01');
    assert.ok(result.includes('alpha'));
    assert.ok(result.includes('85'));
  });
});
