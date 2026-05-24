import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateChangelog, formatChangelogEntry } from '../src/cli/commands/changelog.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCommits(subjects: string[]) {
  return subjects.map((s, i) => ({
    hash: `abc${i}`,
    subject: s,
    author: 'Test Author',
    date: '2026-05-18',
  }));
}

// ── formatChangelogEntry ──────────────────────────────────────────────────────

describe('formatChangelogEntry', () => {
  it('renders version heading and sections', () => {
    const entry = formatChangelogEntry('1.0.0', { Features: ['add snapshot command'] }, '2026-05-18');
    assert.ok(entry.includes('## [1.0.0]'));
    assert.ok(entry.includes('### Features'));
    assert.ok(entry.includes('- add snapshot command'));
  });

  it('omits empty sections', () => {
    const entry = formatChangelogEntry('1.0.0', { Features: [], 'Bug Fixes': ['fix crash'] }, '2026-05-18');
    assert.ok(!entry.includes('### Features'));
    assert.ok(entry.includes('### Bug Fixes'));
  });

  it('respects SECTION_ORDER (Features before Bug Fixes)', () => {
    const entry = formatChangelogEntry('1.0.0', {
      'Bug Fixes': ['fix typo'],
      Features: ['add thing'],
    }, '2026-05-18');
    assert.ok(entry.indexOf('### Features') < entry.indexOf('### Bug Fixes'));
  });
});

// ── generateChangelog ─────────────────────────────────────────────────────────

describe('generateChangelog', () => {
  it('groups feat: commits into Features', async () => {
    const result = await generateChangelog({
      dry: true,
      version: 'test-1',
      _gitLog: async () => makeCommits(['feat(core): add caching layer', 'feat: new dashboard']),
      _lastTag: async () => undefined,
      _stdout: () => {},
    });
    assert.ok(result.sections['Features']);
    assert.equal(result.sections['Features']?.length, 2);
    assert.equal(result.commitCount, 2);
  });

  it('groups fix: commits into Bug Fixes', async () => {
    const result = await generateChangelog({
      dry: true,
      version: 'test-2',
      _gitLog: async () => makeCommits(['fix(auth): null pointer on login', 'fix: crash on empty input']),
      _lastTag: async () => undefined,
      _stdout: () => {},
    });
    assert.ok(result.sections['Bug Fixes']);
    assert.equal(result.sections['Bug Fixes']?.length, 2);
  });

  it('puts non-conventional commits in Other', async () => {
    const result = await generateChangelog({
      dry: true,
      version: 'test-3',
      _gitLog: async () => makeCommits(['random commit message without type']),
      _lastTag: async () => undefined,
      _stdout: () => {},
    });
    assert.ok(result.sections['Other']);
    assert.equal(result.sections['Other']?.length, 1);
  });

  it('handles mixed commit types', async () => {
    const result = await generateChangelog({
      dry: true,
      version: 'test-4',
      _gitLog: async () => makeCommits([
        'feat: new feature',
        'fix: bug fix',
        'docs: update readme',
        'chore: bump deps',
      ]),
      _lastTag: async () => undefined,
      _stdout: () => {},
    });
    assert.ok(result.sections['Features']);
    assert.ok(result.sections['Bug Fixes']);
    assert.ok(result.sections['Documentation']);
    assert.ok(result.sections['Maintenance']);
    assert.equal(result.commitCount, 4);
  });

  it('writes to CHANGELOG.md when append is set', async () => {
    const store = new Map<string, string>();
    const changelogPath = path.join('/fake', 'CHANGELOG.md');
    store.set(changelogPath, '# Changelog\n\n## [0.5.0]\n\nOld entry\n');

    const result = await generateChangelog({
      dry: false,
      append: true,
      version: '0.6.0',
      cwd: '/fake',
      _gitLog: async () => makeCommits(['feat: new feature']),
      _lastTag: async () => undefined,
      _readFile: async (p) => { const v = store.get(p); if (!v) throw new Error('ENOENT'); return v; },
      _writeFile: async (p, d) => { store.set(p, d); },
      _exists: async (p) => store.has(p),
      _stdout: () => {},
    });

    const written = store.get(changelogPath) ?? '';
    assert.ok(written.includes('## [0.6.0]'));
    assert.ok(written.includes('new feature'));
    assert.ok(written.includes('## [0.5.0]'));
    assert.equal(result.version, '0.6.0');
  });

  it('returns zero commitCount for empty log', async () => {
    const result = await generateChangelog({
      dry: true,
      _gitLog: async () => [],
      _lastTag: async () => undefined,
      _stdout: () => {},
    });
    assert.equal(result.commitCount, 0);
    assert.equal(result.entry.trim(), `## [${new Date().toISOString().slice(0, 10)}-next] — ${new Date().toISOString().slice(0, 10)}`);
  });
});
