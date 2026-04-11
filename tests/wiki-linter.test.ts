// Tests for wiki-linter: contradiction detection, staleness, link integrity, pattern synthesis
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanContradictions,
  scanStaleness,
  scanLinkIntegrity,
  synthesizePatterns,
  runLintCycle,
} from '../src/core/wiki-linter.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeEntityPage(entity: string, sources: string[], updatedDate: string, body = ''): string {
  const sourcesYaml = sources.map(s => `  - ${s}`).join('\n');
  return [
    '---',
    `entity: "${entity}"`,
    'type: module',
    'created: 2026-01-01T00:00:00.000Z',
    `updated: ${updatedDate}`,
    `sources:`,
    sourcesYaml || '  - raw/default.md',
    'links: []',
    'constitution-refs: []',
    'tags: []',
    '---',
    '',
    `# ${entity}`,
    '',
    '## Summary',
    '',
    `Summary of ${entity}.`,
    '',
    '## Decisions',
    '',
    body || '_No decisions yet._',
    '',
    '## History',
    '',
    '### 2026-01-01T00:00:00.000Z',
    '',
    'Initial ingestion.',
  ].join('\n');
}

type FsMap = Record<string, string>;

function makeFs(files: FsMap, written?: Record<string, string>) {
  const store = { ...files };
  const out = written ?? {};
  const n = (p: string) => p.replace(/\\/g, '/');
  return {
    readDir: async (dir: string): Promise<string[]> =>
      Object.keys(store).filter(p => p.startsWith(n(dir)) && p.endsWith('.md') && !p.split('/').pop()!.startsWith('.')),
    readFile: async (p: string): Promise<string> => {
      const np = n(p);
      if (np in store) return store[np];
      throw new Error(`ENOENT: ${p}`);
    },
    writeFile: async (p: string, c: string) => { out[n(p)] = c; store[n(p)] = c; },
    mkdir: async () => {},
    written: out,
    store,
  };
}

// ── scanContradictions ────────────────────────────────────────────────────────

describe('scanContradictions', () => {
  it('returns empty array for pages with single source', async () => {
    const { readDir, readFile } = makeFs({
      'wiki/a.md': makeEntityPage('entity-a', ['raw/one.md'], '2026-04-01T00:00:00.000Z'),
    });
    const result = await scanContradictions('wiki/', readDir, readFile);
    assert.deepEqual(result, []);
  });

  it('skips index.md and LINT_REPORT.md', async () => {
    const { readDir, readFile } = makeFs({
      'wiki/index.md': '# Index\n\nContent.',
      'wiki/LINT_REPORT.md': '# Report\n\nContent.',
    });
    const result = await scanContradictions('wiki/', readDir, readFile);
    assert.deepEqual(result, []);
  });

  it('returns empty without LLM even for pages with multiple sources', async () => {
    // Without LLM caller, contradiction scanning can't determine conflicts
    const content = [
      '---',
      'entity: "multi-source"',
      'type: module',
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-04-01T00:00:00.000Z',
      'sources:',
      '  - raw/a.md',
      '  - raw/b.md',
      'links: []',
      'constitution-refs: []',
      'tags: []',
      '---',
      '',
      '## History',
      '',
      '### 2026-01-01T00:00:00.000Z',
      '',
      'Entry one with claim X.',
      '',
      '### 2026-02-01T00:00:00.000Z',
      '',
      'Entry two with contradicting claim Y.',
    ].join('\n');

    const { readDir, readFile } = makeFs({ 'wiki/multi.md': content });
    const result = await scanContradictions('wiki/', readDir, readFile);
    assert.deepEqual(result, []); // No LLM, no contradictions detected
  });

  it('uses LLM when provided and detects contradiction', async () => {
    const content = [
      '---',
      'entity: "conflicted"',
      'type: module',
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-04-01T00:00:00.000Z',
      'sources:',
      '  - raw/a.md',
      '  - raw/b.md',
      'links: []',
      'constitution-refs: []',
      'tags: []',
      '---',
      '',
      '## History',
      '',
      '### 2026-01-01T00:00:00.000Z',
      '',
      'Module uses REST API.',
      '',
      '### 2026-02-01T00:00:00.000Z',
      '',
      'Module uses GraphQL API.',
    ].join('\n');

    const { readDir, readFile } = makeFs({ 'wiki/conflicted.md': content });

    const llmCaller = async () => JSON.stringify({
      hasContradiction: true,
      claimA: 'Module uses REST API',
      claimB: 'Module uses GraphQL API',
    });

    const result = await scanContradictions('wiki/', readDir, readFile, llmCaller);
    assert.ok(result.length >= 1);
    assert.equal(result[0].entityId, 'conflicted');
    assert.ok(result[0].autoResolved); // Two sources → auto-resolved to newer
  });
});

