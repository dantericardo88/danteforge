// Onboarding wizard tests — Node built-in test runner (no Jest/Vitest)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isFirstRun,
  isConstitutionMissing,
  runOnboardingWizard,
} from '../src/core/onboarding-wizard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-onboard-test-'));
}

function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Returns a readline fn that cycles through the provided answers. */
function makeReadline(answers: string[]): (prompt: string) => Promise<string> {
  let index = 0;
  return async (_prompt: string) => {
    const answer = answers[index] ?? '';
    index++;
    return answer;
  };
}

// ---------------------------------------------------------------------------
// isFirstRun
// ---------------------------------------------------------------------------

describe('isFirstRun', () => {
  let tmpCwd: string;
  let tmpConfigDir: string;

  before(() => {
    tmpCwd = makeTmpDir();
    tmpConfigDir = makeTmpDir();
  });

  after(() => {
    removeDir(tmpCwd);
    removeDir(tmpConfigDir);
  });

  it('returns true when neither STATE.yaml nor config.yaml exist', () => {
    assert.equal(isFirstRun(tmpCwd, tmpConfigDir), true);
  });

  it('returns false when STATE.yaml exists', () => {
    const dfDir = path.join(tmpCwd, '.danteforge');
    fs.mkdirSync(dfDir, { recursive: true });
    fs.writeFileSync(path.join(dfDir, 'STATE.yaml'), 'phase: init\n');
    assert.equal(isFirstRun(tmpCwd, tmpConfigDir), false);
  });

  it('returns false when global config.yaml exists', () => {
    // Use a fresh tmpCwd (no STATE.yaml)
    const freshCwd = makeTmpDir();
    fs.mkdirSync(tmpConfigDir, { recursive: true });
    fs.writeFileSync(path.join(tmpConfigDir, 'config.yaml'), 'llmProvider: ollama\n');
    assert.equal(isFirstRun(freshCwd, tmpConfigDir), false);
    removeDir(freshCwd);
  });
});

// ---------------------------------------------------------------------------
// isConstitutionMissing
// ---------------------------------------------------------------------------

describe('isConstitutionMissing', () => {
  it('returns true when CONSTITUTION.md is absent', () => {
    const dir = makeTmpDir();
    assert.equal(isConstitutionMissing(dir), true);
    removeDir(dir);
  });

  it('returns false when CONSTITUTION.md exists', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'CONSTITUTION.md'), '# Constitution\n');
    assert.equal(isConstitutionMissing(dir), false);
    removeDir(dir);
  });
});

// ---------------------------------------------------------------------------
// runOnboardingWizard — first-run flow
// ---------------------------------------------------------------------------

describe('runOnboardingWizard', () => {
  it('exits immediately when already initialized (STATE.yaml present)', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();
    const dfDir = path.join(dir, '.danteforge');
    fs.mkdirSync(dfDir, { recursive: true });
    fs.writeFileSync(path.join(dfDir, 'STATE.yaml'), 'phase: init\n');

    const output: string[] = [];
    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: (msg) => output.push(msg),
      _readlineFn: makeReadline([]),
    });

    // Should not print welcome banner if already initialized
    assert.equal(output.length, 0);
    removeDir(dir);
    removeDir(configDir);
  });

  it('creates CONSTITUTION.md when missing during first run', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();

    const output: string[] = [];
    // Answers: project name = 'MyProject', type = 1 (web-app), provider = 1 (ollama)
    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: (msg) => output.push(msg),
      _readlineFn: makeReadline(['MyProject', '1', '1']),
    });

    const constitutionPath = path.join(dir, 'CONSTITUTION.md');
    assert.ok(fs.existsSync(constitutionPath), 'CONSTITUTION.md should exist');
    const content = fs.readFileSync(constitutionPath, 'utf8');
    assert.ok(content.includes('MyProject'), 'CONSTITUTION.md should include project name');
    assert.ok(content.includes('web-app'), 'CONSTITUTION.md should include project type');
    removeDir(dir);
    removeDir(configDir);
  });

  it('creates global config.yaml with chosen provider', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();

    // Answers: name = '', type = 2 (cli), provider = 2 (claude)
    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: () => undefined,
      _readlineFn: makeReadline(['', '2', '2']),
    });

    const configPath = path.join(configDir, 'config.yaml');
    assert.ok(fs.existsSync(configPath), 'config.yaml should exist');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(content.includes('claude'), 'config should mention claude provider');
    removeDir(dir);
    removeDir(configDir);
  });

  it('uses folder name when project name is empty', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();
    const folderName = path.basename(dir);

    // Answers: name = '' (use folder), type = 3 (library), provider = 1 (ollama)
    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: () => undefined,
      _readlineFn: makeReadline(['', '3', '1']),
    });

    const content = fs.readFileSync(path.join(dir, 'CONSTITUTION.md'), 'utf8');
    assert.ok(content.includes(folderName), 'CONSTITUTION.md should include folder name');
    removeDir(dir);
    removeDir(configDir);
  });

  it('does not overwrite existing CONSTITUTION.md', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();
    const originalContent = '# Custom Constitution — do not overwrite\n';
    fs.writeFileSync(path.join(dir, 'CONSTITUTION.md'), originalContent);

    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: () => undefined,
      _readlineFn: makeReadline(['ProjectX', '1', '1']),
    });

    const content = fs.readFileSync(path.join(dir, 'CONSTITUTION.md'), 'utf8');
    assert.equal(content, originalContent, 'existing CONSTITUTION.md must not be modified');
    removeDir(dir);
    removeDir(configDir);
  });

  it('prints a welcome banner and next steps checklist', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();
    const output: string[] = [];

    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: (msg) => output.push(msg),
      _readlineFn: makeReadline(['Test', '1', '1']),
    });

    const joined = output.join('\n');
    assert.ok(joined.includes('Welcome'), 'banner should include Welcome');
    assert.ok(joined.includes('Next steps'), 'output should include Next steps');
    assert.ok(joined.includes('danteforge specify'), 'next steps should mention specify');
    removeDir(dir);
    removeDir(configDir);
  });

  it('falls back gracefully when no readlineFn provided (non-interactive mode)', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();
    const output: string[] = [];

    // No _readlineFn — should print instructions and return without crashing
    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: (msg) => output.push(msg),
      // _readlineFn intentionally omitted
    });

    const joined = output.join('\n');
    assert.ok(joined.includes('danteforge init'), 'should mention init command in non-interactive mode');
    removeDir(dir);
    removeDir(configDir);
  });

  it('creates .danteforge directory as part of setup', async () => {
    const dir = makeTmpDir();
    const configDir = makeTmpDir();

    await runOnboardingWizard(dir, {
      _configDir: configDir,
      _writeFn: () => undefined,
      _readlineFn: makeReadline(['App', '1', '1']),
    });

    assert.ok(
      fs.existsSync(path.join(dir, '.danteforge')),
      '.danteforge directory should be created',
    );
    removeDir(dir);
    removeDir(configDir);
  });
});
