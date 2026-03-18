// OSS Researcher unit tests — pure function tests only, no DanteForge runtime dependencies
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyLicense,
  buildSearchQueries,
  prioritizePatterns,
  formatOSSReport,
  ALLOWED_LICENSES,
  BLOCKED_LICENSES,
  type PatternExtraction,
  type OSSResearchReport,
} from '../src/core/oss-researcher.js';

// ── classifyLicense ───────────────────────────────────────────────────────────

describe('classifyLicense', () => {
  it('identifies MIT license as allowed', () => {
    const text = 'MIT License\n\nCopyright (c) 2024 Example Author\n\nPermission is hereby granted...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'MIT');
  });

  it('identifies MIT SPDX identifier as allowed', () => {
    const result = classifyLicense('SPDX-License-Identifier: MIT');
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'MIT');
  });

  it('identifies Apache-2.0 as allowed', () => {
    const text = 'Apache License\n\nVersion 2.0, January 2004';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'Apache-2.0');
  });

  it('identifies BSD-3-Clause as allowed', () => {
    const text = 'BSD 3-Clause License\n\nCopyright ...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'BSD-3-Clause');
  });

  it('identifies BSD-2-Clause as allowed', () => {
    const text = 'BSD 2-Clause License\n\nCopyright ...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'BSD-2-Clause');
  });

  it('identifies ISC license as allowed', () => {
    const text = 'ISC License\n\nCopyright (c) 2024 ...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'ISC');
  });

  it('identifies Unlicense as allowed', () => {
    const text = 'The Unlicense\n\nThis is free and unencumbered software...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'Unlicense');
  });

  it('identifies MPL-2.0 as allowed', () => {
    const text = 'Mozilla Public License 2.0\n\nThis Source Code Form...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'allowed');
    assert.strictEqual(result.name, 'MPL-2.0');
  });

  it('blocks GPL-3.0', () => {
    const text = 'GNU GENERAL PUBLIC LICENSE\n\nVersion 3, 29 June 2007\n\nCopyright (C) 2007 Free Software Foundation...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'blocked');
    assert.strictEqual(result.name, 'GPL-3.0');
  });

  it('blocks GPL-2.0', () => {
    const text = 'GNU GENERAL PUBLIC LICENSE\n\nVersion 2, June 1991\n\nCopyright (C) 1989, 1991 Free Software Foundation...';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'blocked');
  });

  it('blocks AGPL-3.0', () => {
    const text = 'GNU AFFERO GENERAL PUBLIC LICENSE\n\nVersion 3, 19 November 2007';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'blocked');
    assert.strictEqual(result.name, 'AGPL-3.0');
  });

  it('blocks SSPL-1.0', () => {
    const text = 'Server Side Public License, version 1';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'blocked');
    assert.strictEqual(result.name, 'SSPL-1.0');
  });

  it('returns unknown for unrecognized license text', () => {
    const text = 'This is a proprietary license. All rights reserved.';
    const result = classifyLicense(text);
    assert.strictEqual(result.status, 'unknown');
    assert.strictEqual(result.name, 'unknown');
  });

  it('returns unknown for empty string', () => {
    const result = classifyLicense('');
    assert.strictEqual(result.status, 'unknown');
    assert.strictEqual(result.name, 'unknown');
  });

  it('returns unknown for whitespace-only input', () => {
    const result = classifyLicense('   \n\n  ');
    assert.strictEqual(result.status, 'unknown');
    assert.strictEqual(result.name, 'unknown');
  });
});

// ── buildSearchQueries ────────────────────────────────────────────────────────

describe('buildSearchQueries', () => {
  it('generates at least 3 queries', () => {
    const queries = buildSearchQueries(
      'DanteForge is a TypeScript CLI tool for agentic development workflows.',
      'CLI tool',
      'TypeScript',
    );
    assert.ok(queries.length >= 3, `Expected >= 3 queries, got ${queries.length}`);
  });

  it('generates no more than 5 queries', () => {
    const queries = buildSearchQueries(
      'A web application for managing data.',
      'web application',
      'JavaScript',
    );
    assert.ok(queries.length <= 5, `Expected <= 5 queries, got ${queries.length}`);
  });

  it('includes project type in at least one query', () => {
    const queries = buildSearchQueries(
      'An AI agent tool for code generation.',
      'AI agent tool',
      'TypeScript',
    );
    const combined = queries.join(' ').toLowerCase();
    assert.ok(combined.includes('ai agent'), 'Expected at least one query to contain "ai agent"');
  });

  it('includes language in at least one query', () => {
    const queries = buildSearchQueries(
      'A Go CLI for file processing.',
      'CLI',
      'Go',
    );
    const combined = queries.join(' ').toLowerCase();
    assert.ok(combined.includes('go'), 'Expected at least one query to contain the language');
  });

  it('handles empty project summary gracefully', () => {
    const queries = buildSearchQueries('', 'CLI tool', 'TypeScript');
    assert.ok(queries.length >= 3, 'Should still generate queries with empty summary');
  });

  it('handles empty project type and language gracefully', () => {
    const queries = buildSearchQueries('A development tool', '', '');
    assert.ok(queries.length >= 3, 'Should generate queries even with empty type/language');
    for (const q of queries) {
      assert.ok(typeof q === 'string' && q.length > 0, 'Each query should be a non-empty string');
    }
  });
});