// ── scanStaleness ─────────────────────────────────────────────────────────────

describe('scanStaleness', () => {
  it('returns empty array for recently-updated pages', async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    const { readDir, readFile } = makeFs({
      'wiki/fresh.md': makeEntityPage('fresh-entity', ['raw/a.md'], recent),
    });
    const result = await scanStaleness('wiki/', 30, readDir, readFile);
    assert.deepEqual(result, []);
  });

  it('flags pages older than threshold', async () => {
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(); // 45 days ago
    const { readDir, readFile } = makeFs({
      'wiki/stale.md': makeEntityPage('stale-entity', ['raw/a.md'], old),
    });
    const result = await scanStaleness('wiki/', 30, readDir, readFile);
    assert.equal(result.length, 1);
    assert.equal(result[0].entityId, 'stale-entity');
    assert.ok(result[0].daysSinceUpdate >= 44);
  });

  it('respects custom threshold', async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    const { readDir, readFile } = makeFs({
      'wiki/page.md': makeEntityPage('entity', ['raw/a.md'], old),
    });
    // 10 days old, threshold = 7 → should be stale
    const stale = await scanStaleness('wiki/', 7, readDir, readFile);
    assert.equal(stale.length, 1);

    // 10 days old, threshold = 30 → should be fresh
    const fresh = await scanStaleness('wiki/', 30, readDir, readFile);
    assert.equal(fresh.length, 0);
  });

  it('skips LINT_REPORT.md, pdse-history.md, and index.md', async () => {
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const lintReport = '# Lint Report\n\nGenerated: ' + old;
    const { readDir, readFile } = makeFs({
      'wiki/LINT_REPORT.md': lintReport,
      'wiki/index.md': '# Index\n\nContent.',
      'wiki/pdse-history.md': makeEntityPage('pdse-history', [], old),
    });
    const result = await scanStaleness('wiki/', 30, readDir, readFile);
    assert.deepEqual(result, []);
  });

  it('boundary: exactly threshold days is stale', async () => {
    const exactThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    const { readDir, readFile } = makeFs({
      'wiki/page.md': makeEntityPage('entity', ['raw/a.md'], exactThreshold),
    });
    const result = await scanStaleness('wiki/', 30, readDir, readFile);
    assert.equal(result.length, 1);
  });
});

// ── scanLinkIntegrity ─────────────────────────────────────────────────────────

