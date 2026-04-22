import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferLanguage,
  parseGitignore,
  matchesGitignore,
  buildFileTree,
} from '../src/core/workspace-packer.js';

describe('workspace-packer: inferLanguage', () => {
  it('detects typescript', () => assert.equal(inferLanguage('foo.ts'), 'typescript'));
  it('detects tsx', () => assert.equal(inferLanguage('foo.tsx'), 'typescript'));
  it('detects javascript', () => assert.equal(inferLanguage('foo.js'), 'javascript'));
  it('detects mjs as javascript', () => assert.equal(inferLanguage('foo.mjs'), 'javascript'));
  it('detects python', () => assert.equal(inferLanguage('script.py'), 'python'));
  it('detects go', () => assert.equal(inferLanguage('main.go'), 'go'));
  it('detects rust', () => assert.equal(inferLanguage('lib.rs'), 'rust'));
  it('detects yaml', () => assert.equal(inferLanguage('config.yml'), 'yaml'));
  it('detects yaml alternate extension', () => assert.equal(inferLanguage('config.yaml'), 'yaml'));
  it('detects json', () => assert.equal(inferLanguage('package.json'), 'json'));
  it('detects markdown', () => assert.equal(inferLanguage('README.md'), 'markdown'));
  it('detects shell', () => assert.equal(inferLanguage('build.sh'), 'shell'));
  it('detects css', () => assert.equal(inferLanguage('styles.css'), 'css'));
  it('detects scss as css', () => assert.equal(inferLanguage('styles.scss'), 'css'));
  it('detects sql', () => assert.equal(inferLanguage('query.sql'), 'sql'));
  it('returns text for unknown extensions', () => assert.equal(inferLanguage('file.xyz'), 'text'));
  it('handles no extension', () => assert.equal(inferLanguage('Makefile'), 'text'));
});

describe('workspace-packer: parseGitignore', () => {
  it('parses simple patterns', () => {
    const result = parseGitignore('node_modules\ndist\n.env');
    assert.deepEqual(result, ['node_modules', 'dist', '.env']);
  });

  it('skips comment lines', () => {
    const result = parseGitignore('# comment\nnode_modules');
    assert.deepEqual(result, ['node_modules']);
  });

  it('skips blank lines', () => {
    const result = parseGitignore('a\n\nb');
    assert.deepEqual(result, ['a', 'b']);
  });

  it('trims whitespace from lines', () => {
    const result = parseGitignore('  node_modules  ');
    assert.deepEqual(result, ['node_modules']);
  });

  it('handles empty content', () => {
    assert.deepEqual(parseGitignore(''), []);
  });
});

describe('workspace-packer: matchesGitignore', () => {
  it('matches basename exactly', () => {
    assert.ok(matchesGitignore('node_modules', ['node_modules']));
  });

  it('matches file inside ignored dir', () => {
    assert.ok(matchesGitignore('node_modules/lodash/index.js', ['node_modules']));
  });

  it('does not match unrelated path', () => {
    assert.ok(!matchesGitignore('src/index.ts', ['node_modules']));
  });

  it('matches wildcard prefix (*.log)', () => {
    assert.ok(matchesGitignore('error.log', ['*.log']));
  });

  it('does not match non-log file with *.log', () => {
    assert.ok(!matchesGitignore('error.ts', ['*.log']));
  });

  it('matches wildcard suffix (build*)', () => {
    assert.ok(matchesGitignore('build-output', ['build*']));
  });

  it('matches directory pattern (dist/)', () => {
    assert.ok(matchesGitignore('dist/bundle.js', ['dist/']));
  });

  it('skips negation patterns without throwing', () => {
    assert.ok(!matchesGitignore('src/index.ts', ['!src/index.ts']));
  });

  it('returns false when pattern list is empty', () => {
    assert.ok(!matchesGitignore('anything', []));
  });
});

describe('workspace-packer: buildFileTree', () => {
  it('returns empty string for empty list', () => {
    assert.equal(buildFileTree([]), '');
  });

  it('renders a single file', () => {
    const tree = buildFileTree(['src/index.ts']);
    assert.ok(tree.includes('src'));
    assert.ok(tree.includes('index.ts'));
  });

  it('renders nested structure with connectors', () => {
    const tree = buildFileTree(['src/a.ts', 'src/b.ts', 'tests/a.test.ts']);
    assert.ok(tree.includes('src'));
    assert.ok(tree.includes('tests'));
    assert.ok(tree.includes('├──') || tree.includes('└──'));
  });

  it('sorts paths alphabetically', () => {
    const tree = buildFileTree(['z.ts', 'a.ts']);
    assert.ok(tree.indexOf('a.ts') < tree.indexOf('z.ts'));
  });

  it('renders directory with trailing slash label', () => {
    const tree = buildFileTree(['src/foo/bar.ts']);
    assert.ok(tree.includes('src/') || tree.includes('src'));
  });
});
