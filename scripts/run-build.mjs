import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeCommandCheckReceipt } from './command-check-receipts.mjs';

const require = createRequire(import.meta.url);
const tsupCliPath = require.resolve('tsup/dist/cli-default.js');
const start = Date.now();

function exitWithCode(code) {
  process.exit(typeof code === 'number' ? code : 1);
}

async function main() {
  const child = spawn(process.execPath, [tsupCliPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', async () => {
    await writeCommandCheckReceipt({
      id: 'build',
      command: 'npm run build',
      status: 'fail',
      durationMs: Date.now() - start,
    }, process.cwd());
    exitWithCode(1);
  });

  child.on('close', async (code, signal) => {
    await writeCommandCheckReceipt({
      id: 'build',
      command: 'npm run build',
      status: code === 0 && !signal ? 'pass' : 'fail',
      durationMs: Date.now() - start,
    }, process.cwd());

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    exitWithCode(code);
  });
}

await main();