describe('scanLinkIntegrity', () => {
  it('returns no broken links when all links resolve', async () => {
    const files: FsMap = {
      'wiki/a.md': [
        '---',
        'entity: "a"',
        'type: module',
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'sources: []',
        'links:',
        '  - b',
        'constitution-refs: []',
        'tags: []',
        '---',
        '',
        '# A',
      ].join('\n'),
      'wiki/b.md': makeEntityPage('b', [], '2026-01-01T00:00:00.000Z'),
    };
    const { readDir, readFile, writeFile, mkdir } = makeFs(files);
    const { brokenLinks } = await scanLinkIntegrity('wiki/', readDir, readFile, writeFile, mkdir);
    assert.deepEqual(brokenLinks, []);
  });

  it('creates stub page for unresolved link target', async () => {
    const files: FsMap = {
      'wiki/a.md': [
        '---',
        'entity: "a"',
        'type: module',
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'sources: []',
        'links:',
        '  - nonexistent-entity',
        'constitution-refs: []',
        'tags: []',
        '---',
        '',
        '# A',
      ].join('\n'),
    };
    const { readDir, readFile, writeFile, mkdir, written } = makeFs(files);
    const { brokenLinks } = await scanLinkIntegrity('wiki/', readDir, readFile, writeFile, mkdir);

    assert.equal(brokenLinks.length, 1);
    assert.equal(brokenLinks[0].sourceEntityId, 'a');
    assert.ok(brokenLinks[0].stubCreated);
    // Verify stub page was written
    assert.ok(Object.keys(written).some(k => k.includes('nonexistent-entity')));
  });

  it('detects broken inline [[wikilinks]] in body', async () => {
    const files: FsMap = {
      'wiki/a.md': [
        '---',
        'entity: "a"',
        'type: module',
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'sources: []',
        'links: []',
        'constitution-refs: []',
        'tags: []',
        '---',
        '',
        '# A',
        '',
        'See [[missing-entity]] for details.',
      ].join('\n'),
    };
    const { readDir, readFile, writeFile, mkdir } = makeFs(files);
    const { brokenLinks } = await scanLinkIntegrity('wiki/', readDir, readFile, writeFile, mkdir);
    assert.ok(brokenLinks.some(b => b.targetEntityId === 'missing-entity'));
  });

  it('identifies orphan pages with zero inbound links', async () => {
    const files: FsMap = {
      'wiki/a.md': makeEntityPage('a', [], '2026-01-01T00:00:00.000Z'),  // orphan
      'wiki/b.md': makeEntityPage('b', [], '2026-01-01T00:00:00.000Z'),  // orphan
    };
    const { readDir, readFile, writeFile, mkdir } = makeFs(files);
    const { orphanPages } = await scanLinkIntegrity('wiki/', readDir, readFile, writeFile, mkdir);
    assert.ok(orphanPages.includes('a'));
    assert.ok(orphanPages.includes('b'));
  });
});

// ── synthesizePatterns ─────────────────────────────────────────────────────────

describe('synthesizePatterns', () => {
  it('returns empty array without LLM caller', async () => {
    const { readDir, readFile } = makeFs({ 'wiki/a.md': makeEntityPage('a', [], '2026-01-01T00:00:00.000Z') });
    const result = await synthesizePatterns('wiki/', readDir, readFile);
    assert.deepEqual(result, []);
  });

  it('returns empty array when fewer than 3 entities with decisions', async () => {
    const { readDir, readFile } = makeFs({
      'wiki/a.md': makeEntityPage('a', [], '2026-01-01T00:00:00.000Z', 'Use dependency injection.'),
    });
    const llm = async () => '[]';
    const result = await synthesizePatterns('wiki/', readDir, readFile, llm);
    assert.deepEqual(result, []);
  });

  it('calls LLM and parses pattern suggestions', async () => {
    const decision = 'Use injection seams for testability instead of direct imports.';
    const files: FsMap = {
      'wiki/a.md': makeEntityPage('a', [], '2026-01-01T00:00:00.000Z', decision),
      'wiki/b.md': makeEntityPage('b', [], '2026-01-01T00:00:00.000Z', decision),
      'wiki/c.md': makeEntityPage('c', [], '2026-01-01T00:00:00.000Z', decision),
    };
    const { readDir, readFile } = makeFs(files);

    const suggestions = [
      { suggestedEntity: 'injection-seam-pattern', rationale: 'Used in A, B, C', sourceEntities: ['a', 'b', 'c'] },
    ];
    const llm = async () => JSON.stringify(suggestions);

    const result = await synthesizePatterns('wiki/', readDir, readFile, llm);
    assert.equal(result.length, 1);
    assert.equal(result[0].suggestedEntity, 'injection-seam-pattern');
  });
});

// ── runLintCycle ──────────────────────────────────────────────────────────────

