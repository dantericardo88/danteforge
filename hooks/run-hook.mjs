#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hookName = process.argv[2];

if (!hookName) {
  console.error(JSON.stringify({ error: 'No hook name provided' }));
  process.exit(1);
}

const candidates = [
  path.join(__dirname, `${hookName}.mjs`),
  path.join(__dirname, `${hookName}.js`),
];

let hookScript;
for (const candidate of candidates) {
  try {
    await fs.access(candidate);
    hookScript = candidate;
    break;
  } catch {
    // try next candidate
  }
}

if (!hookScript) {
  console.error(JSON.stringify({ error: `Hook script not found for ${hookName}` }));
  process.exit(1);
}

const child = spawn(process.execPath, [hookScript, ...process.argv.slice(3)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
