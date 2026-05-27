// oss-loop — competitive landscape discovery loop.
// Runs repeated OSS discovery passes, seeded from the competitive matrix, until
// no new repos are found for N consecutive passes (plateau detection). Each pass
// targets the highest-gap dimensions first, uses LLM to find related OSS tools,
// clones them, and registers them. Ends with oss-sync to guarantee everything
// declared in the matrix is actually on disk.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { withProgress } from '../../core/progress-indicator.js';
import { loadMatrix, computeGapPriority } from '../../core/compete-matrix.js';
import {
  loadRegistry,
  saveRegistry,
  filterNewRepos,
  upsertEntry,
} from '../../core/oss-registry.js';
import { getOssCacheRepoDir, ensureCacheRoot } from '../../core/oss-cache.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { classifyLicense, type LicenseStatus } from '../../core/oss-researcher.js';
import { ossSync } from './oss-sync.js';
import {
  loadTitanRegistry,
  saveTitanRegistry,
  isTitanKnown,
  titanKnownUrls,
  upsertTitanEntry,
} from '../../core/titan-registry.js';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OssLoopOptions {
  cwd?: string;
  /**
   * JSON file produced by a host AI (Codex/Claude/etc.) with candidate repos.
   * When set, oss-loop skips configured CLI LLM calls entirely and uses this
   * file as the discovery source.
   */
  discoveryFile?: string;
  /** Stop after this many consecutive passes that find 0 new repos (default 3) */
  plateauPasses?: number;
  /** Hard cap on total passes regardless of plateau (default 20) */
  maxPasses?: number;
  /** Max new repos to clone per pass (default 5) */
  maxReposPerPass?: number;
  /** Run oss-sync at the end to restore any missing repos (default true) */
  syncAtEnd?: boolean;
  /** Show plan without cloning */
  dryRun?: boolean;
  /** Injection seams */
  _discover?: (query: string, knownUrls: Set<string>) => Promise<Array<{ name: string; url: string; reason: string }>>;
  _clone?: (url: string, dest: string) => Promise<boolean>;
  _classifyLicense?: (content: string) => string | { status: LicenseStatus; name: string };
}

export interface OssLoopPassResult {
  pass: number;
  discovered: number;
  cloned: string[];
  failed: string[];
  titanQueued: string[];
}

export interface OssLoopResult {
  passes: OssLoopPassResult[];
  totalDiscovered: number;
  totalTitanQueued: number;
  plateauReached: boolean;
  finalRegistryCount: number;
}

const CLONE_TIMEOUT_MS = 180_000;

// ── Discovery via LLM ─────────────────────────────────────────────────────────

const DISCOVERY_PROMPT = (context: string, knownList: string) => `
You are an expert OSS researcher finding open-source tools competitive with this project.

PROJECT CONTEXT:
${context}

ALREADY KNOWN (do NOT suggest these again):
${knownList}

Find up to 8 OSS projects that:
1. Solve the same problem for the same user
2. Have permissive licenses (MIT, Apache-2.0, BSD) — NO GPL/AGPL
3. Have a public GitHub repo
4. Are NOT already in the known list above

Return ONLY valid JSON, no explanation:
{
  "repos": [
    { "name": "repo-name", "url": "https://github.com/org/repo", "reason": "one sentence why relevant" }
  ]
}
`.trim();

async function defaultDiscover(
  context: string,
  knownUrls: Set<string>,
): Promise<Array<{ name: string; url: string; reason: string }>> {
  const knownList = knownUrls.size > 0 ? [...knownUrls].join('\n') : '(none yet)';
  const prompt = DISCOVERY_PROMPT(context, knownList);

  try {
    const raw = await callLLM(prompt);
    const parsed = JSON.parse(raw.trim()) as { repos?: Array<{ name: string; url: string; reason: string }> };
    return (parsed.repos ?? []).filter(r => r.url?.startsWith('https://github.com/'));
  } catch {
    return [];
  }
}

