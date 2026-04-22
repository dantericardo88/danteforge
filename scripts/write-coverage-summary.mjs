#!/usr/bin/env node
// Writes c8 coverage summary to .danteforge/evidence/coverage-summary.json
// Run after `npm run test:coverage` — best-effort, exits 0 even if no coverage file found.

import fs from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const src = path.join(cwd, 'coverage', 'coverage-summary.json');
const evidenceDir = path.join(cwd, '.danteforge', 'evidence');
const dest = path.join(evidenceDir, 'coverage-summary.json');

try {
  const raw = await fs.readFile(src, 'utf8');
  // Validate it parses as JSON
  JSON.parse(raw);
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(dest, raw, 'utf8');
  process.stdout.write(`[coverage] Summary written to .danteforge/evidence/coverage-summary.json\n`);
} catch {
  // No coverage file yet — that's fine
  process.stdout.write(`[coverage] No coverage/coverage-summary.json found — skipping\n`);
}
