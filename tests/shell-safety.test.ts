import { describe, it } from 'node:test';
import assert from 'node:assert';

type ShellSafetyModule = {
  sanitizeShellInput: (input: string) => string;
  buildSpecifyCommand: (idea: string) => string;
};

async function loadShellSafety(): Promise<ShellSafetyModule> {
  const mod = await import('../vscode-extension/src/shell-safety.js');
  const candidate = (mod as unknown as Partial<ShellSafetyModule>) ??
    ((mod as { default?: Partial<ShellSafetyModule> }).default ?? {});
  const fallback = (mod as { default?: Partial<ShellSafetyModule> }).default ?? {};
  const sanitizeShellInput = candidate.sanitizeShellInput ?? fallback.sanitizeShellInput;
  const buildSpecifyCommand = candidate.buildSpecifyCommand ?? fallback.buildSpecifyCommand;

  if (!sanitizeShellInput || !buildSpecifyCommand) {
    throw new Error('shell-safety exports are missing');
  }

  return { sanitizeShellInput, buildSpecifyCommand };
}

describe('VS Code shell safety', () => {
  it('removes shell metacharacters from user input', async () => {
    const { sanitizeShellInput } = await loadShellSafety();
    const sanitized = sanitizeShellInput('Build "safe"; rm -rf / && echo $HOME');
    assert.strictEqual(sanitized, 'Build safe rm -rf / echo HOME');
  });

  it('builds a safe specify command payload', async () => {
    const { buildSpecifyCommand } = await loadShellSafety();
    const cmd = buildSpecifyCommand('line1\nline2 && whoami');
    assert.match(cmd, /^danteforge specify "/);
    assert.match(cmd, /"$/);

    const payload = cmd.slice('danteforge specify "'.length, -1);
    assert.doesNotMatch(payload, /["'`$&|;<>\\\r\n]/);
  });

  it('rejects input that becomes empty after sanitization', async () => {
    const { buildSpecifyCommand } = await loadShellSafety();
    assert.throws(
      () => buildSpecifyCommand('&&||;;;""'),
      /Please enter an idea with letters or numbers/,
    );
  });
});
