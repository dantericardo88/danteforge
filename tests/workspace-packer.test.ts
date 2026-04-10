import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  packWorkspace, buildFileTree, renderPackXml, renderPackMarkdown, renderPackPlain,
  parseGitignore, matchesGitignore, inferLanguage,
  prioritizeFiles, compressFileContent, buildProjectIndex,
} from '../src/core/workspace-packer.js';
import { pack } from '../src/cli/commands/pack.js';
import type { PackResult } from '../src/core/workspace-packer.js';

// ---- Helpers ----

function makeEmptyResult(): Omit<PackResult, 'output'> {
  return {
    format: 'markdown',
    fileTree: '',
    files: [],
    totalTokens: 0,
    totalFiles: 0,
    ignoredFiles: 0,
  };
}

const mockReaddir = async (p: string, _opts: { withFileTypes: true }) => {
  if (p === '/tmp') {
    return [
      { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      { name: 'README.md', isDirectory: () => false, isFile: () => true },
    ];
  }
  return [];
};

const mockReadFile = async (_p: string) => 'export const x = 1;';
const mockStat = async (_p: string) => ({ size: 20 });
const mockExists = async (_p: string) => false; // no .gitignore

// ---- parseGitignore tests ----

describe('parseGitignore', () => {
  it('filters out comments and blank lines', () => {
    const result = parseGitignore('# comment\nnode_modules\n\ndist');
    assert.deepEqual(result, ['node_modules', 'dist']);
  });

  it('returns empty array for empty string', () => {
    const result = parseGitignore('');
    assert.deepEqual(result, []);
  });

  it('keeps negation patterns', () => {
    const result = parseGitignore('*.log\n!important.log');
    assert.deepEqual(result, ['*.log', '!important.log']);
  });
});

// ---- matchesGitignore tests ----

describe('matchesGitignore', () => {
  it('matches path containing pattern segment', () => {
    assert.equal(matchesGitignore('node_modules/foo', ['node_modules']), true);
  });

  it('does not match unrelated path', () => {
    assert.equal(matchesGitignore('src/index.ts', ['node_modules']), false);
  });

  it('matches dist directory', () => {
    assert.equal(matchesGitignore('dist/bundle.js', ['dist']), true);
  });

  it('matches .git config', () => {
    assert.equal(matchesGitignore('.git/config', ['.git']), true);
  });
});

// ---- inferLanguage tests ----

describe('inferLanguage', () => {
  it('infers typescript for .ts', () => {
    assert.equal(inferLanguage('foo.ts'), 'typescript');
  });

  it('infers python for .py', () => {
    assert.equal(inferLanguage('foo.py'), 'python');
  });

  it('returns text for unknown extension', () => {
    assert.equal(inferLanguage('foo.unknown'), 'text');
  });

  it('infers shell for .sh', () => {
    assert.equal(inferLanguage('foo.sh'), 'shell');
  });
});

// ---- buildFileTree tests ----

describe('buildFileTree', () => {
  it('contains the filename in output', () => {
    const tree = buildFileTree(['src/index.ts', 'package.json']);
    assert.ok(tree.includes('index.ts'), 'should include index.ts');
  });

  it('returns empty string for empty array', () => {
    const tree = buildFileTree([]);
    assert.equal(tree, '');
  });

  it('builds nested tree structure', () => {
    const tree = buildFileTree(['a/b/c.ts', 'a/d.ts', 'root.ts']);
    assert.ok(tree.includes('a'), 'should include directory a');
    assert.ok(tree.includes('c.ts'), 'should include c.ts');
    assert.ok(tree.includes('root.ts'), 'should include root.ts');
  });
});

// ---- renderPack tests ----

describe('renderPackMarkdown', () => {
  it('contains workspace heading', () => {
    const output = renderPackMarkdown(makeEmptyResult());
    assert.ok(output.includes('# Workspace Pack'));
  });

  it('includes file content in triple-backtick blocks', () => {
    const result: Omit<PackResult, 'output'> = {
      format: 'markdown',
      fileTree: '',
      files: [{
        relativePath: 'src/foo.ts',
        content: 'const x = 1;',
        tokens: 5,
        sizeBytes: 12,
        language: 'typescript',
      }],
      totalTokens: 5,
      totalFiles: 1,
      ignoredFiles: 0,
    };
    const output = renderPackMarkdown(result);
    assert.ok(output.includes('```typescript'));
    assert.ok(output.includes('const x = 1;'));
  });
});

describe('renderPackXml', () => {
  it('contains workspace root element', () => {
    const output = renderPackXml(makeEmptyResult());
    assert.ok(output.includes('<workspace>'));
  });
});

describe('renderPackPlain', () => {
  it('contains WORKSPACE PACK header', () => {
    const output = renderPackPlain(makeEmptyResult());
    assert.ok(output.includes('WORKSPACE PACK'));
  });
});

// ---- packWorkspace tests ----

describe('packWorkspace', () => {
  it('resolves with injected dependencies', async () => {
    const result = await packWorkspace({
      cwd: '/tmp',
      _readdir: mockReaddir,
      _readFile: mockReadFile,
      _stat: mockStat,
      _exists: mockExists,
    });
    assert.ok(result !== null && typeof result === 'object');
    assert.ok(typeof result.output === 'string');
  });

  it('skips binary file extensions and does not include them in files', async () => {
    const readdirWithBinary = async (p: string, _opts: { withFileTypes: true }) => {
      if (p === '/tmp') {
        return [
          { name: 'image.png', isDirectory: () => false, isFile: () => true },
          { name: 'index.ts', isDirectory: () => false, isFile: () => true },
        ];
      }
      return [];
    };
    const result = await packWorkspace({
      cwd: '/tmp',
      _readdir: readdirWithBinary,
      _readFile: mockReadFile,
      _stat: mockStat,
      _exists: mockExists,
    });
    const hasPng = result.files.some(f => f.relativePath.endsWith('.png'));
    assert.equal(hasPng, false, 'binary files should be excluded');
    const hasTs = result.files.some(f => f.relativePath.endsWith('index.ts'));
    assert.equal(hasTs, true, 'TypeScript files should be included');
  });

  it('returns PackResult with files array using injection', async () => {
    const result = await packWorkspace({
      cwd: '/tmp',
      _readdir: mockReaddir,
      _readFile: mockReadFile,
      _stat: mockStat,
      _exists: mockExists,
    });
    assert.ok(Array.isArray(result.files));
    assert.ok(result.files.length > 0, 'should have at least one file');
    assert.ok(typeof result.totalTokens === 'number');
    assert.ok(typeof result.totalFiles === 'number');
  });

  it('respects maxTokensPerFile and counts skipped as ignoredFiles', async () => {
    const result = await packWorkspace({
      cwd: '/tmp',
      _readdir: mockReaddir,
      _readFile: async () => 'a'.repeat(5000), // large content
      _stat: async () => ({ size: 5000 }),
      _exists: mockExists,
      maxTokensPerFile: 5,
    });
    assert.ok(result.ignoredFiles > 0, 'should have ignoredFiles when content exceeds maxTokensPerFile');
    assert.equal(result.files.length, 0, 'no files should pass the token limit');
  });
});

// ---- smart pack feature tests ----

function makeEntry(relativePath: string, content = 'content', tokens = 5): import('../src/core/workspace-packer.js').PackFileEntry {
  return { relativePath, content, tokens, sizeBytes: content.length, language: 'text' };
}

describe('prioritizeFiles', () => {
  it('sorts src/ file before docs/ file', () => {
    const files = [makeEntry('docs/guide.md'), makeEntry('src/index.ts')];
    const result = prioritizeFiles(files);
    assert.equal(result[0].relativePath, 'src/index.ts');
    assert.equal(result[1].relativePath, 'docs/guide.md');
  });

  it('sorts tests/ file before *.json config file', () => {
    const files = [makeEntry('tsconfig.json'), makeEntry('tests/foo.test.ts')];
    const result = prioritizeFiles(files);
    assert.equal(result[0].relativePath, 'tests/foo.test.ts');
    assert.equal(result[1].relativePath, 'tsconfig.json');
  });

  it('preserves relative order of files at same tier', () => {
    const files = [
      makeEntry('src/a.ts'),
      makeEntry('src/b.ts'),
      makeEntry('src/c.ts'),
    ];
    const result = prioritizeFiles(files);
    assert.equal(result[0].relativePath, 'src/a.ts');
    assert.equal(result[1].relativePath, 'src/b.ts');
    assert.equal(result[2].relativePath, 'src/c.ts');
  });
});

describe('compressFileContent', () => {
  it('compresses file above maxTokens limit and shows truncated header', () => {
    // 400 chars / 4 = 100 estimated tokens > 50 limit
    const content = 'line\n'.repeat(80);
    const entry = makeEntry('src/big.ts', content, 100);
    const result = compressFileContent(entry, 50);
    assert.ok(result.compressed === true);
    assert.ok(result.content.includes('truncated'));
  });

  it('does NOT compress file within limit', () => {
    const content = 'short content';
    const entry = makeEntry('src/small.ts', content, 3);
    const result = compressFileContent(entry, 100);
    assert.equal(result.compressed, undefined);
    assert.equal(result.content, content);
  });

  it('compressed content preserves last 50 lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const content = lines.join('\n');
    // content.length = ~700 chars → ~175 estimated tokens > 10 limit
    const entry = makeEntry('src/big.ts', content, 175);
    const result = compressFileContent(entry, 10);
    assert.ok(result.compressed === true);
    // last 50 lines: line50..line99
    assert.ok(result.content.includes('line99'));
    assert.ok(result.content.includes('line50'));
    // line0 through line49 should NOT appear in the tail
    assert.ok(!result.content.slice(result.content.indexOf('truncated')).includes('line0\n'));
  });
});

