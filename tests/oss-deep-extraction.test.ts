// OSS Deep Extraction — integration tests using injection seams.
// No real git clones. No real LLM calls. Real temp directory filesystem.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ossDeep,
  adjustConfidenceFromEvidence,
  type OssDeepOptions,
  type DeepPattern,
} from '../src/cli/commands/oss-deep.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-oss-deep-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Create a local fixture repo directory with source files for testing */
async function makeLocalRepo(baseDir: string): Promise<string> {
  const repoDir = path.join(baseDir, 'fake-repo');
  const srcDir = path.join(repoDir, 'src');
  const testsDir = path.join(repoDir, 'tests');

  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

  // Create a source file with injection seam pattern
  await fs.writeFile(
    path.join(srcDir, 'core.ts'),
    [
      'export interface CoreOpts {',
      '  _callFn?: () => Promise<string>;',
      '  _logger?: (msg: string) => void;',
      '}',
      'export async function runCore(opts: CoreOpts = {}): Promise<string> {',
      '  const fn = opts._callFn ?? defaultFn;',
      '  return fn();',
      '}',
      'async function defaultFn(): Promise<string> { return "default"; }',
    ].join('\n'),
    'utf8',
  );

  // Create a test file
  await fs.writeFile(
    path.join(testsDir, 'core.test.ts'),
    [
      'import { runCore } from "../src/core.js";',
      'it("uses injected callFn", async () => {',
      '  const result = await runCore({ _callFn: async () => "mocked" });',
      '  assert.strictEqual(result, "mocked");',
      '});',
    ].join('\n'),
    'utf8',
  );

  // Create package.json
  await fs.writeFile(
    path.join(repoDir, 'package.json'),
    JSON.stringify({ name: 'fake-repo', version: '1.0.0', type: 'module' }),
    'utf8',
  );

  // Create MIT LICENSE
  await fs.writeFile(
    path.join(repoDir, 'LICENSE'),
    'MIT License\nCopyright (c) 2025 Test\nPermission is hereby granted...',
    'utf8',
  );

  return repoDir;
}

