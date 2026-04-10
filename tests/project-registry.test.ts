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
import { writePdseSnapshot } from '../src/core/pdse-snapshot.js';
import { buildCompetitorProfilesFromRegistry } from '../src/core/competitor-scanner.js';
import type { ScoreResult } from '../src/core/pdse.js';
import type { ScoredArtifact, AutoforgeDecision } from '../src/core/pdse-config.js';

// ── defaultProjectsManifestPath ───────────────────────────────────────────────

describe('defaultProjectsManifestPath', () => {
  it('uses provided homeDir', () => {
    const p = defaultProjectsManifestPath('/home/test');
    assert.ok(p.includes('.danteforge'));
    assert.ok(p.includes('projects.json'));
    assert.ok(p.includes('test'));
  });
});

// ── loadProjectsManifest ──────────────────────────────────────────────────────

describe('loadProjectsManifest', () => {
  it('returns empty manifest when file absent', async () => {
    const opts: ProjectRegistryOptions = {
      _readFile: async () => { throw new Error('ENOENT'); },
      homeDir: '/tmp/fake',
    };
    const result = await loadProjectsManifest(opts);
    assert.deepEqual(result.projects, []);
    assert.equal(result.lastUpdated, '');
  });

  it('parses valid projects.json', async () => {
    const entry: ProjectRegistryEntry = {
      name: 'myapp',
      path: '/projects/myapp',
      lastSnapshot: '2026-01-01T00:00:00.000Z',
      avgScore: 72,
      artifactScores: {},
      topArtifact: null,
      bottomArtifact: null,
      registeredAt: '2026-01-01T00:00:00.000Z',
    };
    const opts: ProjectRegistryOptions = {
      _readFile: async () => JSON.stringify({ projects: [entry], lastUpdated: '2026' }),
      homeDir: '/tmp/fake',
    };
    const result = await loadProjectsManifest(opts);
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].name, 'myapp');
  });
});

// ── saveProjectsManifest ──────────────────────────────────────────────────────

describe('saveProjectsManifest', () => {
  it('writes valid JSON', async () => {
    let written = '';
    const opts: ProjectRegistryOptions = {
      _writeFile: async (_p, c) => { written = c; },
      _mkdir: async () => {},
      homeDir: '/tmp/fake',
    };
    await saveProjectsManifest({ projects: [], lastUpdated: '2026' }, opts);
    const parsed = JSON.parse(written);
    assert.deepEqual(parsed.projects, []);
  });

  it('creates .danteforge/ directory', async () => {
    let mkdirCalled = false;
    const opts: ProjectRegistryOptions = {
      _writeFile: async () => {},
      _mkdir: async () => { mkdirCalled = true; },
      homeDir: '/tmp/fake',
    };
    await saveProjectsManifest({ projects: [], lastUpdated: '' }, opts);
    assert.ok(mkdirCalled);
  });
});

// ── registerProject ───────────────────────────────────────────────────────────

describe('registerProject', () => {
  function makeOpts(existing: ProjectRegistryEntry[] = []) {
    let written = '';
    const opts: ProjectRegistryOptions = {
      _readFile: async () => JSON.stringify({ projects: existing, lastUpdated: '' }),
      _writeFile: async (_p, c) => { written = c; },
      _mkdir: async () => {},
      homeDir: '/tmp/fake',
      _now: () => '2026-04-06T00:00:00.000Z',
    };
    return { opts, getWritten: () => written };
  }

  it('creates a new entry for unknown path', async () => {
    const { opts, getWritten } = makeOpts();
    await registerProject('/projects/newapp', { avgScore: 65, scores: { CONSTITUTION: { score: 80 } } }, opts);
    const saved = JSON.parse(getWritten());
    assert.ok(saved.projects.some((p: ProjectRegistryEntry) => p.path === '/projects/newapp'));
  });

  it('upserts existing entry by path', async () => {
    const existing: ProjectRegistryEntry = {
      name: 'app', path: '/projects/app', lastSnapshot: '2025', avgScore: 50,
      artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '2025',
    };
    const { opts, getWritten } = makeOpts([existing]);
    await registerProject('/projects/app', { avgScore: 80, scores: { SPEC: { score: 80 } } }, opts);
    const saved = JSON.parse(getWritten());
    const found = saved.projects.find((p: ProjectRegistryEntry) => p.path === '/projects/app');
    assert.equal(found.avgScore, 80);
    assert.equal(saved.projects.filter((p: ProjectRegistryEntry) => p.path === '/projects/app').length, 1);
  });

  it('derives topArtifact correctly', async () => {
    const { opts } = makeOpts();
    const entry = await registerProject('/proj', {
      avgScore: 70,
      scores: { CONSTITUTION: { score: 90 }, SPEC: { score: 60 } },
    }, opts);
    assert.equal(entry.topArtifact, 'CONSTITUTION');
  });

  it('derives bottomArtifact correctly', async () => {
    const { opts } = makeOpts();
    const entry = await registerProject('/proj', {
      avgScore: 70,
      scores: { CONSTITUTION: { score: 90 }, SPEC: { score: 60 } },
    }, opts);
    assert.equal(entry.bottomArtifact, 'SPEC');
  });

  it('never throws on write failure', async () => {
    const opts: ProjectRegistryOptions = {
      _readFile: async () => { throw new Error('boom'); },
      _writeFile: async () => { throw new Error('boom'); },
      _mkdir: async () => {},
      homeDir: '/tmp/fake',
    };
    await assert.doesNotReject(() =>
      registerProject('/proj', { avgScore: 50, scores: {} }, opts),
    );
  });
});

