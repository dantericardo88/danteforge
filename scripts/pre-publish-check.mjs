#!/usr/bin/env node
// pre-publish-check.mjs — sanity gate before `npm publish`
// Verifies that the build is present and the CLI entrypoint is functional.
// Called by `npm run pre-publish-check` and optionally from prepublishOnly.
// Exits 1 with a clear message on any failure so npm publish is blocked.

import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DANTEFORGE_PRE_PUBLISH_ROOT allows tests to inject a fake root without touching the real build.
const root = process.env['DANTEFORGE_PRE_PUBLISH_ROOT'] ?? resolve(__dirname, '..');
const distIndex = resolve(root, 'dist', 'index.js');

let failed = false;
function fail(msg) {
  console.error(`[pre-publish-check] FAIL: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`[pre-publish-check] OK:   ${msg}`);
}

// 1. dist/index.js must exist and be non-empty
if (!existsSync(distIndex)) {
  fail(`dist/index.js not found — run \`npm run build\` first`);
} else {
  const size = statSync(distIndex).size;
  if (size < 1000) {
    fail(`dist/index.js is suspiciously small (${size} bytes) — build may have failed`);
  } else {
    ok(`dist/index.js exists (${(size / 1024).toFixed(1)} KB)`);
  }
}

if (failed) process.exit(1);

// 2. `node dist/index.js --version` must exit 0
try {
  const version = execFileSync('node', [distIndex, '--version'], { timeout: 10_000 }).toString().trim();
  ok(`--version outputs: ${version}`);
} catch {
  fail('`node dist/index.js --version` failed or timed out');
}

// 3. `node dist/index.js --help` must contain at least 3 canonical command names
try {
  const help = execFileSync('node', [distIndex, '--help'], { timeout: 10_000 }).toString();
  const canonicals = ['autoforge', 'forge', 'compete', 'harvest', 'plan'];
  const found = canonicals.filter(cmd => help.includes(cmd));
  if (found.length < 3) {
    fail(`--help output only mentions ${found.length}/5 canonical commands (expected ≥3): ${found.join(', ')}`);
  } else {
    ok(`--help mentions ${found.length}/5 canonical commands: ${found.join(', ')}`);
  }
} catch {
  fail('`node dist/index.js --help` failed or timed out');
}

if (failed) process.exit(1);
console.log('[pre-publish-check] All checks passed — safe to publish.');
