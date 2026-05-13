#!/usr/bin/env node
/**
 * Thin compatibility wrapper. The Matrix Development implementation now lives
 * in src/core/matrix-development-engine.ts and the CLI surface lives in
 * scripts/dimension-ascent.ts / `danteforge matrix`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const target = join(here, 'dimension-ascent.ts');

if (!existsSync(tsxCli)) {
  console.error('dimension-ascent failed: missing node_modules/tsx; run npm ci first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsxCli, target, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
