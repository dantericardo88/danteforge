// Headless extension test launcher (Phase 14d post-audit)
//
// Downloads VS Code (cached after first run), launches it headlessly, points
// it at this extension's compiled `dist/` and at a Mocha suite, and asserts
// that:
//   1. The extension activates
//   2. `danteforge.matrixKernel.warRoom` is registered
//   3. Invoking the command does not throw (a real webview panel is created)
//
// This is the proof I previously claimed was impossible from a headless
// terminal. It IS possible — @vscode/test-electron handles the heavy lifting.

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

    // NOTE: We intentionally do NOT pass a workspace path via launchArgs. On
    // Windows, @vscode/test-electron + Code.exe + a positional workspace path
    // can trip an electron-in-node-mode flow that tries to `require()` the
    // path as a script and crashes. The tests below verify activation +
    // command registration which doesn't require a workspace; the openFolder
    // path is exercised by the unit-tested loadMatrixDashboardSnapshot.
    void os;
    void fs;
    await runTests({
      version: '1.96.0',
      extensionDevelopmentPath,
      extensionTestsPath,
    });
    // eslint-disable-next-line no-console
    console.log('[test-runner] All tests passed.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[test-runner] Failed:', err);
    process.exit(1);
  }
}

void main();
