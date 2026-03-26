import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// ── detectSourceType ─────────────────────────────────────────────────────────

describe('detectSourceType', () => {
  async function makeFsOps(overrides: {
    isDir?: boolean;
    hasGit?: boolean;
    statThrows?: boolean;
  } = {}) {
    return {
      readFile: async (_p: string, _enc: string) => '',
      readdir: async (_p: string) => [] as string[],
      stat: async (_p: string) => {
        if (overrides.statThrows) throw new Error('ENOENT');
        return { isDirectory: () => overrides.isDir ?? true, size: 100 };
      },
      exists: async (p: string) => {
        if (overrides.hasGit) return p.endsWith('.git');
        return false;
      },
    };
  }

  it('detects .zip extension as zip', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps();
    assert.strictEqual(await detectSourceType('/path/to/project.zip', fsOps), 'zip');
  });

  it('detects .tar.gz extension as zip', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps();
    assert.strictEqual(await detectSourceType('/path/to/archive.tar.gz', fsOps), 'zip');
  });

  it('detects .tgz extension as zip', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps();
    assert.strictEqual(await detectSourceType('/path/to/archive.tgz', fsOps), 'zip');
  });

  it('detects directory without .git as folder', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps({ isDir: true, hasGit: false });
    assert.strictEqual(await detectSourceType('/path/to/project', fsOps), 'folder');
  });

  it('detects directory with .git as git-repo', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps({ isDir: true, hasGit: true });
    assert.strictEqual(await detectSourceType('/path/to/repo', fsOps), 'git-repo');
  });

  it('falls back to folder when stat throws', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps({ statThrows: true });
    assert.strictEqual(await detectSourceType('/nonexistent/path', fsOps), 'folder');
  });
});

// ── readPlanningDocs ─────────────────────────────────────────────────────────

describe('readPlanningDocs', () => {
  function makeFsOps(files: Record<string, string>) {
    return {
      readFile: async (p: string, _enc: string) => {
        const name = path.basename(p);
        if (name in files) return files[name]!;
        throw new Error('ENOENT');
      },
      readdir: async (_p: string) => Object.keys(files),
      stat: async (_p: string) => ({ isDirectory: () => false, size: 100 }),
      exists: async (_p: string) => false,
    };
  }

  it('reads docs in priority order', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    const fsOps = makeFsOps({
      'README.md': 'readme content',
      'SPEC.md': 'spec content',
      'PLAN.md': 'plan content',
    });
    const docs = await readPlanningDocs('/project', fsOps, 10000);
    // SPEC should come before README (higher priority)
    const names = docs.map(d => d.name);
    assert.ok(names.indexOf('SPEC.md') < names.indexOf('README.md'));
  });

  it('skips files that do not exist', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    const fsOps = makeFsOps({ 'README.md': 'only this exists' });
    const docs = await readPlanningDocs('/project', fsOps, 10000);
    assert.strictEqual(docs.length, 1);
    assert.strictEqual(docs[0]!.name, 'README.md');
  });

  it('truncates long documents with truncation marker', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    const longContent = 'x'.repeat(5000);
    const fsOps = makeFsOps({ 'SPEC.md': longContent });
    const docs = await readPlanningDocs('/project', fsOps, 10000);
    assert.ok(docs[0]!.content.includes('[truncated]'), 'should include truncation marker');
    assert.ok(docs[0]!.content.length < longContent.length, 'should be shorter than original');
  });

  it('stops reading when token budget is reached', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    // Create many large docs — budget should stop after first few
    const files: Record<string, string> = {};
    for (const name of ['SPEC.md', 'PLAN.md', 'README.md', 'CONSTITUTION.md']) {
      files[name] = 'word '.repeat(500); // ~600 tokens
    }
    const docs = await readPlanningDocs('/project', fsOps(files), 500);
    assert.ok(docs.length < 4, 'should stop before reading all docs');
  });

  it('returns empty array when no planning docs found', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    const fsOps = makeFsOps({});
    const docs = await readPlanningDocs('/project', fsOps, 10000);
    assert.deepStrictEqual(docs, []);
  });
});

function fsOps(files: Record<string, string>) {
  return {
    readFile: async (p: string, _enc: string) => {
      const name = path.basename(p);
      if (name in files) return files[name]!;
      throw new Error('ENOENT');
    },
    readdir: async (_p: string) => Object.keys(files),
    stat: async (_p: string) => ({ isDirectory: () => false, size: 100 }),
    exists: async (_p: string) => false,
  };
}

// ── readCodeInsights ─────────────────────────────────────────────────────────

