#!/usr/bin/env node
// CH-025 migration: sign every existing outcome-evidence receipt IN PLACE (idempotent), so strict
// enforcement (DANTEFORGE_REQUIRE_SIGNED_EVIDENCE=1) can be flipped on without dropping the corpus.
//
// Run on the KERNEL machine (the holder of ~/.danteforge/kernel-secret). It adds/refreshes the `sig`
// field over each receipt's factual content; it changes NO factual field, so derived scores are
// unaffected — it only establishes the tamper-evidence baseline going forward.
//
// Usage: node scripts/sign-outcome-evidence.mjs            # sign .danteforge/outcome-evidence
//        node scripts/sign-outcome-evidence.mjs <dir>      # custom directory

import 'tsx/esm';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { signOutcomeEvidence } = await import('../src/core/outcome-evidence-signer.ts');

const dirArg = process.argv[2] ?? path.join('.danteforge', 'outcome-evidence');
const dir = path.resolve(process.cwd(), dirArg);

let files;
try {
  files = await readdir(dir);
} catch {
  console.log(`[sign-evidence] no directory at ${dir} — nothing to sign`);
  process.exit(0);
}

let signed = 0;
let already = 0;
let skipped = 0;
let errored = 0;
for (const f of files) {
  if (!f.endsWith('.json')) continue;
  const p = path.join(dir, f);
  try {
    const entry = JSON.parse(await readFile(p, 'utf8'));
    if (!entry || !entry.dimensionId || !entry.outcomeId) { skipped++; continue; }
    const sig = signOutcomeEvidence(entry);
    if (entry.sig === sig) { already++; continue; }
    entry.sig = sig;
    await writeFile(p, JSON.stringify(entry, null, 2), 'utf8');
    signed++;
  } catch {
    errored++;
  }
}
console.log(`[sign-evidence] signed=${signed} already=${already} skipped=${skipped} errored=${errored} (scanned ${files.length})`);