function isCandidateRecord(value: unknown): value is { name?: unknown; url?: unknown; reason?: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDiscoveryPayload(raw: unknown): Array<{ name: string; url: string; reason: string }> {
  const repos = Array.isArray(raw)
    ? raw
    : (typeof raw === 'object' && raw !== null && Array.isArray((raw as { repos?: unknown }).repos))
      ? (raw as { repos: unknown[] }).repos
      : [];

  return repos
    .filter(isCandidateRecord)
    .map((repo) => {
      const url = typeof repo.url === 'string' ? repo.url.trim().replace(/\/+$/, '') : '';
      const fallbackName = url.split('/').filter(Boolean).pop() ?? 'unknown';
      return {
        name: typeof repo.name === 'string' && repo.name.trim() ? repo.name.trim() : fallbackName,
        url,
        reason: typeof repo.reason === 'string' && repo.reason.trim()
          ? repo.reason.trim()
          : 'host-discovered candidate',
      };
    })
    .filter(repo => repo.url.startsWith('https://github.com/'));
}

function makeDiscoveryFileDiscover(
  discoveryFile: string,
  cwd: string,
): () => Promise<Array<{ name: string; url: string; reason: string }>> {
  return async () => {
    const filePath = path.isAbsolute(discoveryFile)
      ? discoveryFile
      : path.join(cwd, discoveryFile);
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeDiscoveryPayload(JSON.parse(raw));
  };
}

function normalizeLicenseResult(result: string | { status: LicenseStatus; name: string }): { status: LicenseStatus; name: string } {
  if (typeof result === 'string') {
    return {
      status: result === 'blocked' ? 'blocked' : result === 'unknown' ? 'unknown' : 'allowed',
      name: result,
    };
  }
  return result;
}

async function cloneRepo(url: string, dest: string): Promise<boolean> {
  try {
    await ensureCacheRoot();
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', url, dest], {
      timeout: CLONE_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    logger.warn(`[oss-loop] Clone failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function readLicenseText(repoDir: string): Promise<string> {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING']) {
    try { return await fs.readFile(path.join(repoDir, name), 'utf8'); } catch { /* next */ }
  }
  return '';
}

// ── Build context string from matrix ─────────────────────────────────────────

async function buildMatrixContext(cwd: string): Promise<string> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return 'No matrix found.';

  const topDims = [...matrix.dimensions]
    .filter(d => d.gap_to_leader > 0)
    .sort((a, b) => computeGapPriority(b) - computeGapPriority(a))
    .slice(0, 8);

  const lines = [
    `Project: ${matrix.project}`,
    `Known OSS competitors: ${(matrix.competitors_oss ?? []).join(', ') || 'none yet'}`,
    '',
    'Top capability gaps (dimensions where we lag OSS tools most):',
    ...topDims.map(d => `  - ${d.label}: gap ${d.gap_to_oss_leader.toFixed(1)} behind ${d.oss_leader} (harvest: ${d.harvest_source ?? 'unknown'})`),
  ];

  return lines.join('\n');
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function ossLoop(options: OssLoopOptions = {}): Promise<OssLoopResult> {
  const cwd = options.cwd ?? process.cwd();
  const plateauThreshold = options.plateauPasses ?? 3;
  const maxPasses = options.maxPasses ?? 20;
  const maxReposPerPass = options.maxReposPerPass ?? 5;
  const syncAtEnd = options.syncAtEnd ?? true;
  const dryRun = options.dryRun ?? false;

  const usesHostDiscoveryFile = Boolean(options.discoveryFile);
  const usesInjectedDiscovery = Boolean(options._discover) || usesHostDiscoveryFile;
  const discover = options._discover
    ?? (options.discoveryFile ? makeDiscoveryFileDiscover(options.discoveryFile, cwd) : defaultDiscover);
  const clone = options._clone ?? cloneRepo;
  const licenseClassify = options._classifyLicense ?? classifyLicense;

  const result: OssLoopResult = {
    passes: [],
    totalDiscovered: 0,
    totalTitanQueued: 0,
    plateauReached: false,
    finalRegistryCount: 0,
  };

  // LLM availability check. Host-native execution supplies discoveryFile, so
  // Codex/Claude can do research in-session and the CLI only handles downloads.
  const llmAvailable = usesInjectedDiscovery ? true : await isLLMAvailable();
  if (!llmAvailable) {
    logger.warn('[oss-loop] No LLM available — discovery requires an LLM. Configure one with `danteforge config`.');
    logger.info('[oss-loop] Running oss-sync to restore any missing repos from registry...');
    await ossSync({ cwd, update: false });
    return result;
  }
  if (usesHostDiscoveryFile) {
    logger.info(`[oss-loop] Using host discovery file: ${options.discoveryFile}`);
    logger.info('[oss-loop] Skipping configured CLI LLM provider; host AI supplied candidate repos.');
  }

  logger.info('[oss-loop] Building project context from competitive matrix...');
  const context = await buildMatrixContext(cwd);
  logger.info(`[oss-loop] Context:\n${context}`);

  let consecutivePlateau = 0;

  for (let pass = 1; pass <= maxPasses; pass++) {
    logger.info(`\n[oss-loop] ── Pass ${pass}/${maxPasses} ──────────────────────────────`);

    const registry = await loadRegistry(cwd);
    const titanRegistry = await loadTitanRegistry(cwd);
    // Include titan-queued URLs so the LLM stops re-suggesting GPL repos each pass
    const knownUrls = new Set([
      ...registry.repos.map(r => r.url.toLowerCase()),
      ...titanKnownUrls(titanRegistry),
    ]);

    logger.info(`[oss-loop] Registry has ${registry.repos.length} permissive + ${titanRegistry.repos.length} titan-queued repos. Discovering more...`);

    const candidates = await discover(context, knownUrls);
    const newCandidates = filterNewRepos(candidates, registry).slice(0, maxReposPerPass);

    if (newCandidates.length === 0) {
      consecutivePlateau++;
      logger.info(`[oss-loop] No new repos found (plateau ${consecutivePlateau}/${plateauThreshold}).`);
      if (consecutivePlateau >= plateauThreshold) {
        logger.info('[oss-loop] PLATEAU REACHED — competitive landscape is complete.');
        result.plateauReached = true;
        result.passes.push({ pass, discovered: 0, cloned: [], failed: [], titanQueued: [] });
        break;
      }
      result.passes.push({ pass, discovered: 0, cloned: [], failed: [], titanQueued: [] });
      continue;
    }

    consecutivePlateau = 0;
    logger.info(`[oss-loop] Found ${newCandidates.length} new candidate(s):`);
    for (const c of newCandidates) {
      logger.info(`  • ${c.name} — ${c.url} (${c.reason})`);
    }

    const passResult: OssLoopPassResult = { pass, discovered: newCandidates.length, cloned: [], failed: [], titanQueued: [] };

    for (const candidate of newCandidates) {
      const slug = candidate.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      const dest = getOssCacheRepoDir(slug, cwd);

      // Check cache hit
      let onDisk = false;
      try { await fs.access(path.join(dest, '.git')); onDisk = true; } catch { /* not cached */ }

      if (dryRun) {
        logger.info(`[oss-loop] [dry-run] Would clone ${candidate.url} → ${dest}`);
        passResult.cloned.push(candidate.name);
        continue;
      }

      if (!onDisk) {
        const ok = await withProgress(`Cloning ${candidate.name}`, async (progress) => {
          const cloned = await clone(candidate.url, dest);
          if (cloned) progress.succeed(`Cloned ${candidate.name}`);
          else progress.fail(`Failed to clone ${candidate.name}`);
          return cloned;
        });
        if (!ok) {
          passResult.failed.push(candidate.name);
          continue;
        }
      }

      // Read license and classify
      const licenseText = onDisk ? '' : await readLicenseText(dest);
      const license = normalizeLicenseResult(licenseClassify(licenseText));

      if (license.status === 'blocked') {
        // Route to titan registry for clean-room harvest instead of silently discarding
        const titanReg = await loadTitanRegistry(cwd);
        if (!isTitanKnown(candidate.url, titanReg)) {
          upsertTitanEntry(titanReg, {
            name: candidate.name,
            url: candidate.url,
            license: license.name,
            discoveredAt: new Date().toISOString(),
            harvestStatus: 'pending',
            harvestAttempts: 0,
            patternsCount: 0,
          });
          await saveTitanRegistry(titanReg, cwd);
          logger.info(`[oss-loop] ↪ "${candidate.name}" (${license.name}) — queued for clean-room titan harvest.`);
          passResult.titanQueued.push(candidate.name);
          result.totalTitanQueued++;
        } else {
          logger.info(`[oss-loop] "${candidate.name}" already in titan queue — skipping.`);
        }
        // Always remove the short-lived clone (GPL code stays off disk)
        try { await fs.rm(dest, { recursive: true, force: true }); } catch { /* best-effort */ }
        continue;
      }

      // Register
      const updatedRegistry = await loadRegistry(cwd);
      upsertEntry(updatedRegistry, {
        name: candidate.name,
        url: candidate.url,
        license: license.name,
        status: 'active',
        clonedAt: new Date().toISOString(),
        lastLearnedAt: new Date().toISOString(),
        patternsCount: 0,
        storagePath: dest,
        patterns: [],
      });
      await saveRegistry(updatedRegistry, cwd);

      passResult.cloned.push(candidate.name);
      result.totalDiscovered++;
      logger.info(`[oss-loop] ✓ Cloned and registered "${candidate.name}" (${license.name})`);
    }

    result.passes.push(passResult);
    logger.info(`[oss-loop] Pass ${pass} complete: ${passResult.cloned.length} cloned, ${passResult.failed.length} failed.`);
  }

  // Final sync — ensure all matrix oss_leaders are on disk
  if (syncAtEnd && !dryRun) {
    logger.info('\n[oss-loop] Running oss-sync to restore any matrix-required repos missing from disk...');
    await ossSync({ cwd, update: false });
  }

  const finalRegistry = await loadRegistry(cwd);
  result.finalRegistryCount = finalRegistry.repos.length;

  logger.info('\n[oss-loop] ─────────────────────────────────────────────────');
  logger.info(`[oss-loop] Passes run:        ${result.passes.length}`);
  logger.info(`[oss-loop] New repos found:   ${result.totalDiscovered} (permissive)`);
  logger.info(`[oss-loop] Titan queued:      ${result.totalTitanQueued} (GPL/AGPL → clean-room harvest)`);
  logger.info(`[oss-loop] Registry total:    ${result.finalRegistryCount} repos`);
  logger.info(`[oss-loop] Plateau reached:   ${result.plateauReached ? 'YES — landscape is complete' : 'NO — hit pass limit'}`);
  if (!result.plateauReached) {
    logger.info('[oss-loop] → Re-run with --max-passes <n> to continue discovery.');
  }
  if (result.totalTitanQueued > 0) {
    logger.info(`[oss-loop] → Run \`danteforge titan-harvest-loop\` to analyze ${result.totalTitanQueued} queued GPL/AGPL repo(s) via clean-room protocol.`);
  }
  logger.info('[oss-loop] ─────────────────────────────────────────────────');
  logger.info('[oss-loop] Next: run `danteforge oss-intel` to extract patterns from all cloned repos.');

  return result;
}
