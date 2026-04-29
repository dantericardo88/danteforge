// Proof-anchor Pass 12 OSS harvest (openhuman + evomap).
//
// Reads the two pattern docs + their registry entries, computes content hashes,
// and emits a proof-anchored harvest manifest at .danteforge/evidence/oss-harvest-pass-12.json.
// The manifest can be verified via `danteforge proof --verify <path>`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

function readUtf8(rel) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`Required harvest input missing: ${rel}`);
  return readFileSync(abs, 'utf-8');
}

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch { return null; }
}

const openhumanPatternsRel = '.danteforge/OSS_HARVEST/openhuman_patterns.md';
const evomapPatternsRel = '.danteforge/OSS_HARVEST/evomap_patterns.md';
const registryRel = '.danteforge/oss-registry.json';

const openhumanContent = readUtf8(openhumanPatternsRel);
const evomapContent = readUtf8(evomapPatternsRel);
const registryContent = readUtf8(registryRel);
const registry = JSON.parse(registryContent);

const harvest = {
  schemaVersion: 1,
  pass: 12,
  passName: 'OpenHuman + EvoMap Harvest (proof-anchored)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),
  registryVersion: registry.version,
  prdMapping: 'PRD-MASTER §9.1 entries #22 + #23 — flips from pattern_harvest_pending to pattern_harvest_only_no_integration after license verification (both GPL-3.0).',
  entries: [
    {
      registryKey: 'openhuman',
      url: registry.entries.openhuman.url,
      license: registry.entries.openhuman.license,
      licenseGate: registry.entries.openhuman.licenseGate,
      harvestStatus: registry.entries.openhuman.harvestStatus,
      patternsFile: openhumanPatternsRel,
      patternsFileHash: sha256(openhumanContent),
      patternCount: registry.entries.openhuman.patternCount,
      patternsExtracted: registry.entries.openhuman.patternsExtracted,
      dimensionOverlap: registry.entries.openhuman.dimensionOverlap,
    },
    {
      registryKey: 'evomap',
      url: registry.entries.evomap.url,
      license: registry.entries.evomap.license,
      licenseGate: registry.entries.evomap.licenseGate,
      harvestStatus: registry.entries.evomap.harvestStatus,
      patternsFile: evomapPatternsRel,
      patternsFileHash: sha256(evomapContent),
      patternCount: registry.entries.evomap.patternCount,
      patternsExtracted: registry.entries.evomap.patternsExtracted,
      dimensionOverlap: registry.entries.evomap.dimensionOverlap,
      constitutionalArticleCandidate: registry.entries.evomap.constitutionalArticleCandidate,
    },
  ],
  registryFileHash: sha256(registryContent),
  articleX: 'Article X compliance verified: both repos read for pattern extraction only (README + ARCHITECTURE.md). No GPL code is copied. No GPL dependency is added. All Dante implementation guidance is clean-room TypeScript design.',
};

harvest.proof = createEvidenceBundle({
  bundleId: 'pass_12_oss_harvest',
  gitSha: harvest.gitSha,
  evidence: [{ ...harvest }],
  createdAt: harvest.generatedAt,
});

const outPath = resolve(evidenceDir, 'oss-harvest-pass-12.json');
writeFileSync(outPath, JSON.stringify(harvest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored harvest manifest: ${outPath}`);
console.log(`  openhuman patterns hash: ${harvest.entries[0].patternsFileHash.slice(0, 16)}...`);
console.log(`  evomap patterns hash:    ${harvest.entries[1].patternsFileHash.slice(0, 16)}...`);
console.log(`  registry hash:           ${harvest.registryFileHash.slice(0, 16)}...`);
console.log(`  proof bundle id:         ${harvest.proof.bundleId}`);
console.log(`  proof payload hash:      ${harvest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:       ${harvest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:                 ${harvest.gitSha?.slice(0, 8) ?? 'none'}`);