// ── prioritizePatterns ────────────────────────────────────────────────────────

describe('prioritizePatterns', () => {
  it('sorts P0 before P1', () => {
    const patterns: PatternExtraction[] = [
      {
        repoName: 'repo-a',
        category: 'architecture',
        pattern: 'Plugin System',
        description: 'Extensible plugin registry',
        priority: 'P1',
        effort: 'M',
      },
      {
        repoName: 'repo-b',
        category: 'cli-ux',
        pattern: 'Progress Bar',
        description: 'Animated CLI progress',
        priority: 'P0',
        effort: 'S',
      },
    ];

    const sorted = prioritizePatterns(patterns);
    assert.strictEqual(sorted[0]!.priority, 'P0');
    assert.strictEqual(sorted[1]!.priority, 'P1');
  });

  it('sorts P0 before P2 before P3', () => {
    const patterns: PatternExtraction[] = [
      { repoName: 'r', category: 'quality', pattern: 'A', description: 'D', priority: 'P3', effort: 'L' },
      { repoName: 'r', category: 'quality', pattern: 'B', description: 'D', priority: 'P0', effort: 'M' },
      { repoName: 'r', category: 'quality', pattern: 'C', description: 'D', priority: 'P2', effort: 'S' },
    ];

    const sorted = prioritizePatterns(patterns);
    assert.strictEqual(sorted[0]!.priority, 'P0');
    assert.strictEqual(sorted[1]!.priority, 'P2');
    assert.strictEqual(sorted[2]!.priority, 'P3');
  });

  it('within the same priority, sorts S effort before M before L', () => {
    const patterns: PatternExtraction[] = [
      { repoName: 'r', category: 'innovation', pattern: 'X', description: 'D', priority: 'P1', effort: 'L' },
      { repoName: 'r', category: 'innovation', pattern: 'Y', description: 'D', priority: 'P1', effort: 'S' },
      { repoName: 'r', category: 'innovation', pattern: 'Z', description: 'D', priority: 'P1', effort: 'M' },
    ];

    const sorted = prioritizePatterns(patterns);
    assert.strictEqual(sorted[0]!.effort, 'S');
    assert.strictEqual(sorted[1]!.effort, 'M');
    assert.strictEqual(sorted[2]!.effort, 'L');
  });

  it('does not mutate the input array', () => {
    const patterns: PatternExtraction[] = [
      { repoName: 'r', category: 'architecture', pattern: 'A', description: 'D', priority: 'P2', effort: 'M' },
      { repoName: 'r', category: 'architecture', pattern: 'B', description: 'D', priority: 'P0', effort: 'S' },
    ];

    const original = [...patterns];
    prioritizePatterns(patterns);

    assert.strictEqual(patterns[0]!.priority, original[0]!.priority);
    assert.strictEqual(patterns[1]!.priority, original[1]!.priority);
  });

  it('handles empty array', () => {
    const result = prioritizePatterns([]);
    assert.deepStrictEqual(result, []);
  });
});

// ── formatOSSReport ───────────────────────────────────────────────────────────

