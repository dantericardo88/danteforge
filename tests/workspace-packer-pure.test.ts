import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferLanguage,
  parseGitignore,
  matchesGitignore,
  buildFileTree,
  prioritizeFiles,
  compressFileContent,
} from '../src/core/workspace-packer.js';
import type { PackFileEntry } from '../src/core/workspace-packer.js';

function makeEntry(overrides: Partial<PackFileEntry> = {}): PackFileEntry {
  return {
    relativePath: 'src/index.ts',
    content: 'export const x = 1;',
    tokens: 10,
    sizeBytes: 20,
    language: 'typescript',
    ...overrides,
  };
}

describe('inferLanguage', () => {
  it('returns typescript for .ts files', () => {
    assert.equal(inferLanguage('src/index.ts'), 'typescript');
  });

  it('returns typescript for .tsx files', () => {
    assert.equal(inferLanguage('src/App.tsx'), 'typescript');
  });

  it('returns javascript for .js files', () => {
    assert.equal(inferLanguage('dist/index.js'), 'javascript');
  });

  it('returns python for .py files', () => {
    assert.equal(inferLanguage('script.py'), 'python');
  });

  it('returns markdown for .md files', () => {
    assert.equal(inferLanguage('README.md'), 'markdown');
  });

  it('returns json for .json files', () => {
    assert.equal(inferLanguage('package.json'), 'json');
  });

  it('returns text for unknown extensions', () => {
    assert.equal(inferLanguage('file.xyz'), 'text');
  });
});

describe('parseGitignore', () => {
  it('splits by newline', () => {
    const result = parseGitignore('node_modules\ndist\n');
    assert.ok(result.includes('node_modules'));
    assert.ok(result.includes('dist'));
  });

  it('strips comment lines', () => {
    const result = parseGitignore('# this is a comment\nnode_modules');
    assert.ok(!result.includes('# this is a comment'));
    assert.ok(result.includes('node_modules'));
  });

  it('trims whitespace from lines', () => {
    const result = parseGitignore('  dist  \n  .env  ');
    assert.ok(result.includes('dist'));
    assert.ok(result.includes('.env'));
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseGitignore(''), []);
  });
});

describe('matchesGitignore', () => {
  it('matches exact filename', () => {
    assert.ok(matchesGitignore('dist', ['dist']));
  });

  it('matches wildcard extension', () => {
    assert.ok(matchesGitignore('file.log', ['*.log']));
  });

  it('does not match unrelated file', () => {
    assert.ok(!matchesGitignore('src/index.ts', ['dist']));
  });

  it('matches directory pattern', () => {
    assert.ok(matchesGitignore('node_modules/lodash', ['node_modules/']));
  });

  it('skips negation patterns', () => {
    assert.ok(!matchesGitignore('src/keep.ts', ['!src/keep.ts']));
  });

  it('returns false for empty patterns', () => {
    assert.ok(!matchesGitignore('dist/index.js', []));
  });
});

describe('buildFileTree', () => {
  it('returns empty string for empty array', () => {
    assert.equal(buildFileTree([]), '');
  });

  it('renders single file', () => {
    const tree = buildFileTree(['index.ts']);
    assert.ok(tree.includes('index.ts'));
  });

  it('renders nested structure', () => {
    const tree = buildFileTree(['src/index.ts', 'src/utils/helper.ts']);
    assert.ok(tree.includes('src'));
    assert.ok(tree.includes('index.ts'));
    assert.ok(tree.includes('helper.ts'));
  });

  it('sorts paths alphabetically', () => {
    const tree = buildFileTree(['z.ts', 'a.ts']);
    const aPos = tree.indexOf('a.ts');
    const zPos = tree.indexOf('z.ts');
    assert.ok(aPos < zPos);
  });
});

describe('prioritizeFiles', () => {
  it('returns same count of files', () => {
    const files = [
      makeEntry({ relativePath: 'a.ts' }),
      makeEntry({ relativePath: 'b.ts' }),
    ];
    assert.equal(prioritizeFiles(files).length, 2);
  });

  it('does not mutate original array', () => {
    const files = [makeEntry({ relativePath: 'a.ts' })];
    prioritizeFiles(files);
    assert.equal(files[0].relativePath, 'a.ts');
  });
});

describe('compressFileContent', () => {
  it('returns entry unchanged when tokens under max', () => {
    const entry = makeEntry({ tokens: 5, content: 'hello' });
    const result = compressFileContent(entry, 100);
    assert.equal(result.content, 'hello');
  });

  it('marks compressed true when tokens exceed max', () => {
    const longContent = 'x '.repeat(500);
    const entry = makeEntry({ tokens: 500, content: longContent });
    const result = compressFileContent(entry, 10);
    assert.ok(result.compressed);
  });

  it('reduces token count when compressing', () => {
    const longContent = 'x '.repeat(500);
    const entry = makeEntry({ tokens: 500, content: longContent });
    const result = compressFileContent(entry, 10);
    assert.ok(result.tokens <= 500);
  });
});