describe('buildProjectIndex', () => {
  it('output contains PROJECT INDEX header', () => {
    const result: Omit<PackResult, 'output'> = {
      ...makeEmptyResult(),
      files: [makeEntry('src/index.ts', 'export const x = 1;')],
      totalFiles: 1,
      totalTokens: 5,
    };
    const index = buildProjectIndex(result);
    assert.ok(index.includes('PROJECT INDEX'));
  });

  it('output includes file count', () => {
    const result: Omit<PackResult, 'output'> = {
      ...makeEmptyResult(),
      files: [makeEntry('src/a.ts'), makeEntry('src/b.ts')],
      totalFiles: 2,
      totalTokens: 10,
    };
    const index = buildProjectIndex(result);
    assert.ok(index.includes('Total files: 2'));
  });
});

describe('packWorkspace smart features — edge cases', () => {
  it('prioritizeFiles with empty array → returns empty array', () => {
    const result = prioritizeFiles([]);
    assert.deepEqual(result, []);
  });

  it('compressFileContent with content exactly at limit → not compressed', () => {
    // 40 chars → estimatedTokens = ceil(40/4) = 10; maxTokens = 10 → not compressed
    const content = 'a'.repeat(40);
    const entry = makeEntry('src/file.ts', content, 10);
    const result = compressFileContent(entry, 10);
    assert.equal(result.compressed, undefined, 'Expected compressed to be undefined (not compressed)');
    assert.equal(result.content, content, 'Expected original content to be preserved');
  });

  it('buildProjectIndex with no files → still contains PROJECT INDEX header', () => {
    const result: Omit<PackResult, 'output'> = {
      ...makeEmptyResult(),
      files: [],
      totalFiles: 0,
      totalTokens: 0,
    };
    const index = buildProjectIndex(result);
    assert.ok(index.includes('PROJECT INDEX'), `Expected PROJECT INDEX header, got: ${index}`);
  });

  it('prioritizeFiles: package.json is lower priority than src/index.ts', () => {
    const files = [makeEntry('package.json'), makeEntry('src/index.ts')];
    const result = prioritizeFiles(files);
    assert.equal(result[0].relativePath, 'src/index.ts', `Expected src/index.ts first, got ${result[0].relativePath}`);
    assert.equal(result[1].relativePath, 'package.json', `Expected package.json second, got ${result[1].relativePath}`);
  });

  it('compressFileContent: compressed flag is true when compressed, falsy otherwise', () => {
    // Compressed case: 400 chars → ceil(400/4)=100 tokens > 10 limit
    const bigContent = 'line content here\n'.repeat(22);  // 22 * 18 = 396 chars → 99 tokens > 10
    const bigEntry = makeEntry('src/big.ts', bigContent, 99);
    const compressed = compressFileContent(bigEntry, 10);
    assert.equal(compressed.compressed, true, 'Expected compressed=true for oversized content');

    // Not compressed case
    const smallEntry = makeEntry('src/small.ts', 'hi', 1);
    const notCompressed = compressFileContent(smallEntry, 100);
    assert.ok(!notCompressed.compressed, `Expected falsy compressed for small content, got ${notCompressed.compressed}`);
  });
});