describe('readCodeInsights', () => {
  it('returns empty array for shallow depth', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    const result = await readCodeInsights('/project', fsOps({}), 'shallow', 6000);
    assert.deepStrictEqual(result, []);
  });

  it('reads manifest for medium depth', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    const ops = fsOps({ 'package.json': '{"name":"test"}' });
    const result = await readCodeInsights('/project', ops, 'medium', 6000);
    assert.ok(result.some(r => r.file === 'package.json'), 'should read package.json');
  });

  it('reads entry point for medium depth', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    // fsOps helper uses path.basename(p) as key; 'src/index.ts' candidate resolves basename 'index.ts'
    const ops = fsOps({
      'package.json': '{"name":"test"}',
      'index.ts': 'export function main() {}',
    });
    const result = await readCodeInsights('/project', ops, 'medium', 6000);
    assert.ok(result.some(r => r.file === 'src/index.ts'), 'should read entry point');
  });

  it('reads multiple entry points for full depth', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    const ops = fsOps({
      'package.json': '{"name":"test"}',
      'src/index.ts': 'entry',
      'index.ts': 'root entry',
    });
    const result = await readCodeInsights('/project', ops, 'full', 6000);
    // full depth reads up to 4 entry points
    assert.ok(result.length >= 2, 'full depth should read more files');
  });

  it('truncates long snippets', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    const ops = fsOps({ 'package.json': 'x'.repeat(3000) });
    const result = await readCodeInsights('/project', ops, 'medium', 6000);
    assert.ok(result[0]!.snippet.includes('[truncated]'), 'should truncate long content');
  });
});

// ── extractLocalPatterns ─────────────────────────────────────────────────────

describe('extractLocalPatterns', () => {
  it('parses PATTERN lines from LLM response', async () => {
    const { extractLocalPatterns } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string) =>
      'PATTERN|architecture|Event Sourcing|Store all changes as events|P0\nPATTERN|api|REST Gateway|Single entry point for all APIs|P1';
    const docs = [{ name: 'SPEC.md', content: 'spec content' }];
    const patterns = await extractLocalPatterns(docs, [], llm);
    assert.strictEqual(patterns.length, 2);
    assert.strictEqual(patterns[0]!.name, 'Event Sourcing');
    assert.strictEqual(patterns[0]!.priority, 'P0');
    assert.strictEqual(patterns[1]!.priority, 'P1');
  });

  it('returns empty array when no docs or code insights provided', async () => {
    const { extractLocalPatterns } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string) => { throw new Error('should not be called'); };
    const patterns = await extractLocalPatterns([], [], llm);
    assert.deepStrictEqual(patterns, []);
  });

  it('returns empty array when LLM throws', async () => {
    const { extractLocalPatterns } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string): Promise<string> => { throw new Error('LLM error'); };
    const docs = [{ name: 'README.md', content: 'hello' }];
    const patterns = await extractLocalPatterns(docs, [], llm);
    assert.deepStrictEqual(patterns, []);
  });

  it('ignores malformed lines in LLM response', async () => {
    const { extractLocalPatterns } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string) =>
      'This is not a pattern line\nPATTERN|arch|Good Pattern|Valid pattern|P0\nAnother bad line';
    const docs = [{ name: 'SPEC.md', content: 'x' }];
    const patterns = await extractLocalPatterns(docs, [], llm);
    assert.strictEqual(patterns.length, 1);
    assert.strictEqual(patterns[0]!.name, 'Good Pattern');
  });
});

// ── synthesizeHarvest ────────────────────────────────────────────────────────

describe('synthesizeHarvest', () => {
  function makeResult(patterns: { category: string; name: string; description: string; priority: 'P0'|'P1'|'P2' }[]) {
    return {
      source: { path: '/project', depth: 'medium' as const },
      resolvedType: 'folder' as const,
      planningDocs: [],
      codeInsights: [],
      patterns,
      tokensUsed: 100,
    };
  }

  it('returns no-patterns message when all sources have no patterns', async () => {
    const { synthesizeHarvest } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string): Promise<string> => { throw new Error('should not be called'); };
    const result = await synthesizeHarvest([makeResult([])], llm);
    assert.ok(result.synthesis.includes('No patterns'), 'should note no patterns');
    assert.deepStrictEqual(result.recommendedOssQueries, []);
  });

  it('parses SYNTHESIS and QUERY lines from LLM response', async () => {
    const { synthesizeHarvest } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string) =>
      'SYNTHESIS: These projects share a focus on event-driven architecture.\nQUERY: event sourcing typescript\nQUERY: cqrs node.js framework';
    const result = makeResult([{ category: 'arch', name: 'Event Sourcing', description: 'Store events', priority: 'P0' }]);
    const synthesis = await synthesizeHarvest([result], llm);
    assert.ok(synthesis.synthesis.includes('event-driven'), 'should parse synthesis text');
    assert.strictEqual(synthesis.recommendedOssQueries.length, 2);
    assert.ok(synthesis.recommendedOssQueries[0]!.includes('event sourcing'));
  });

  it('falls back gracefully when LLM throws', async () => {
    const { synthesizeHarvest } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string): Promise<string> => { throw new Error('LLM unavailable'); };
    const result = makeResult([{ category: 'arch', name: 'My Pattern', description: 'desc', priority: 'P0' }]);
    const synthesis = await synthesizeHarvest([result], llm);
    assert.ok(synthesis.synthesis.length > 0, 'should have fallback synthesis');
    assert.deepStrictEqual(synthesis.recommendedOssQueries, []);
  });
});

