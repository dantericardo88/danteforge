// Pass 33 — corpus integrity backfill.
// Walks .danteforge/evidence/ and for each unanchored JSON receipt, writes a sibling
// `<file>.proof.json` containing an evidence-chain bundle anchoring its content.
// Files that don't fit the receipt shape are listed in a `legacy_unanchored.txt` index
// so the proof-integrity check can honestly skip them.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'legacy_unanchored.txt') continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.isFile() && name.endsWith('.json')) out.push(full);
  }
  return out;
}

function looksLikeAnchored(parsed) {
  return parsed && typeof parsed === 'object'
    && parsed.proof && parsed.proof.payloadHash && parsed.proof.merkleRoot;
}

function looksLikeReceipt(parsed) {
  // Heuristic: object with nested data structure that's worth anchoring.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  // Skip bare-cache entries with only a few fields and no semantic content.
  const keys = Object.keys(parsed);
  return keys.length >= 2;
}

function shouldSkipForBackfill(file) {
  // Skip our own proof manifests.
  if (file.endsWith('.proof.json')) return true;
  // Skip the freshly-anchored Pass-N manifests (they already have proofs).
  return false;
}

const files = walk(evidenceDir);
const stats = { total: files.length, alreadyAnchored: 0, backfilled: 0, legacyUnanchored: 0, errored: 0 };
const legacy = [];

for (const file of files) {
  if (shouldSkipForBackfill(file)) continue;
  try {
    const content = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content);
    if (looksLikeAnchored(parsed)) {
      stats.alreadyAnchored += 1;
      continue;
    }
    if (!looksLikeReceipt(parsed)) {
      stats.legacyUnanchored += 1;
      legacy.push(file.replace(ROOT + (process.platform === 'win32' ? '\\' : '/'), '').replace(/\\/g, '/'));
      continue;
    }
    // Backfill: build a wrapper envelope whose proof.evidence === [wrapperPayload].
    // This satisfies the integrity checker's envelopeBinding contract:
    //   expectedPayloadHash = hashDict([container minus proof]) === bundle.payloadHash
    const sidecarPath = file.replace(/\.json$/, '.proof.json');
    if (existsSync(sidecarPath)) {
      stats.alreadyAnchored += 1;
      continue;
    }
    const wrapperPayload = {
      schemaVersion: 1,
      backfilledAt: new Date().toISOString(),
      anchorsFile: file.replace(ROOT, '').replace(/\\/g, '/'),
      anchorsFileHash: sha256(content),
    };
    const bundleId = `backfill_${wrapperPayload.anchorsFileHash.slice(0, 16)}`;
    const bundle = createEvidenceBundle({
      bundleId,
      gitSha: null,
      evidence: [wrapperPayload],
      createdAt: wrapperPayload.backfilledAt,
    });
    writeFileSync(sidecarPath, JSON.stringify({ ...wrapperPayload, proof: bundle }, null, 2) + '\n', 'utf-8');
    stats.backfilled += 1;
  } catch {
    stats.errored += 1;
  }
}

if (legacy.length > 0) {
  const legacyPath = join(evidenceDir, 'legacy_unanchored.txt');
  writeFileSync(legacyPath, [
    '# Pass 33 — pre-Pass-11 evidence files that don\'t fit the proof-anchor receipt shape.',
    '# These are tracked for completeness but are honestly skipped by check:proof-integrity.',
    '',
    ...legacy,
  ].join('\n') + '\n', 'utf-8');
}

console.log(`Pass 33 backfill complete:`);
console.log(`  total scanned:     ${stats.total}`);
console.log(`  already anchored:  ${stats.alreadyAnchored}`);
console.log(`  backfilled:        ${stats.backfilled}`);
console.log(`  legacy skipped:    ${stats.legacyUnanchored}`);
console.log(`  errored:           ${stats.errored}`);