describe('formatOSSReport', () => {
  const sampleReport: OSSResearchReport = {
    projectSummary: 'DanteForge is a TypeScript CLI for agentic workflows.',
    reposScanned: [
      {
        name: 'owner/repo-one',
        url: 'https://github.com/owner/repo-one',
        description: 'An excellent CLI framework',
        license: 'allowed',
        licenseName: 'MIT',
        stars: 5200,
      },
      {
        name: 'owner/repo-two',
        url: 'https://github.com/owner/repo-two',
        description: 'GPL library — skipped',
        license: 'blocked',
        licenseName: 'GPL-3.0',
        stars: 800,
      },
    ],
    patternsExtracted: [
      {
        repoName: 'owner/repo-one',
        category: 'cli-ux',
        pattern: 'Spinner Component',
        description: 'Animated spinner for long operations',
        priority: 'P0',
        effort: 'S',
      },
      {
        repoName: 'owner/repo-one',
        category: 'architecture',
        pattern: 'Provider Registry',
        description: 'Dynamic provider loading',
        priority: 'P1',
        effort: 'M',
      },
    ],
    implemented: ['Spinner Component (repo-one)'],
    skipped: ['owner/repo-two — GPL-3.0 license blocked'],
    filesChanged: ['src/core/spinner.ts', 'src/cli/commands/forge.ts'],
  };

  it('includes the project summary section', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.includes('## Project Summary'), 'Must have a "Project Summary" section');
    assert.ok(md.includes('DanteForge is a TypeScript CLI'), 'Must include the project summary text');
  });

  it('includes the repos scanned section', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.includes('## Repositories Scanned'), 'Must have a "Repositories Scanned" section');
    assert.ok(md.includes('repo-one'), 'Must list scanned repos');
    assert.ok(md.includes('MIT'), 'Must list license names');
  });

  it('includes the patterns extracted section', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.includes('## Patterns Extracted'), 'Must have a "Patterns Extracted" section');
    assert.ok(md.includes('Spinner Component'), 'Must include pattern names');
    assert.ok(md.includes('Provider Registry'), 'Must include all extracted patterns');
  });

  it('includes the implemented section', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.includes('## Implemented'), 'Must have an "Implemented" section');
    assert.ok(md.includes('Spinner Component (repo-one)'), 'Must list implemented items');
  });

  it('includes the skipped section', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.includes('## Skipped'), 'Must have a "Skipped" section');
    assert.ok(md.includes('GPL-3.0'), 'Must explain why repos were skipped');
  });

  it('includes the files changed section', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.includes('## Files Changed'), 'Must have a "Files Changed" section');
    assert.ok(md.includes('src/core/spinner.ts'), 'Must list changed files');
  });

  it('handles empty report gracefully', () => {
    const emptyReport: OSSResearchReport = {
      projectSummary: 'Empty project',
      reposScanned: [],
      patternsExtracted: [],
      implemented: [],
      skipped: [],
      filesChanged: [],
    };

    const md = formatOSSReport(emptyReport);
    assert.ok(md.includes('## Project Summary'), 'Must still render all sections');
    assert.ok(md.includes('## Repositories Scanned'), 'Must render repos section');
    assert.ok(md.includes('## Patterns Extracted'), 'Must render patterns section');
    assert.ok(md.includes('_No repositories scanned._'), 'Must show empty state for repos');
    assert.ok(md.includes('_No patterns extracted._'), 'Must show empty state for patterns');
    assert.ok(md.includes('_Nothing implemented in this run._'), 'Must show empty state for implemented');
    assert.ok(md.includes('_No files modified._'), 'Must show empty state for files');
  });

  it('produces valid markdown with a header', () => {
    const md = formatOSSReport(sampleReport);
    assert.ok(md.startsWith('# OSS Research Report'), 'Must start with a top-level heading');
  });
});

// ── License set disjointness ──────────────────────────────────────────────────

describe('ALLOWED_LICENSES and BLOCKED_LICENSES', () => {
  it('are disjoint — no license appears in both sets', () => {
    for (const license of ALLOWED_LICENSES) {
      assert.ok(
        !BLOCKED_LICENSES.has(license),
        `License "${license}" appears in both ALLOWED_LICENSES and BLOCKED_LICENSES`,
      );
    }
    for (const license of BLOCKED_LICENSES) {
      assert.ok(
        !ALLOWED_LICENSES.has(license),
        `License "${license}" appears in both BLOCKED_LICENSES and ALLOWED_LICENSES`,
      );
    }
  });

  it('ALLOWED_LICENSES contains expected permissive licenses', () => {
    const expected = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', 'MPL-2.0'];
    for (const lic of expected) {
      assert.ok(ALLOWED_LICENSES.has(lic), `Expected ALLOWED_LICENSES to contain "${lic}"`);
    }
  });

  it('BLOCKED_LICENSES contains expected copyleft licenses', () => {
    const expected = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'EUPL-1.2'];
    for (const lic of expected) {
      assert.ok(BLOCKED_LICENSES.has(lic), `Expected BLOCKED_LICENSES to contain "${lic}"`);
    }
  });
});
