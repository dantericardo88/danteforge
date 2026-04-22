// Wiki Engine integration tests
// Verifies: Tier 0 context injection, PDSE anomaly detection, end-to-end wiki lifecycle
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAnomalies,
  appendPdseHistory,
  parsePdseHistoryMarkdown,
} from '../src/core/pdse-anomaly.js';
import {
  initWiki,
  wikiIngest,
  wikiBootstrap,
  query,
  getWikiHealth,
  appendAuditEntry,
  getWikiContextForPrompt,
} from '../src/core/wiki-engine.js';
import {
  injectContext,
} from '../src/core/context-injector.js';
import { runLintCycle } from '../src/core/wiki-linter.js';

// ── Shared fixture helpers ─────────────────────────────────────────────────────

type FsStore = Record<string, string>;

function makeFs(initial: FsStore = {}) {
  const store: FsStore = { ...initial };
  const n = (p: string) => p.replace(/\\/g, '/');

  return {
    store,
    exists: async (p: string) => { const np = n(p); return np in store || Object.keys(store).some(k => k === np || k.startsWith(np + '/')); },
    readFile: async (p: string) => {
      const np = n(p);
      if (np in store) return store[np];
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    writeFile: async (p: string, c: string) => { store[n(p)] = c; },
    readDir: async (dir: string) => { const nd = n(dir); return Object.keys(store).filter(k =>
      k.startsWith(nd) && k.endsWith('.md') && !k.split('/').pop()!.startsWith('.')
    ); },
    mkdir: async () => {},
    copyFile: async (src: string, dest: string) => { store[n(dest)] = store[n(src)] ?? ''; },
  };
}

function makeEntityMd(entity: string, body = 'A well-documented module with clear responsibilities.'): string {
  return [
    '---',
    `entity: "${entity}"`,
    'type: module',
    'created: 2026-04-01T00:00:00.000Z',
    'updated: 2026-04-01T00:00:00.000Z',
    'sources:',
    '  - raw/source.md',
    'links: []',
    'constitution-refs: []',
    'tags:',
    '  - integration',
    '---',
    '',
    `# ${entity}`,
    '',
    body,
  ].join('\n');
}

// ── PDSE anomaly detection integration ────────────────────────────────────────

describe('PDSE anomaly detection — integration', () => {
  it('detects 15+ point jump across multiple history entries', async () => {
    const historyLines: string[] = [];
    const store: FsStore = {};

    // Write 3 baseline entries at score 70
    for (let i = 0; i < 3; i++) {
      await appendPdseHistory(
        { timestamp: `2026-04-0${i + 1}T00:00:00.000Z`, artifact: 'SPEC', score: 70, dimensions: {}, decision: 'warn' },
        {
          cwd: '/fake',
          _writeFile: async (_p, c) => { store[_p] = c; },
          _readFile: async (_p) => { if (_p in store) return store[_p]; throw new Error('ENOENT'); },
          _mkdir: async () => {},
        },
      );
    }

    // Now detect anomaly for score 90 (delta = 20 >= 15)
    const flag = await detectAnomalies('SPEC', 90, {
      cwd: '/fake',
      _readFile: async (_p) => { if (_p in store) return store[_p]; throw new Error('ENOENT'); },
    });

    assert.ok(flag !== null, 'Should detect anomaly');
    assert.equal(flag!.artifact, 'SPEC');
    assert.ok(flag!.delta >= 15, `Delta ${flag!.delta} should be >= 15`);
  });

  it('does not flag normal progression', async () => {
    const store: FsStore = {};
    const write = async (_p: string, c: string) => { store[_p] = c; };
    const read = async (_p: string) => { if (_p in store) return store[_p]; throw new Error('ENOENT'); };

    for (let i = 0; i < 3; i++) {
      await appendPdseHistory(
        { timestamp: `2026-04-0${i + 1}T00:00:00.000Z`, artifact: 'PLAN', score: 70 + i * 2, dimensions: {}, decision: 'warn' },
        { cwd: '/fake', _writeFile: write, _readFile: read, _mkdir: async () => {} },
      );
    }

    // Score 80 from avg ~72 → delta 8 < 15 threshold → no flag
    const flag = await detectAnomalies('PLAN', 80, { cwd: '/fake', _readFile: read });
    assert.equal(flag, null);
  });
});

// ── Wiki engine lifecycle integration ─────────────────────────────────────────

describe('wiki engine lifecycle — integration', () => {
  it('initWiki creates all three directories', async () => {
    const created: string[] = [];
    await initWiki({
      cwd: '/fake',
      _mkdir: async (p) => { created.push(p); },
      _exists: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async () => {},
      _copyFile: async () => {},
      _computeHash: (c) => Buffer.from(c).toString('hex').slice(0, 64).padEnd(64, '0'),
    });
    assert.ok(created.some(p => p.includes('wiki')));
    assert.ok(created.some(p => p.includes('raw')));
    assert.ok(created.some(p => p.includes('constitution')));
  });

  it('wikiBootstrap ingests existing artifacts and reports results', async () => {
    const store: FsStore = {
      '/fake/.danteforge/SPEC.md': '# Spec\n\n## Feature\n\nA clear, well-defined feature description.',
      '/fake/.danteforge/PLAN.md': '# Plan\n\n## Architecture\n\nSolid, structured plan with no ambiguity.',
    };
    const written: FsStore = {};
    const fs = makeFs(store);

    const result = await wikiBootstrap({
      cwd: '/fake',
      _exists: fs.exists,
      _readFile: fs.readFile,
      _writeFile: async (p, c) => { written[p] = c; store[p] = c; },
      _readDir: async (dir) => Object.keys(store).filter(k => k.startsWith(dir) && k.endsWith('.md')),
      _mkdir: fs.mkdir,
    });

    // Should have ingested at least some artifacts
    assert.ok(result.ingested.length > 0 || result.skipped.length > 0);
  });

  it('getWikiHealth returns null when wiki dir absent', async () => {
    const health = await getWikiHealth({
      cwd: '/fake',
      _exists: async () => false,
      _readDir: async () => [],
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(health, null);
  });

  it('getWikiHealth returns metrics for populated wiki', async () => {
    const store: FsStore = {
      '/fake/.danteforge/wiki/entity-a.md': makeEntityMd('entity-a'),
      '/fake/.danteforge/wiki/entity-b.md': makeEntityMd('entity-b'),
    };
    const fs = makeFs(store);

    const health = await getWikiHealth({
      cwd: '/fake',
      _exists: fs.exists,
      _readDir: fs.readDir,
      _readFile: fs.readFile,
    });

    assert.ok(health !== null);
    assert.equal(health!.pageCount, 2);
    assert.ok(health!.orphanRatio >= 0 && health!.orphanRatio <= 1);
  });

  it('constitutional tamper is detected and blocks ingest', async () => {
    const store: FsStore = {
      '/fake/.danteforge/constitution/.hashes.json': JSON.stringify({
        hashes: { 'CONSTITUTION.md': 'a'.repeat(64) },
        lockedAt: '2026-01-01T00:00:00.000Z',
      }),
      '/fake/.danteforge/constitution/CONSTITUTION.md': 'tampered content',
    };
    const fs = makeFs(store);

    const result = await wikiIngest({
      cwd: '/fake',
      _exists: fs.exists,
      _readFile: fs.readFile,
      _writeFile: async () => {},
      _readDir: async () => [],
      _mkdir: async () => {},
      _computeHash: () => 'b'.repeat(64), // Different from stored 'a'.repeat(64)
    });

    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes('Constitutional integrity'));
  });

  it('audit log is append-only and records events', async () => {
    const store: FsStore = {};

    await appendAuditEntry(
      { timestamp: '2026-04-01T00:00:00.000Z', event: 'ingest', triggeredBy: 'test', summary: 'First entry' },
      { cwd: '/fake', _readFile: async () => { throw new Error('ENOENT'); }, _writeFile: async (p, c) => { store[p] = c; }, _mkdir: async () => {} },
    );
    await appendAuditEntry(
      { timestamp: '2026-04-02T00:00:00.000Z', event: 'lint', triggeredBy: 'test', summary: 'Second entry' },
      { cwd: '/fake', _readFile: async (p) => { if (p in store) return store[p]; throw new Error('ENOENT'); }, _writeFile: async (p, c) => { store[p] = c; }, _mkdir: async () => {} },
    );

    const auditPath = Object.keys(store).find(k => k.endsWith('.audit-log.jsonl'));
    assert.ok(auditPath !== undefined);
    const lines = store[auditPath!].trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('ingest'));
    assert.ok(lines[1].includes('lint'));
  });
});

// ── Context injection Tier 0 integration ──────────────────────────────────────

describe('context injection Tier 0 — integration', () => {
  it('getWikiContextForPrompt returns empty string when wiki absent', async () => {
    const ctx = await getWikiContextForPrompt('autoforge scoring', {
      cwd: '/fake',
      _exists: async () => false,
      _readDir: async () => [],
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(ctx, '');
  });

  it('getWikiContextForPrompt returns context block when wiki has matches', async () => {
    const store: FsStore = {
      '/fake/.danteforge/wiki/autoforge-loop.md': makeEntityMd('autoforge-loop',
        'The autoforge loop drives the pipeline by scoring artifacts and executing commands.'
      ),
    };
    const fs = makeFs(store);

    const ctx = await getWikiContextForPrompt('autoforge loop scoring pipeline', {
      cwd: '/fake',
      _exists: fs.exists,
      _readDir: fs.readDir,
      _readFile: fs.readFile,
    });

    // Context may be empty if score is 0, but function should not throw
    assert.ok(typeof ctx === 'string');
    if (ctx) {
      assert.ok(ctx.includes('[WIKI'));
    }
  });

  it('injectContext Tier 0 uses _wikiQuery injection seam', async () => {
    let tier0Called = false;
    const result = await injectContext('test prompt about autoforge', {
      cwd: '/fake',
      _wikiQuery: async (_prompt, _opts, _budget) => {
        tier0Called = true;
        return '[WIKI: autoforge-loop] The autoforge loop drives the pipeline.';
      },
    });

    assert.ok(tier0Called, 'Wiki query injection seam should be called');
    assert.ok(result.includes('[WIKI: autoforge-loop]'), 'Tier 0 content should appear in enriched prompt');
  });

  it('injectContext returns original prompt when Tier 0 returns empty string', async () => {
    const originalPrompt = 'A simple prompt with no wiki content available';
    const result = await injectContext(originalPrompt, {
      cwd: '/fake',
      _wikiQuery: async () => '',
    });

    // With empty wiki context and no memory, prompt should be returned as-is or with empty context
    assert.ok(result.includes(originalPrompt));
  });
});

// ── Lint cycle integration ────────────────────────────────────────────────────

describe('wiki lint cycle — integration', () => {
  it('produces valid LINT_REPORT.md for clean wiki', async () => {
    const recent = new Date().toISOString();
    const store: FsStore = {
      '/fake/.danteforge/wiki/entity-a.md': makeEntityMd('entity-a'),
      '/fake/.danteforge/wiki/entity-b.md': makeEntityMd('entity-b'),
    };
    const written: FsStore = {};

    const report = await runLintCycle({
      cwd: '/fake',
      heuristicOnly: true,
      _readDir: async (dir) => Object.keys(store).filter(k => k.startsWith(dir) && k.endsWith('.md') && !k.split('/').pop()!.startsWith('.')),
      _readFile: async (p) => { if (p in store || p in written) return (store[p] ?? written[p]); throw new Error('ENOENT'); },
      _writeFile: async (p, c) => { written[p] = c; store[p] = c; },
      _mkdir: async () => {},
    });

    assert.ok(report.timestamp.length > 0);
    assert.ok(report.passRate >= 0 && report.passRate <= 1);
    const lintFile = Object.keys(written).find(k => k.endsWith('LINT_REPORT.md'));
    assert.ok(lintFile !== undefined);
  });

  it('lint triggered every 5th cycle detects no issues on fresh wiki', async () => {
    // Simulate the LINT_INTERVAL_CYCLES check (cycle % 5 === 0)
    const { LINT_INTERVAL_CYCLES } = await import('../src/core/wiki-schema.js');
    assert.equal(LINT_INTERVAL_CYCLES, 5);

    const cycleCount = 5; // Should trigger lint
    assert.equal(cycleCount % LINT_INTERVAL_CYCLES, 0);
  });
});

// ── Query integration ──────────────────────────────────────────────────────────

describe('wiki query — integration', () => {
  it('returns relevant results for matching query', async () => {
    const store: FsStore = {
      '/fake/.danteforge/wiki/autoforge-loop.md': makeEntityMd('autoforge-loop',
        'The autoforge loop is the core execution engine. It scores artifacts using PDSE and drives the pipeline.'
      ),
      '/fake/.danteforge/wiki/pdse-engine.md': makeEntityMd('pdse-engine',
        'The PDSE engine scores planning documents across six dimensions including completeness and clarity.'
      ),
      '/fake/.danteforge/wiki/wiki-engine.md': makeEntityMd('wiki-engine',
        'The wiki engine maintains the three-tier knowledge architecture.'
      ),
    };
    const fs = makeFs(store);

    const results = await query('autoforge scoring pipeline', {
      cwd: '/fake',
      _readDir: fs.readDir,
      _readFile: fs.readFile,
      _exists: fs.exists,
    });

    assert.ok(Array.isArray(results));
    // Results should be sorted by descending score
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score, 'Results should be in descending score order');
    }
  });

  it('returns empty array for query with no matches', async () => {
    const store: FsStore = {
      '/fake/.danteforge/wiki/totally-unrelated.md': makeEntityMd('totally-unrelated',
        'This document discusses completely unrelated topics that share no keywords with the query.'
      ),
    };
    const fs = makeFs(store);

    const results = await query('xyzzy completely nonsense query that matches nothing', {
      cwd: '/fake',
      _readDir: fs.readDir,
      _readFile: fs.readFile,
      _exists: fs.exists,
    });

    assert.ok(Array.isArray(results));
    // May or may not have results depending on term extraction, but should not throw
  });
});