// ── buildLocalHarvestMarkdown ────────────────────────────────────────────────

describe('buildLocalHarvestMarkdown', () => {
  it('includes synthesis section', async () => {
    const { buildLocalHarvestMarkdown } = await import('../src/core/local-harvester.js');
    const report = {
      sources: [],
      synthesis: 'Great ideas from old projects',
      topPatterns: [],
      recommendedOssQueries: ['query one'],
      generatedAt: '2026-03-25T00:00:00.000Z',
    };
    const md = buildLocalHarvestMarkdown(report);
    assert.ok(md.includes('# Local Harvest Report'), 'should have title');
    assert.ok(md.includes('Great ideas from old projects'), 'should include synthesis');
    assert.ok(md.includes('query one'), 'should include OSS queries');
  });

  it('marks errored sources', async () => {
    const { buildLocalHarvestMarkdown } = await import('../src/core/local-harvester.js');
    const report = {
      sources: [{
        source: { path: '/bad/path', depth: 'medium' as const },
        resolvedType: 'folder' as const,
        planningDocs: [],
        codeInsights: [],
        patterns: [],
        tokensUsed: 0,
        error: 'ENOENT: no such file',
      }],
      synthesis: 'Partial',
      topPatterns: [],
      recommendedOssQueries: [],
      generatedAt: '2026-03-25T00:00:00.000Z',
    };
    const md = buildLocalHarvestMarkdown(report);
    assert.ok(md.includes('Error:'), 'should show error for failed sources');
    assert.ok(md.includes('ENOENT'), 'should include error message');
  });
});

// ── harvestLocalSources integration ─────────────────────────────────────────

describe('harvestLocalSources', () => {
  it('continues when a source errors, collects error in result', async () => {
    const { harvestLocalSources } = await import('../src/core/local-harvester.js');
    // Use a .zip path so detectSourceType returns 'zip', then make _extractZip throw.
    // This causes an uncaught error inside the per-source try block, setting result.error.
    const sources = [
      { path: '/bad/archive.zip', depth: 'medium' as const },
    ];
    const report = await harvestLocalSources(sources, {
      _extractZip: async (_zipPath: string, _destDir: string): Promise<void> => {
        throw new Error('Zip extraction failed');
      },
      _llmCaller: async () => 'SYNTHESIS: fallback\nQUERY: test',
    });
    assert.strictEqual(report.sources.length, 1);
    assert.ok(report.sources[0]!.error, 'should record error on failed source');
  });

  it('extracts patterns from successful sources', async () => {
    const { harvestLocalSources } = await import('../src/core/local-harvester.js');
    const ops = {
      readFile: async (p: string, _enc: string) => {
        if (path.basename(p) === 'SPEC.md') return 'A spec about event sourcing';
        throw new Error('ENOENT');
      },
      readdir: async (_p: string) => ['SPEC.md'],
      stat: async (_p: string) => ({ isDirectory: () => true, size: 100 }),
      exists: async (_p: string) => false,
    };
    let llmCallCount = 0;
    const report = await harvestLocalSources(
      [{ path: '/project', depth: 'shallow' }],
      {
        _fsOps: ops,
        _llmCaller: async (_prompt: string) => {
          llmCallCount++;
          if (llmCallCount === 1) {
            return 'PATTERN|architecture|Event Sourcing|Store all state changes as events|P0';
          }
          return 'SYNTHESIS: Event sourcing focus\nQUERY: event sourcing typescript';
        },
      },
    );
    assert.strictEqual(report.topPatterns.length, 1);
    assert.strictEqual(report.topPatterns[0]!.name, 'Event Sourcing');
    assert.ok(report.recommendedOssQueries.length > 0);
  });
});