// ── formatBenchmarkTable ──────────────────────────────────────────────────────

describe('formatBenchmarkTable', () => {
  const makeEntries = (scores: number[]): ProjectRegistryEntry[] =>
    scores.map((s, i) => ({
      name: `proj${i}`, path: `/proj${i}`, lastSnapshot: '2026-01-01', avgScore: s,
      artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '2026',
    }));

  it('sorts by avgScore descending', () => {
    const table = formatBenchmarkTable(makeEntries([40, 80, 60]));
    const lines = table.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('AvgScore'));
    // First data row should have score 80
    assert.ok(lines[0].includes('80'));
  });

  it('renders correct column headers', () => {
    const table = formatBenchmarkTable(makeEntries([50]));
    assert.ok(table.includes('Project'));
    assert.ok(table.includes('AvgScore'));
    assert.ok(table.includes('Top Artifact'));
    assert.ok(table.includes('Last Run'));
  });

  it('shows N/A for null artifact fields', () => {
    const table = formatBenchmarkTable(makeEntries([50]));
    assert.ok(table.includes('N/A'));
  });

  it('returns no-projects message when empty', () => {
    const table = formatBenchmarkTable([]);
    assert.ok(table.includes('No projects registered'));
  });

  it('row starts with rank number', () => {
    const table = formatBenchmarkTable(makeEntries([70, 50]));
    assert.ok(table.includes('| 1 |'));
    assert.ok(table.includes('| 2 |'));
  });
});

// ── buildBenchmarkReport ──────────────────────────────────────────────────────

describe('buildBenchmarkReport', () => {
  it('includes all project names', () => {
    const entries: ProjectRegistryEntry[] = [
      { name: 'alpha', path: '/alpha', lastSnapshot: '2026', avgScore: 80, artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '2026' },
      { name: 'beta', path: '/beta', lastSnapshot: '2026', avgScore: 60, artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '2026' },
    ];
    const report = buildBenchmarkReport(entries, '2026-04-06');
    assert.ok(report.includes('alpha'));
    assert.ok(report.includes('beta'));
  });

  it('includes generatedAt timestamp', () => {
    const report = buildBenchmarkReport([], '2026-04-06T12:00:00Z');
    assert.ok(report.includes('2026-04-06'));
  });

  it('includes project count', () => {
    const report = buildBenchmarkReport([], '2026');
    assert.ok(report.includes('0'));
  });
});

// ── writePdseSnapshot _registerProject integration ───────────────────────────

describe('writePdseSnapshot _registerProject integration', () => {
  function makeScores(): Record<ScoredArtifact, ScoreResult> {
    return {
      CONSTITUTION: { score: 80, autoforgeDecision: 'advance' as AutoforgeDecision, dimensions: {} as any, remediationSuggestions: [] },
    } as any;
  }

  it('calls _registerProject after successful write', async () => {
    let registered = false;
    await writePdseSnapshot(
      makeScores(),
      '/fake/cwd',
      {
        _writeFile: async () => {},
        _mkdir: async () => {},
        _registerProject: async () => { registered = true; },
      },
    );
    assert.ok(registered);
  });

  it('skips registration when skipRegistration: true', async () => {
    let registered = false;
    await writePdseSnapshot(
      makeScores(),
      '/fake/cwd',
      {
        _writeFile: async () => {},
        _mkdir: async () => {},
        _registerProject: async () => { registered = true; },
        skipRegistration: true,
      },
    );
    assert.ok(!registered);
  });

  it('does not throw when _registerProject fails', async () => {
    await assert.doesNotReject(() =>
      writePdseSnapshot(
        makeScores(),
        '/fake/cwd',
        {
          _writeFile: async () => {},
          _mkdir: async () => {},
          _registerProject: async () => { throw new Error('registration boom'); },
        },
      ),
    );
  });
});

// ── buildCompetitorProfilesFromRegistry ──────────────────────────────────────

describe('buildCompetitorProfilesFromRegistry', () => {
  it('returns empty array when no projects in manifest', async () => {
    const result = await buildCompetitorProfilesFromRegistry({
      _loadManifest: async () => ({ projects: [], lastUpdated: '' }),
    });
    assert.deepEqual(result, []);
  });

  it('maps avgScore to competitor profiles', async () => {
    const entry: ProjectRegistryEntry = {
      name: 'myapp', path: '/myapp', lastSnapshot: '2026', avgScore: 75,
      artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '2026',
    };
    const result = await buildCompetitorProfilesFromRegistry({
      _loadManifest: async () => ({ projects: [entry], lastUpdated: '2026' }),
    });
    assert.equal(result.length, 1);
    assert.ok(result[0].name.includes('myapp'));
    assert.equal(result[0].source, 'user-defined');
  });

  it('returns empty array on manifest load error', async () => {
    const result = await buildCompetitorProfilesFromRegistry({
      _loadManifest: async () => { throw new Error('boom'); },
    });
    assert.deepEqual(result, []);
  });

  it('sets source to user-defined', async () => {
    const entry: ProjectRegistryEntry = {
      name: 'proj', path: '/proj', lastSnapshot: '2026', avgScore: 60,
      artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '2026',
    };
    const result = await buildCompetitorProfilesFromRegistry({
      _loadManifest: async () => ({ projects: [entry], lastUpdated: '' }),
    });
    assert.equal(result[0].source, 'user-defined');
  });
});
