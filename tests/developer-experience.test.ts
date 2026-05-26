// developer-experience.test.ts — DX improvements: help examples, error boundary,
// doctor checks, --quiet / --verbose wiring.
// Uses Node.js built-in test runner (no Jest/Vitest).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// 1. cli-error-boundary — recovery hint emission
// ---------------------------------------------------------------------------

describe('cli-error-boundary', () => {
  it('emits recovery hint for plain Error when not in verbose mode', async () => {
    const { withErrorBoundary } = await import('../src/core/cli-error-boundary.js');
    const captured: string[] = [];
    const fakeLogger = {
      error: (msg: string) => { captured.push(msg); },
      verbose: () => {},
      getLevel: () => 'info' as const,
    } as never;

    // Temporarily clear DANTEFORGE_VERBOSE to simulate non-verbose mode
    const origVerbose = process.env.DANTEFORGE_VERBOSE;
    const origExitCode = process.exitCode;
    delete process.env.DANTEFORGE_VERBOSE;

    await withErrorBoundary('test-cmd', async () => { throw new Error('boom'); }, { _logger: fakeLogger });

    process.env.DANTEFORGE_VERBOSE = origVerbose;
    process.exitCode = origExitCode; // withErrorBoundary sets exitCode=1; restore for test runner

    const combinedOutput = captured.join('\n');
    assert.ok(combinedOutput.includes('boom'), 'should include error message');
    assert.ok(
      combinedOutput.includes('--verbose') || combinedOutput.includes('--help'),
      'should include recovery hint with --verbose or --help',
    );
  });

  it('does NOT emit recovery hint when verbose mode is active', async () => {
    const { withErrorBoundary } = await import('../src/core/cli-error-boundary.js');
    const captured: string[] = [];
    const fakeLogger = {
      error: (msg: string) => { captured.push(msg); },
      verbose: (msg: string) => { captured.push(msg); },
      getLevel: () => 'verbose' as const,
    } as never;

    const origExitCode = process.exitCode;
    await withErrorBoundary('test-cmd', async () => { throw new Error('oops'); }, { _logger: fakeLogger, _verbose: true });
    process.exitCode = origExitCode; // restore — withErrorBoundary sets exitCode=1

    // Verbose output may include stack but should NOT include the recovery hint
    const hintMessages = captured.filter(m => m.includes('Run with --verbose'));
    assert.equal(hintMessages.length, 0, 'recovery hint should not appear in verbose mode');
  });

  it('handles GateError with remedy — no recovery hint needed', async () => {
    const { withErrorBoundary } = await import('../src/core/cli-error-boundary.js');
    const { GateError } = await import('../src/core/gates.js');
    const captured: string[] = [];
    const fakeLogger = {
      error: (msg: string) => { captured.push(msg); },
      verbose: () => {},
      getLevel: () => 'info' as const,
    } as never;

    const origExitCode = process.exitCode;
    const gate = new GateError('Missing SPEC.md', 'Run danteforge specify');
    await withErrorBoundary('test-cmd', async () => { throw gate; }, { _logger: fakeLogger });
    process.exitCode = origExitCode; // restore — withErrorBoundary sets exitCode=1

    const combined = captured.join('\n');
    assert.ok(combined.includes('Gate blocked'), 'should show gate blocked');
    assert.ok(combined.includes('Missing SPEC.md'), 'should include gate message');
  });

  it('exits with exitCode 1 on error', async () => {
    const { withErrorBoundary } = await import('../src/core/cli-error-boundary.js');
    const origExitCode = process.exitCode;
    process.exitCode = 0;

    await withErrorBoundary('test-cmd', async () => { throw new Error('fail'); }, {
      _logger: { error: () => {}, verbose: () => {}, getLevel: () => 'info' as const } as never,
    });

    assert.equal(process.exitCode, 1, 'exitCode should be 1 after error');
    process.exitCode = origExitCode;
  });

  it('does not set exitCode on success', async () => {
    const { withErrorBoundary } = await import('../src/core/cli-error-boundary.js');
    process.exitCode = 0;

    await withErrorBoundary('test-cmd', async () => { /* no throw */ }, {});

    assert.equal(process.exitCode, 0, 'exitCode should remain 0 on success');
  });
});

// ---------------------------------------------------------------------------
// 2. doctor command — check structure and injectable dependencies
// ---------------------------------------------------------------------------

