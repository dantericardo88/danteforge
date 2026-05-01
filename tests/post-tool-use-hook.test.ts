// Pass 24 T3.1 — post-edit auto-commit hook script.
//
// Verifies the hook script handles a synthetic Claude Code PostToolUse payload
// without crashing and without blocking the editor (always exits 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';

const HOOK_SCRIPT = resolve(process.cwd(), 'hooks/post-tool-use.mjs');

async function removeWorkspace(workspace: string): Promise<void> {
  await rm(workspace, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function runHookWithPayload(payload: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', rejectP);
    child.on('close', (code) => resolveP({ code: code ?? 1, stdout, stderr }));
    child.stdin.write(payload);
    child.stdin.end();
  });
}

test('post-tool-use hook handles synthetic Edit payload without crashing', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'post-tool-use-'));
  try {
    mkdirSync(join(workspace, '.danteforge'), { recursive: true });
    writeFileSync(join(workspace, '.danteforge', 'STATE.yaml'), 'phase: test\n', 'utf8');
    writeFileSync(join(workspace, 'sample.txt'), 'hello', 'utf8');
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(workspace, 'sample.txt'), old_string: 'hello', new_string: 'world' },
    });
    const { code } = await runHookWithPayload(payload, workspace);
    assert.equal(code, 0);
  } finally {
    await removeWorkspace(workspace);
  }
});

test('post-tool-use hook ignores non-edit tools', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'post-tool-use-skip-'));
  try {
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/whatever' } });
    const { code } = await runHookWithPayload(payload, workspace);
    assert.equal(code, 0);
  } finally {
    await removeWorkspace(workspace);
  }
});

test('post-tool-use hook handles malformed payload gracefully', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'post-tool-use-malformed-'));
  try {
    const { code } = await runHookWithPayload('not-json', workspace);
    assert.equal(code, 0);
  } finally {
    await removeWorkspace(workspace);
  }
});
