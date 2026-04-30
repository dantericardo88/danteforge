// Pass 37 — upgrade backfilled proof anchors with git-witness data.
// For each backfilled `<file>.proof.json` sidecar (Pass 33), find the most recent git commit
// that introduced/modified the anchored file. If `git show <sha>:<path>` matches the file's
// current content, record a `gitWitness: { commitSha, witnessedAt, contentMatches: true }`.
// Otherwise record `contentMatches: false` to flag local divergence.
//
// This converts "anchor-as-of-now" into "anchor-at-git-commit-time" — much stronger evidence
// because tampering would have to also have been in the git history to propagate cleanly.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import 'tsx/esm';

const { sha256, createEvidenceBundle } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.isFile() && name.endsWith('.proof.json')) out.push(full);
  }
  return out;
}

function gitLastTouchSha(repoRel) {
  // Returns the most recent git commit SHA that touched this path, or null if not tracked.
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%H', '--', repoRel], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function gitCommitDate(sha) {
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', sha], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function gitFileContent(sha, repoRel) {
  // Returns content at that commit or null if path not in tree.
  try {
    return execFileSync('git', ['show', `${sha}:${repoRel}`], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const sidecars = walk(evidenceDir);
const stats = {
  totalSidecars: sidecars.length,
  alreadyHasWitness: 0,
  upgradedWithMatch: 0,
  upgradedWithDivergence: 0,
  notTrackedInGit: 0,
  errored: 0,
};

for (const sidecarPath of sidecars) {
  try {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
    if (typeof sidecar.anchorsFile !== 'string' || typeof sidecar.anchorsFileHash !== 'string') {
      stats.errored += 1;
      continue;
    }
    // Always re-seal so the script is idempotent and fixes any prior broken bindings.
    // Resolve the anchored file's repo-relative path.
    const anchoredAbs = resolve(ROOT, sidecar.anchorsFile.replace(/^[/\\]/, ''));
    const repoRel = relative(ROOT, anchoredAbs).replace(/\\/g, '/');
    const lastTouchSha = gitLastTouchSha(repoRel);
    // Compute the gitWitness payload, then re-seal the bundle so envelope binding holds.
    let gitWitness;
    let gitWitnessNote;
    let outcome;
    if (!lastTouchSha) {
      gitWitness = null;
      gitWitnessNote = 'file is not tracked in git history (likely an untracked .danteforge artifact)';
      outcome = 'notTracked';
    } else {
      const witnessedAt = gitCommitDate(lastTouchSha);
      const gitContent = gitFileContent(lastTouchSha, repoRel);
      const gitContentHash = gitContent !== null ? sha256(gitContent) : null;
      const contentMatches = gitContentHash === sidecar.anchorsFileHash;
      gitWitness = { commitSha: lastTouchSha, witnessedAt, contentMatches, gitContentHash };
      outcome = contentMatches ? 'match' : 'divergence';
    }

    // Re-seal: the new wrapper payload (excluding proof) becomes the sole evidence entry,
    // and a fresh bundle is computed so envelope binding re-derives cleanly.
    const newWrapperPayload = {
      schemaVersion: sidecar.schemaVersion,
      backfilledAt: sidecar.backfilledAt,
      anchorsFile: sidecar.anchorsFile,
      anchorsFileHash: sidecar.anchorsFileHash,
      gitWitness,
      ...(gitWitnessNote ? { gitWitnessNote } : {}),
    };
    const reSealedBundle = createEvidenceBundle({
      bundleId: `backfill_git_witnessed_${sidecar.anchorsFileHash.slice(0, 16)}`,
      gitSha: gitWitness?.commitSha ?? null,
      evidence: [newWrapperPayload],
      createdAt: new Date().toISOString(),
    });
    writeFileSync(sidecarPath, JSON.stringify({ ...newWrapperPayload, proof: reSealedBundle }, null, 2) + '\n', 'utf-8');

    if (outcome === 'notTracked') stats.notTrackedInGit += 1;
    else if (outcome === 'match') stats.upgradedWithMatch += 1;
    else stats.upgradedWithDivergence += 1;
  } catch {
    stats.errored += 1;
  }
}

console.log(`Pass 37 git-witness upgrade complete:`);
console.log(`  total sidecars:           ${stats.totalSidecars}`);
console.log(`  already had witness:      ${stats.alreadyHasWitness}`);
console.log(`  upgraded (git matches):   ${stats.upgradedWithMatch}`);
console.log(`  upgraded (divergent):     ${stats.upgradedWithDivergence}`);
console.log(`  not tracked in git:       ${stats.notTrackedInGit}`);
console.log(`  errored:                  ${stats.errored}`);
const witnessed = stats.upgradedWithMatch + stats.upgradedWithDivergence + stats.alreadyHasWitness;
console.log(`  git-witnessed coverage:   ${witnessed}/${stats.totalSidecars} (${(witnessed / stats.totalSidecars * 100).toFixed(1)}%)`);