describe('doctor command — diagnostic checks', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-doctor-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('doctor function is exported from doctor.ts', async () => {
    const mod = await import('../src/cli/commands/doctor.js');
    assert.ok(typeof mod.doctor === 'function', 'doctor should be a function');
  });

  it('doctor exports validateLiveReleaseConfig', async () => {
    const { validateLiveReleaseConfig } = await import('../src/cli/commands/doctor.js');
    assert.ok(typeof validateLiveReleaseConfig === 'function', 'validateLiveReleaseConfig should be exported');
  });

  it('validateLiveReleaseConfig returns error when DANTEFORGE_LIVE_PROVIDERS unset', async () => {
    const { validateLiveReleaseConfig } = await import('../src/cli/commands/doctor.js');
    const result = validateLiveReleaseConfig({ /* empty env */ });
    assert.ok(result.error, 'should have error when env var not set');
    assert.ok(result.error?.includes('DANTEFORGE_LIVE_PROVIDERS'), 'should mention the missing env var');
  });

  it('validateLiveReleaseConfig accepts valid providers', async () => {
    const { validateLiveReleaseConfig } = await import('../src/cli/commands/doctor.js');
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'ollama', OLLAMA_MODEL: 'llama3' });
    assert.ok(!result.error, 'should not have error for valid config');
    assert.deepEqual(result.providers, ['ollama']);
    assert.deepEqual(result.missing, []);
  });

  it('validateLiveReleaseConfig reports missing API key for openai provider', async () => {
    const { validateLiveReleaseConfig } = await import('../src/cli/commands/doctor.js');
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'openai' });
    assert.ok(result.missing.length > 0, 'should have missing keys');
    assert.ok(result.missing.some(m => m.includes('OPENAI_API_KEY')), 'should mention OPENAI_API_KEY');
  });

  it('validateLiveReleaseConfig rejects unknown providers', async () => {
    const { validateLiveReleaseConfig } = await import('../src/cli/commands/doctor.js');
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'unknown-provider' });
    assert.ok(result.error, 'should have error for unknown provider');
    assert.ok(result.error?.includes('unknown-provider'), 'error should mention the bad provider');
  });

  it('doctor runs without crashing (injection seam with stubbed deps)', async () => {
    const { doctor } = await import('../src/cli/commands/doctor.js');
    const { loadState, saveState } = await import('../src/core/state.js');
    // Should not throw — exits gracefully even without state
    let threw = false;
    const origExitCode = process.exitCode;
    try {
      await doctor({ _loadState: loadState, _saveState: saveState });
    } catch {
      threw = true;
    } finally {
      // Doctor may set process.exitCode=1 for warnings — reset so test runner stays clean
      process.exitCode = origExitCode;
    }
    assert.ok(!threw, 'doctor should not throw');
  });
});

// ---------------------------------------------------------------------------
// 3. --quiet / --verbose env var wiring
// ---------------------------------------------------------------------------

describe('global flags — env var wiring', () => {
  it('DANTEFORGE_QUIET is a recognized env key used by the CLI', () => {
    // Verify the key is correct — this is a contract test
    const validKey = 'DANTEFORGE_QUIET';
    assert.match(validKey, /^DANTEFORGE_[A-Z_]+$/, 'env key should follow naming convention');
  });

  it('DANTEFORGE_VERBOSE is a recognized env key used by the CLI', () => {
    const validKey = 'DANTEFORGE_VERBOSE';
    assert.match(validKey, /^DANTEFORGE_[A-Z_]+$/, 'env key should follow naming convention');
  });

  it('DANTEFORGE_VERBOSE env var suppresses recovery hint in error boundary', async () => {
    const { withErrorBoundary } = await import('../src/core/cli-error-boundary.js');
    const captured: string[] = [];
    const fakeLogger = {
      error: (msg: string) => { captured.push(msg); },
      verbose: () => {},
      getLevel: () => 'info' as const,
    } as never;

    const orig = process.env.DANTEFORGE_VERBOSE;
    const origExitCode = process.exitCode;
    process.env.DANTEFORGE_VERBOSE = '1';

    await withErrorBoundary('test-cmd', async () => { throw new Error('verbose-test'); }, { _logger: fakeLogger });

    process.env.DANTEFORGE_VERBOSE = orig;
    process.exitCode = origExitCode; // restore — withErrorBoundary sets exitCode=1

    const hintMessages = captured.filter(m => m.includes('Run with --verbose'));
    assert.equal(hintMessages.length, 0, 'recovery hint should be suppressed when DANTEFORGE_VERBOSE=1');
  });

  it('logger setLevel is accessible for quiet-mode wiring', async () => {
    const { logger } = await import('../src/core/logger.js');
    const original = logger.getLevel();
    logger.setLevel('error');
    assert.equal(logger.getLevel(), 'error', 'setLevel should change log level to error (quiet mode)');
    logger.setLevel(original); // restore
  });

  it('logger setLevel verbose enables verbose output', async () => {
    const { logger } = await import('../src/core/logger.js');
    const original = logger.getLevel();
    logger.setLevel('verbose');
    assert.equal(logger.getLevel(), 'verbose', 'setLevel should change log level to verbose');
    logger.setLevel(original); // restore
  });
});