describe('runLintCycle', () => {
  it('produces LINT_REPORT.md with pass rate', async () => {
    const recent = new Date().toISOString();
    const files: FsMap = {
      '/fake/.danteforge/wiki/a.md': makeEntityPage('entity-a', ['raw/a.md'], recent),
      '/fake/.danteforge/wiki/b.md': makeEntityPage('entity-b', ['raw/b.md'], recent),
    };
    const written: Record<string, string> = {};
    const { readDir, readFile } = makeFs(files);

    await runLintCycle({
      cwd: '/fake',
      heuristicOnly: true,
      _readDir: readDir,
      _readFile: readFile,
      _writeFile: async (p, c) => { written[p] = c; files[p] = c; },
      _mkdir: async () => {},
    });

    const lintReport = Object.entries(written).find(([k]) => k.endsWith('LINT_REPORT.md'));
    assert.ok(lintReport !== undefined, 'LINT_REPORT.md should be written');
    assert.ok(lintReport![1].includes('Pass rate:'));
    assert.ok(lintReport![1].includes('Wiki Lint Report'));
  });

  it('reports zero issues for clean wiki', async () => {
    const recent = new Date().toISOString();
    const files: FsMap = {
      '/fake/.danteforge/wiki/a.md': makeEntityPage('a', ['raw/a.md'], recent),
    };
    const written: Record<string, string> = {};
    const { readDir, readFile } = makeFs(files);

    const report = await runLintCycle({
      cwd: '/fake',
      heuristicOnly: true,
      _readDir: readDir,
      _readFile: readFile,
      _writeFile: async (p, c) => { written[p] = c; files[p] = c; },
      _mkdir: async () => {},
    });

    assert.equal(report.totalIssues, 0);
    assert.equal(report.passRate, 1);
  });

  it('reports stale pages', async () => {
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const files: FsMap = {
      '/fake/.danteforge/wiki/stale.md': makeEntityPage('stale', ['raw/a.md'], old),
    };
    const { readDir, readFile } = makeFs(files);

    const report = await runLintCycle({
      cwd: '/fake',
      heuristicOnly: true,
      stalenessThresholdDays: 30,
      _readDir: readDir,
      _readFile: readFile,
      _writeFile: async () => {},
      _mkdir: async () => {},
    });

    assert.equal(report.stalePages.length, 1);
    assert.equal(report.stalePages[0].entityId, 'stale');
  });

  it('skips LLM passes when heuristicOnly=true', async () => {
    let llmCalled = false;
    const recent = new Date().toISOString();
    const files: FsMap = {
      '/fake/.danteforge/wiki/a.md': makeEntityPage('a', ['raw/a.md', 'raw/b.md'], recent),
    };
    const { readDir, readFile } = makeFs(files);

    await runLintCycle({
      cwd: '/fake',
      heuristicOnly: true,
      _llmCaller: async () => { llmCalled = true; return '{}'; },
      _readDir: readDir,
      _readFile: readFile,
      _writeFile: async () => {},
      _mkdir: async () => {},
    });

    assert.ok(!llmCalled, 'LLM should not be called in heuristicOnly mode');
  });

  it('appends audit entry after lint cycle', async () => {
    const recent = new Date().toISOString();
    const files: FsMap = {
      '/fake/.danteforge/wiki/a.md': makeEntityPage('a', ['raw/a.md'], recent),
    };
    const written: Record<string, string> = {};
    const { readDir, readFile } = makeFs(files, written);

    await runLintCycle({
      cwd: '/fake',
      heuristicOnly: true,
      _readDir: readDir,
      _readFile: async (p) => {
        if (p in files) return files[p];
        if (p in written) return written[p];
        throw new Error('ENOENT');
      },
      _writeFile: async (p, c) => { written[p] = c; files[p] = c; },
      _mkdir: async () => {},
    });

    const auditLog = Object.entries(written).find(([k]) => k.endsWith('.audit-log.jsonl'));
    assert.ok(auditLog !== undefined, 'Audit log should be written');
    const entry = JSON.parse(auditLog![1].trim());
    assert.equal(entry.event, 'lint');
  });
});