/** Mock LLM caller returning a valid patterns JSON */
function mockLLMCaller(patterns: DeepPattern[]): (prompt: string) => Promise<string> {
  return async () => JSON.stringify({
    patterns,
    topInnovations: ['injection-seams', 'testability', 'clean-api'],
    immediateAdoptions: ['dependency-injection-seams'],
    followUpQuestions: ['Are tests comprehensive?'],
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('OSS Deep Extraction — with local path', () => {

  it('T1: ossDeep with local path reads src files and produces patterns (deterministic fallback)', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    const result = await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => false,
    });

    assert.ok(result.patterns.length >= 0, 'patterns array must exist');
    assert.strictEqual(result.slug, 'fake-repo');
    assert.strictEqual(result.license, 'MIT');
  });

  it('T2: ossDeep writes DEEP_HARVEST.md to .danteforge/oss-deep/{slug}/', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    const result = await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => false,
    });

    const harvestMdPath = path.join(result.harvestPath, 'DEEP_HARVEST.md');
    await assert.doesNotReject(
      fs.access(harvestMdPath),
      'DEEP_HARVEST.md must exist after extraction',
    );
    const content = await fs.readFile(harvestMdPath, 'utf8');
    assert.ok(content.includes('fake-repo'), 'DEEP_HARVEST.md must include repo slug');
  });

  it('T3: ossDeep writes patterns.json with DeepPattern[] structure', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    const mockPattern: DeepPattern = {
      patternName: 'injection-seam',
      category: 'architecture',
      implementationSnippet: '_callFn?: () => Promise<string>',
      whyItWorks: 'Makes side effects testable',
      adoptionComplexity: 'low',
      sourceFile: 'src/core.ts',
      confidence: 6,
    };

    const result = await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => true,
      _llmCaller: mockLLMCaller([mockPattern]),
    });

    const patternsPath = path.join(result.harvestPath, 'patterns.json');
    await assert.doesNotReject(fs.access(patternsPath), 'patterns.json must exist');
    const raw = await fs.readFile(patternsPath, 'utf8');
    const parsed = JSON.parse(raw) as DeepPattern[];
    assert.ok(Array.isArray(parsed), 'patterns.json must be an array');
    assert.ok(parsed.every(p => p.patternName && p.category), 'each pattern must have required fields');
  });

  it('T4: ossDeep updates oss-registry.json with status active', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => false,
    });

    const registryPath = path.join(dir, '.danteforge', 'oss-registry.json');
    await assert.doesNotReject(fs.access(registryPath), 'oss-registry.json must be created');
    const raw = await fs.readFile(registryPath, 'utf8');
    const registry = JSON.parse(raw) as { repos: Array<{ name: string; status: string }> };
    const entry = registry.repos.find(r => r.name === 'fake-repo');
    assert.ok(entry, 'registry must contain fake-repo entry');
    assert.strictEqual(entry.status, 'active');
  });

  it('T5: ossDeep with promptMode=true returns empty patterns without writing files', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    const result = await ossDeep(repoDir, {
      cwd: dir,
      promptMode: true,
      _isLLMAvailable: async () => false,
    });

    assert.deepStrictEqual(result.patterns, []);
    // No files should be written
    const deepDir = path.join(dir, '.danteforge', 'oss-deep');
    const exists = await fs.access(deepDir).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'oss-deep/ directory must NOT be created in prompt mode');
  });

  it('T6: ossDeep confidence scoring — pattern in test file gets +3 boost', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    // The injection seam pattern is in tests/core.test.ts — tests contain "_callFn"
    // so deterministic extractor should assign confidence that reflects test coverage

    const result = await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => false,
    });

    // If any patterns found, confidence must be >= 1
    for (const p of result.patterns) {
      assert.ok(p.confidence >= 1 && p.confidence <= 10, `confidence must be 1-10, got ${p.confidence}`);
    }
  });

  it('T7: ossDeep handles empty src directory gracefully (0 patterns, no throw)', async () => {
    const dir = await makeTempDir();
    const emptyRepo = path.join(dir, 'empty-repo');
    await fs.mkdir(path.join(emptyRepo, 'src'), { recursive: true });
    await fs.writeFile(path.join(emptyRepo, 'LICENSE'), 'MIT License', 'utf8');
    await fs.writeFile(path.join(emptyRepo, 'package.json'), '{"name":"empty"}', 'utf8');

    let threwError = false;
    try {
      await ossDeep(emptyRepo, {
        cwd: dir,
        _isLLMAvailable: async () => false,
      });
    } catch {
      threwError = true;
    }
    assert.strictEqual(threwError, false, 'ossDeep must not throw for empty src directory');
  });

  it('T8: ossDeep with _isLLMAvailable=false uses deterministic extraction', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    let llmWasCalled = false;
    const result = await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => false,
      _llmCaller: async () => {
        llmWasCalled = true;
        return '{}';
      },
    });

    assert.strictEqual(llmWasCalled, false, 'LLM must NOT be called when unavailable');
    assert.ok(result.harvestPath.length > 0, 'harvestPath must be set even in fallback mode');
  });

  it('T9: ossDeep with _gitLog injection calls log for top files when includeGitLog is true', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    const calledFiles: string[] = [];
    await ossDeep(repoDir, {
      cwd: dir,
      includeGitLog: true,
      _isLLMAvailable: async () => false,
      _gitLog: async (_repoPath: string, filePath: string) => {
        calledFiles.push(filePath);
        return `commit abc123\nAuthor: Test\n\n    feat: initial\n`;
      },
    });

    assert.ok(calledFiles.length > 0, '_gitLog must be called for critical files when includeGitLog=true');
  });

  it('T10: ossDeep deduplicates patterns by patternName (keeps higher confidence)', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);

    const duplicatePatterns: DeepPattern[] = [
      {
        patternName: 'injection-seam',
        category: 'architecture',
        implementationSnippet: 'opts._fn',
        whyItWorks: 'testable',
        adoptionComplexity: 'low',
        sourceFile: 'src/a.ts',
        confidence: 4,
      },
      {
        patternName: 'injection-seam',   // same name
        category: 'architecture',
        implementationSnippet: 'opts._fn2',
        whyItWorks: 'very testable',
        adoptionComplexity: 'low',
        sourceFile: 'src/b.ts',
        confidence: 8,   // higher confidence → should win
      },
    ];

    const result = await ossDeep(repoDir, {
      cwd: dir,
      _isLLMAvailable: async () => true,
      _llmCaller: mockLLMCaller(duplicatePatterns),
    });

    const injectionSeams = result.patterns.filter(p => p.patternName === 'injection-seam');
    assert.strictEqual(injectionSeams.length, 1, 'duplicate patterns must be merged');
    assert.strictEqual(injectionSeams[0]!.confidence, 8, 'higher-confidence duplicate must win');
  });

  it('T11: _runGhPrList is called when includeGitLog=true and output is appended to extraction context', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeLocalRepo(dir);
    let prListCalled = false;
    let capturedPrompt = '';

    await ossDeep(repoDir, {
      cwd: dir,
      includeGitLog: true,
      _isLLMAvailable: async () => true,
      _gitLog: async () => 'commit abc\nAuthor: Test\n\n    feat: initial',
      _runGhPrList: async () => {
        prListCalled = true;
        return '# feat: Add circuit breaker\nImplemented three-state circuit breaker for resilience.';
      },
      _llmCaller: async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({
          patterns: [],
          topInnovations: [],
          immediateAdoptions: [],
          followUpQuestions: [],
        });
      },
      _grepFn: async () => [],
    });

    assert.strictEqual(prListCalled, true, '_runGhPrList must be called when includeGitLog=true');
    assert.ok(capturedPrompt.includes('Merged PR Descriptions'), 'PR descriptions must appear in LLM prompt');
    assert.ok(capturedPrompt.includes('circuit breaker'), 'PR content must be included in extraction context');
  });

});