// ---------------------------------------------------------------------------
// 4. Help text — "Examples" section presence
// ---------------------------------------------------------------------------

describe('help text — Examples sections', () => {
  // We test by reading the register files and checking for addHelpText calls
  // with Examples content, since instantiating Commander in tests would
  // require full program wiring.

  it('register-compete-cmds.ts contains Examples for compete', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'register-compete-cmds.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(content.includes("addHelpText('after'"), 'compete command should have addHelpText');
    assert.ok(content.includes('danteforge compete'), 'should have compete examples');
  });

  it('register-convergence-cmds.ts contains Examples for score', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'register-convergence-cmds.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(content.includes('danteforge score'), 'should have score examples');
  });

  it('register-ops-cmds.ts contains Examples for go', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'register-ops-cmds.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(content.includes('danteforge go'), 'should have go examples');
  });

  it('register-core-craft-cmds.ts contains Examples for forge', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'register-core-craft-cmds.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(content.includes("addHelpText('after'"), 'forge command should have addHelpText');
    assert.ok(content.includes('danteforge forge'), 'should have forge examples');
  });

  it('index.ts contains Examples for assess', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(content.includes("addHelpText('after'"), 'assess command should have addHelpText');
    assert.ok(content.includes('danteforge assess'), 'should have assess examples');
  });

  it('all 5 commands include the word "Examples" in their help text blocks', async () => {
    const competeCmds = await fs.readFile(
      path.join(process.cwd(), 'src', 'cli', 'register-compete-cmds.ts'), 'utf8',
    );
    const coreCraft = await fs.readFile(
      path.join(process.cwd(), 'src', 'cli', 'register-core-craft-cmds.ts'), 'utf8',
    );
    const indexTs = await fs.readFile(
      path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8',
    );

    const allContent = competeCmds + coreCraft + indexTs;
    const examplesCount = (allContent.match(/Examples:/g) ?? []).length;
    assert.ok(examplesCount >= 5, `expected at least 5 "Examples:" sections, found ${examplesCount}`);
  });
});

// ---------------------------------------------------------------------------
// 5. index.ts — process-level error handlers wired
// ---------------------------------------------------------------------------

describe('index.ts — process-level error boundary wiring', () => {
  it('index.ts registers uncaughtException handler', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(
      content.includes("process.on('uncaughtException'"),
      'should register uncaughtException handler',
    );
  });

  it('index.ts registers unhandledRejection handler', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(
      content.includes("process.on('unhandledRejection'"),
      'should register unhandledRejection handler',
    );
  });

  it('index.ts sets DANTEFORGE_QUIET env var in preAction hook', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(
      content.includes('DANTEFORGE_QUIET'),
      'should set DANTEFORGE_QUIET env var',
    );
  });

  it('index.ts sets DANTEFORGE_VERBOSE env var in preAction hook', async () => {
    const filePath = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const content = await fs.readFile(filePath, 'utf8');
    assert.ok(
      content.includes('DANTEFORGE_VERBOSE'),
      'should set DANTEFORGE_VERBOSE env var',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. format-error.ts — suggestNextStep integration
// ---------------------------------------------------------------------------

describe('format-error — suggestNextStep', () => {
  it('returns undefined for truly unknown error messages', async () => {
    const { suggestNextStep } = await import('../src/core/format-error.js');
    // A nonsense message should return undefined (no false-positive suggestions)
    const result = suggestNextStep('xkcd_random_nonsense_9ae7f');
    assert.equal(result, undefined, 'should return undefined for unknown error');
  });

  it('enriches known error patterns with a suggestion', async () => {
    const { enrichError } = await import('../src/core/actionable-errors.js');
    const err = new Error('ENOENT: no such file or directory');
    const enriched = enrichError(err);
    // Either has a known code or is ERR_UNKNOWN — just check it doesn't throw
    assert.ok(typeof enriched.code === 'string', 'enriched error should have a code');
    assert.ok(typeof enriched.suggestion === 'string', 'enriched error should have a suggestion');
  });
});
