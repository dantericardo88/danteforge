// Pass 37 — export high-value receipts to a tracked snapshot directory so they can be
// git-anchored. The internal `.danteforge/evidence/` is gitignored (it's local state),
// so receipts there can never have a git-witness. Receipts copied to `docs/evidence-export/`
// inherit the git-witness path: every published receipt has a commit SHA + commit-date that
// independently witnesses the content at write time.
//
// Usage: founder runs this before arXiv submission / npm publish to lock the proof state
// into the public repo's git history.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import 'tsx/esm';

const { sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
const exportDir = resolve(ROOT, 'docs', 'evidence-export');

// High-value receipt patterns — manually curated so we don't dump 1000+ files into the repo.
const HIGH_VALUE_PATTERNS = [
  /^pass-\d+(\.\d+)?-/,         // pass-N or pass-N.M receipts
  /^pass-\d+-\d+-\d+/,           // combined receipts (e.g., pass-31-32-33)
  /^pass-30-runs/,               // F_100000 v3 result
  /^pass-27-runs/,               // F_100000 v2 result
  /^pass-20-runs/,               // ABCD prd-real result
  /^pass-23-runs/,               // F_100000 v1 result
];

mkdirSync(exportDir, { recursive: true });

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.isFile() && name.endsWith('.json') && !name.endsWith('.proof.json')) out.push(full);
  }
  return out;
}

function shouldExport(file) {
  const rel = relative(evidenceDir, file).replace(/\\/g, '/');
  return HIGH_VALUE_PATTERNS.some(pat => pat.test(rel));
}

const stats = { scanned: 0, exported: 0, skipped: 0, errored: 0 };

for (const file of walk(evidenceDir)) {
  stats.scanned += 1;
  if (!shouldExport(file)) {
    stats.skipped += 1;
    continue;
  }
  try {
    const rel = relative(evidenceDir, file).replace(/\\/g, '/');
    const exportPath = join(exportDir, rel);
    mkdirSync(resolve(exportPath, '..'), { recursive: true });
    const content = readFileSync(file, 'utf-8');
    writeFileSync(exportPath, content, 'utf-8');
    // Also export the .proof.json sidecar if it exists.
    const proofSidecar = file.replace(/\.json$/, '.proof.json');
    if (existsSync(proofSidecar)) {
      const sidecarContent = readFileSync(proofSidecar, 'utf-8');
      writeFileSync(exportPath.replace(/\.json$/, '.proof.json'), sidecarContent, 'utf-8');
    }
    stats.exported += 1;
  } catch {
    stats.errored += 1;
  }
}

// Write a manifest summarizing the export with content hashes for tamper-detection.
const manifestEntries = [];
for (const file of walk(exportDir)) {
  const rel = relative(exportDir, file).replace(/\\/g, '/');
  const content = readFileSync(file, 'utf-8');
  manifestEntries.push({ path: rel, sha256: sha256(content), bytes: content.length });
}
manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  description: 'Snapshot of high-value receipts exported from .danteforge/evidence/ for git-witness anchoring. Once committed, every entry below has a git commit SHA + commit-date as independent witness.',
  exportRoot: 'docs/evidence-export/',
  entries: manifestEntries,
  countByPattern: HIGH_VALUE_PATTERNS.map(p => ({
    pattern: p.toString(),
    count: manifestEntries.filter(e => p.test(e.path)).length,
  })),
};
writeFileSync(join(exportDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Pass 37 evidence export complete:`);
console.log(`  scanned:                  ${stats.scanned}`);
console.log(`  exported:                 ${stats.exported}`);
console.log(`  skipped (low-value):      ${stats.skipped}`);
console.log(`  errored:                  ${stats.errored}`);
console.log(`  manifest entries:         ${manifestEntries.length}`);
console.log(`  next step:                git add docs/evidence-export/ && git commit (founder action)`);
console.log(`                            then run upgrade-backfill-anchors-with-git.mjs to git-witness them`);
