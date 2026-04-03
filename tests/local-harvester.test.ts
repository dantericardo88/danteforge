import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

describe('detectSourceType', () => {
  async function makeFsOps(overrides: {
    isDir?: boolean;
    hasGit?: boolean;
    statThrows?: boolean;
  } = {}) {
    return {
      readFile: async (_targetPath: string, _encoding: string) => '',
      readdir: async (_targetPath: string) => [] as string[],
      stat: async (_targetPath: string) => {
        if (overrides.statThrows) throw new Error('ENOENT');
        return { isDirectory: () => overrides.isDir ?? true, size: 100 };
      },
      exists: async (targetPath: string) => {
        if (overrides.hasGit) return targetPath.endsWith('.git');
        return false;
      },
    };
  }

  it('detects .zip extension as zip', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps();
    assert.strictEqual(await detectSourceType('/path/to/project.zip', fsOps), 'zip');
  });

  it('detects directory with .git as git-repo', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps({ isDir: true, hasGit: true });
    assert.strictEqual(await detectSourceType('/path/to/repo', fsOps), 'git-repo');
  });

  it('falls back to folder when stat throws', async () => {
    const { detectSourceType } = await import('../src/core/local-harvester.js');
    const fsOps = await makeFsOps({ statThrows: true });
    assert.strictEqual(await detectSourceType('/missing/path', fsOps), 'folder');
  });
});

describe('readPlanningDocs', () => {
  function makeFsOps(files: Record<string, string>) {
    return {
      readFile: async (targetPath: string, _encoding: string) => {
        const name = path.basename(targetPath);
        if (name in files) return files[name]!;
        throw new Error('ENOENT');
      },
      readdir: async (_targetPath: string) => Object.keys(files),
      stat: async (_targetPath: string) => ({ isDirectory: () => false, size: 100 }),
      exists: async (_targetPath: string) => false,
    };
  }

  it('reads docs in priority order', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    const docs = await readPlanningDocs('/project', makeFsOps({
      'README.md': 'readme',
      'SPEC.md': 'spec',
      'PLAN.md': 'plan',
    }), 10000);
    const names = docs.map((doc) => doc.name);
    assert.ok(names.indexOf('SPEC.md') < names.indexOf('README.md'));
  });

  it('truncates long documents', async () => {
    const { readPlanningDocs } = await import('../src/core/local-harvester.js');
    const docs = await readPlanningDocs('/project', makeFsOps({
      'SPEC.md': 'x'.repeat(5000),
    }), 10000);
    assert.ok(docs[0]!.content.includes('[truncated]'));
  });
});

function fsOps(files: Record<string, string>) {
  return {
    readFile: async (targetPath: string, _encoding: string) => {
      const basename = path.basename(targetPath);
      if (basename in files) return files[basename]!;
      if (targetPath in files) return files[targetPath]!;
      throw new Error('ENOENT');
    },
    readdir: async (_targetPath: string) => Object.keys(files),
    stat: async (_targetPath: string) => ({ isDirectory: () => false, size: 100 }),
    exists: async (_targetPath: string) => false,
  };
}

describe('readCodeInsights', () => {
  it('returns empty array for shallow depth', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    const result = await readCodeInsights('/project', fsOps({}), 'shallow', 6000);
    assert.deepStrictEqual(result, []);
  });

  it('reads manifest and entry point', async () => {
    const { readCodeInsights } = await import('../src/core/local-harvester.js');
    const result = await readCodeInsights('/project', fsOps({
      'package.json': '{"name":"test"}',
      'index.ts': 'export function main() {}',
    }), 'medium', 6000);
    assert.ok(result.some((entry) => entry.file === 'package.json'));
    assert.ok(result.some((entry) => entry.file === 'src/index.ts'));
  });
});

describe('extractLocalPatterns', () => {
  it('parses PATTERN lines from LLM response', async () => {
    const { extractLocalPatterns } = await import('../src/core/local-harvester.js');
    const llm = async (_prompt: string) =>
      'PATTERN|architecture|Event Sourcing|Store all changes as events|P0\nPATTERN|api|REST Gateway|Single entry point|P1';
    const patterns = await extractLocalPatterns([{ name: 'SPEC.md', content: 'spec' }], [], llm);
    assert.strictEqual(patterns.length, 2);
    assert.strictEqual(patterns[0]!.name, 'Event Sourcing');
  });
});

describe('synthesizeHarvest', () => {
  function makeResult(patterns: { category: string; name: string; description: string; priority: 'P0' | 'P1' | 'P2' }[]) {
    return {
      source: { path: '/project', depth: 'medium' as const },
      resolvedType: 'folder' as const,
      planningDocs: [],
      codeInsights: [],
      patterns,
      tokensUsed: 100,
    };
  }

  it('parses synthesis and query lines', async () => {
    const { synthesizeHarvest } = await import('../src/core/local-harvester.js');
    const result = await synthesizeHarvest(
      [makeResult([{ category: 'arch', name: 'Event Sourcing', description: 'Store events', priority: 'P0' }])],
      async (_prompt: string) =>
        'SYNTHESIS: Shared event-driven architecture.\nQUERY: event sourcing typescript\nQUERY: cqrs node.js',
    );
    assert.ok(result.synthesis.includes('event-driven'));
    assert.strictEqual(result.recommendedOssQueries.length, 2);
  });
});

describe('buildLocalHarvestMarkdown', () => {
  it('includes synthesis and queries', async () => {
    const { buildLocalHarvestMarkdown } = await import('../src/core/local-harvester.js');
    const markdown = buildLocalHarvestMarkdown({
      sources: [],
      synthesis: 'Great ideas from old projects',
      topPatterns: [],
      recommendedOssQueries: ['query one'],
      generatedAt: '2026-03-25T00:00:00.000Z',
    });
    assert.ok(markdown.includes('# Local Harvest Report'));
    assert.ok(markdown.includes('Great ideas from old projects'));
    assert.ok(markdown.includes('query one'));
  });
});

describe('harvestLocalSources', () => {
  it('continues when a source errors', async () => {
    const { harvestLocalSources } = await import('../src/core/local-harvester.js');
    const report = await harvestLocalSources(
      [{ path: '/bad/archive.zip', depth: 'medium' }],
      {
        _extractZip: async () => {
          throw new Error('Zip extraction failed');
        },
        _llmCaller: async () => 'SYNTHESIS: fallback\nQUERY: test',
      },
    );
    assert.strictEqual(report.sources.length, 1);
    assert.ok(report.sources[0]!.error);
  });
});
