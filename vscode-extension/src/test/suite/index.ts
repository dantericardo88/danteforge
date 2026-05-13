// Mocha entry point for the extension test suite.
// @vscode/test-electron expects this to export `run()` that bootstraps tests.

import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30000 });
  mocha.addFile(path.resolve(__dirname, 'extension.test.js'));
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) reject(new Error(`${failures} test(s) failed.`));
        else resolve();
      });
    } catch (err) { reject(err); }
  });
}