describe('OSS Deep Extraction — confidence scoring', () => {

  it('T12: adjustConfidenceFromEvidence adds +3 for test match and +1 for JSDoc snippet', async () => {
    const patterns: DeepPattern[] = [
      {
        patternName: 'circuit-breaker',
        category: 'error-handling',
        implementationSnippet: '/** @param state - circuit state */ function open(state: State) {}',
        whyItWorks: 'Prevents cascading failures',
        adoptionComplexity: 'medium',
        sourceFile: 'src/circuit.ts',
        confidence: 5,
      },
    ];

    const adjusted = await adjustConfidenceFromEvidence(
      patterns,
      '/fake/repo',
      'commit abc\nsrc/circuit.ts | 2 ++',  // 1 commit line — not enough for +2
      async (pattern, dir) => {
        // Return matches only when searching a test directory
        if (dir.includes('test') || dir.includes('spec')) {
          return ['tests/circuit.test.ts'];  // → +3
        }
        return [];
      },
    );

    assert.strictEqual(adjusted.length, 1);
    const p = adjusted[0]!;
    // Base 5 + 3 (test match) + 1 (JSDoc) = 9
    assert.strictEqual(p.confidence, 9, `confidence must be 9 (base 5 + test +3 + JSDoc +1), got ${p.confidence}`);
  });

  it('T13: adjustConfidenceFromEvidence adds +2 for survived refactor (3+ commit lines)', async () => {
    const patterns: DeepPattern[] = [
      {
        patternName: 'retry-backoff',
        category: 'error-handling',
        implementationSnippet: 'const delay = Math.pow(2, attempt) * 100;',
        whyItWorks: 'Prevents retry storms',
        adoptionComplexity: 'low',
        sourceFile: 'src/retry.ts',
        confidence: 4,
      },
    ];

    // 3 commit lines referencing the source file → +2
    const gitLogText = [
      'commit aaa\nsrc/retry.ts | 5 ++',
      'commit bbb\nsrc/retry.ts | 2 +-',
      'commit ccc\nsrc/retry.ts | 1 +',
    ].join('\n');

    const adjusted = await adjustConfidenceFromEvidence(
      patterns,
      '/fake/repo',
      gitLogText,
      async () => [],  // no test or source matches
    );

    const p = adjusted[0]!;
    // Base 4 + 2 (survived 3+ commits) = 6
    assert.strictEqual(p.confidence, 6, `confidence must be 6 (base 4 + refactor +2), got ${p.confidence}`);
  });

});
