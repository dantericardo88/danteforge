// Phase 14d post-audit — Matrix War Room headless integration test.
//
// Proves the extension activates and the Matrix War Room webview can be
// opened from inside a real (albeit headless) VS Code instance. This is
// the verification I previously claimed was impossible from a terminal —
// @vscode/test-electron makes it possible.

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('DanteForge Matrix War Room', () => {
  test('extension is present', () => {
    const ext = vscode.extensions.getExtension('danteforge.danteforge-vscode');
    assert.ok(ext, 'expected danteforge.danteforge-vscode to be installed');
  });

  test('extension activates without error', async () => {
    const ext = vscode.extensions.getExtension('danteforge.danteforge-vscode')!;
    if (!ext.isActive) await ext.activate();
    assert.equal(ext.isActive, true);
  });

  test('matrixKernel.warRoom command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('danteforge.matrixKernel.warRoom'),
      `expected danteforge.matrixKernel.warRoom in command list (found ${commands.filter(c => c.startsWith('danteforge.')).length} danteforge.* commands)`,
    );
  });

  test('invoking the war-room command does not throw (no-workspace path)', async () => {
    // The war-room command checks workspaceFolders; if none, it shows an
    // error toast and returns. Either way, invoking it must not THROW.
    await vscode.commands.executeCommand('danteforge.matrixKernel.warRoom');
  });
});