describe('packWorkspace smart features', () => {
  it('maxTotalTokens excludes files that push over budget', async () => {
    // each file has content 'export const x = 1;' which is ~5 tokens
    // 2 files in mockReaddir, token ~5 each = ~10 total; budget = 6 → only 1 file fits
    const result = await packWorkspace({
      cwd: '/tmp',
      _readdir: mockReaddir,
      _readFile: mockReadFile,
      _stat: mockStat,
      _exists: mockExists,
      maxTotalTokens: 6,
    });
    assert.ok(result.files.length < 2, 'should exclude files over budget');
    assert.ok(result.ignoredFiles > 0, 'excluded files counted in ignoredFiles');
  });

  it('generateIndex: true output starts with index block', async () => {
    const result = await packWorkspace({
      cwd: '/tmp',
      _readdir: mockReaddir,
      _readFile: mockReadFile,
      _stat: mockStat,
      _exists: mockExists,
      generateIndex: true,
    });
    assert.ok(result.output.startsWith('=== PROJECT INDEX ==='), 'output should start with index block');
  });
});

// ---- pack command tests ----

describe('pack command', () => {
  it('calls _stdout with output', async () => {
    const lines: string[] = [];
    const mockPack = async () => ({
      format: 'markdown' as const,
      fileTree: '',
      files: [],
      totalTokens: 0,
      totalFiles: 0,
      ignoredFiles: 0,
      output: '# Workspace Pack\n',
    });

    await pack({
      _packWorkspace: mockPack,
      _stdout: (line) => lines.push(line),
    });

    assert.ok(lines.length > 0, 'should output something');
  });

  it('prints summary only when tokenCount is true', async () => {
    const lines: string[] = [];
    const mockPack = async () => ({
      format: 'markdown' as const,
      fileTree: '',
      files: [
        { relativePath: 'src/a.ts', content: 'x', tokens: 5, sizeBytes: 1, language: 'typescript' },
      ],
      totalTokens: 5,
      totalFiles: 1,
      ignoredFiles: 0,
      output: '# Workspace Pack\n',
    });

    await pack({
      tokenCount: true,
      _packWorkspace: mockPack,
      _stdout: (line) => lines.push(line),
    });

    const combined = lines.join('\n');
    assert.ok(combined.includes('Files: 1'), 'should print file count');
    assert.ok(combined.includes('Total tokens: 5'), 'should print token count');
    assert.ok(combined.includes('src/a.ts'), 'should list file path');
  });

  it('writes to file when output path is provided', async () => {
    const written: Array<{ path: string; content: string }> = [];
    const mockPack = async () => ({
      format: 'markdown' as const,
      fileTree: '',
      files: [],
      totalTokens: 0,
      totalFiles: 0,
      ignoredFiles: 0,
      output: 'packed content',
    });

    await pack({
      output: '/tmp/test.pack',
      _packWorkspace: mockPack,
      _writeFile: async (p, content) => { written.push({ path: p, content }); },
    });

    assert.equal(written.length, 1);
    assert.equal(written[0].path, '/tmp/test.pack');
    assert.equal(written[0].content, 'packed content');
  });
});
