// OSS Intel — multi-repo systematic harvest that manages the harvest queue
// and produces .danteforge/ADOPTION_QUEUE.md.
// Three modes: LLM execute / --prompt (print plan) / local fallback.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import {
  loadHarvestQueue,
  saveHarvestQueue,
  addToQueue,
  popHighestPriority,
  markRepoStatus,
  updateGapCoverage,
  computePriority,
  isRepoStale,
  type HarvestQueue,
  type HarvestGap,
} from '../../core/harvest-queue.js';
import { ossDeep, type OssDeepOptions, type DeepHarvestResult, type DeepPattern } from './oss-deep.js';
import { queryLibrary, publishToLibrary } from '../../core/global-pattern-library.js';
import { scanPatterns } from '../../core/pattern-security-scanner.js';
import { buildGraphFromPatterns, detectClusters, computeClusterBonus } from '../../core/pattern-graph.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GapScore {
  dimension: string;
  score: number;
  target: number;
}

export interface AdoptionCandidate {
  patternName: string;
  category: string;
  sourceRepo: string;
  referenceImplementation: string;
  whatToBuild: string;
  filesToModify: string[];
  estimatedEffort: '1h' | '4h' | '1d' | '3d';
  unlocksGapClosure: string[];
  adoptionScore: number;  // (impact × confidence) / complexityWeight
}

export interface OssIntelOptions {
  cwd?: string;
  /** Max repos to deep-extract in this run (default 5) */
  maxRepos?: number;
  /** Run cross-repo synthesis every N repos (default 3) */
  crossSynthesisEvery?: number;
  promptMode?: boolean;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  /** Override gap score retrieval — returns dimension scores sorted by gap desc */
  _getGapScores?: () => Promise<GapScore[]>;
  /** Override oss-deep call — used in tests */
  _deepExtract?: (url: string, opts?: OssDeepOptions) => Promise<DeepHarvestResult>;
  _loadQueue?: (cwd?: string) => Promise<HarvestQueue>;
  _saveQueue?: (queue: HarvestQueue, cwd?: string) => Promise<void>;
  /**
   * Pattern names already adopted in prior harvest-forge cycles.
   * Prepended to the adoption planning LLM prompt to prevent re-suggestion.
   */
  _adoptedPatterns?: string[];
  /**
   * Yield predictor — returns a 0-1 predicted adoption rate for a repo URL.
   * Sprint B wires repo-yield-model.ts here. Returns 1.0 (neutral) until history exists.
   */
  _predictYield?: (repoUrl: string) => Promise<number>;
  /** Override global library query — used in tests */
  _queryLibrary?: typeof queryLibrary;
  /** Override global library publish — used in tests (best-effort, never throws) */
  _publishToLibrary?: typeof publishToLibrary;
  /** Disable global library integration (default false) */
  disableGlobalLibrary?: boolean;
  /** Disable pattern security scanning (default false) */
  disableSecurityScan?: boolean;
  /** Disable constellation engine (default false) */
  disableConstellations?: boolean;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Wave 1: Universe scan / gap scores ────────────────────────────────────────

async function defaultGetGapScores(
  cwd?: string,
  llm?: (p: string) => Promise<string>,
): Promise<GapScore[]> {
  // Try to read from last assessment scores
  try {
    const scoresPath = path.join(getDanteforgeDir(cwd), 'feature-scores.json');
    const raw = await fs.readFile(scoresPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, number>;
    return Object.entries(parsed).map(([dimension, score]) => ({
      dimension,
      score,
      target: 9.0,
    }));
  } catch { /* no scores file — use LLM */ }

  if (!llm) return [];

  try {
    const prompt = `List the top 8 software quality dimensions for an AI-powered developer CLI tool.
For each dimension, give a short name (e.g. "circuit-breaker-reliability") and a realistic starting score 1-7.
Respond with ONLY JSON: [{"dimension":"...","score":4.5,"target":9.0}, ...]`;
    const response = await llm(prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as GapScore[];
  } catch { /* fall through */ }

  return [];
}

// ── Wave 1: Repo discovery per gap ───────────────────────────────────────────

async function findReposForGap(
  gap: GapScore,
  queue: HarvestQueue,
  llm: (p: string) => Promise<string>,
): Promise<Array<{ url: string; quality: number }>> {
  const existing = new Set(queue.repos.map(r => r.url.toLowerCase()));

  const prompt = `Find 3 high-quality OSS GitHub repositories that directly address the software quality dimension: "${gap.dimension}".

Requirements:
- Stars > 500, actively maintained (commits within 6 months)
- Permissive license (MIT, Apache-2.0, BSD, ISC)
- TypeScript or JavaScript preferred (but not required)
- Specifically strong in: ${gap.dimension}

Respond with ONLY JSON:
[{"url":"https://github.com/owner/repo","quality":8},...]
(quality is 1-10 based on how well it addresses ${gap.dimension})`;

  try {
    const response = await llm(prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const candidates = JSON.parse(jsonMatch[0]) as Array<{ url: string; quality: number }>;
    return candidates.filter(c => !existing.has(c.url.toLowerCase()));
  } catch {
    return [];
  }
}

// ── Wave 3: Cross-repo synthesis ──────────────────────────────────────────────

async function runCrossRepoSynthesis(
  allPatterns: DeepPattern[],
  cwd: string,
  llm: (p: string) => Promise<string>,
): Promise<void> {
  if (allPatterns.length === 0) return;

  // Group patterns by name to find cross-repo patterns
  const byName = new Map<string, number>();
  for (const p of allPatterns) {
    byName.set(p.patternName, (byName.get(p.patternName) ?? 0) + 1);
  }
  const proven = [...byName.entries()]
    .filter(([, count]) => count >= 3)
    .map(([name]) => name);

  const prompt = `You are synthesizing patterns found across multiple OSS repositories.

ALL EXTRACTED PATTERNS (${allPatterns.length} total):
${allPatterns.map(p => `- ${p.patternName} (${p.category}, confidence ${p.confidence})`).join('\n')}

PATTERNS APPEARING IN 3+ REPOS (proven best practices):
${proven.length > 0 ? proven.join(', ') : '(none yet)'}

Synthesize:
1. Which patterns are PROVEN best practices (3+ repos) → adopt immediately
2. Which patterns are INNOVATIONS (1 repo, high confidence) → evaluate carefully
3. Which patterns CONFLICT → present tradeoffs

Respond with a markdown report titled "## Cross-Repo Pattern Synthesis".`;

  try {
    const report = await llm(prompt);
    const danteforgeDir = getDanteforgeDir(cwd);
    await fs.mkdir(danteforgeDir, { recursive: true });
    const synthesisPath = path.join(danteforgeDir, 'SYNTHESIS_REPORT.md');
    await fs.writeFile(synthesisPath, report, 'utf8');
    logger.info(`[oss-intel] Synthesis report written → ${synthesisPath}`);
  } catch (err) {
    logger.warn(`[oss-intel] Synthesis failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildAdoptionPrompt(allPatterns: DeepPattern[], gaps: GapScore[], adoptedPatterns: string[]): string {
  const alreadyAdoptedSection = adoptedPatterns.length > 0
    ? `\nALREADY ADOPTED IN PRIOR CYCLES (do NOT re-suggest these):\n${adoptedPatterns.map(p => `- ${p}`).join('\n')}\n`
    : '';
  return `You are creating an adoption plan from extracted OSS patterns.${alreadyAdoptedSection}

AVAILABLE PATTERNS:
${allPatterns.slice(0, 30).map(p =>
  `- ${p.patternName} (${p.category}, ${p.adoptionComplexity} effort, confidence ${p.confidence}/10)
  Why: ${p.whyItWorks}`,
).join('\n')}

CURRENT GAPS TO CLOSE: ${gaps.map(g => g.dimension).join(', ')}

For each of the TOP 10 patterns (ranked by impact × confidence / adoption_complexity):
Provide an adoption spec. Respond with ONLY JSON array:
[{
  "patternName": "...",
  "category": "...",
  "sourceRepo": "...",
  "referenceImplementation": "...",
  "whatToBuild": "1-2 sentence description",
  "filesToModify": ["src/core/...", "..."],
  "estimatedEffort": "1h|4h|1d|3d",
  "unlocksGapClosure": ["dimension1", "dimension2"]
}]`;
}

// ── Wave 4: Adoption planning ─────────────────────────────────────────────────

async function buildAdoptionQueue(
  allPatterns: DeepPattern[],
  gaps: GapScore[],
  cwd: string,
  llm: (p: string) => Promise<string>,
  adoptedPatterns: string[] = [],
  opts?: Pick<OssIntelOptions, 'disableSecurityScan' | 'disableConstellations'>,
): Promise<AdoptionCandidate[]> {
  if (allPatterns.length === 0) return [];

  const complexityWeight = { low: 1, medium: 3, high: 8 };
  const prompt = buildAdoptionPrompt(allPatterns, gaps, adoptedPatterns);

  let candidates: Omit<AdoptionCandidate, 'adoptionScore'>[] = [];
  try {
    const response = await llm(prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) candidates = JSON.parse(jsonMatch[0]);
  } catch {
    // Deterministic fallback: rank by confidence / complexity
    candidates = allPatterns
      .slice(0, 10)
      .map(p => ({
        patternName: p.patternName,
        category: p.category,
        sourceRepo: p.sourceFile,
        referenceImplementation: p.implementationSnippet,
        whatToBuild: `Implement ${p.patternName}: ${p.whyItWorks}`,
        filesToModify: [],
        estimatedEffort: p.adoptionComplexity === 'low' ? '1h' : p.adoptionComplexity === 'medium' ? '4h' : '1d',
        unlocksGapClosure: [p.category],
      })) as Omit<AdoptionCandidate, 'adoptionScore'>[];
  }

  let scored: AdoptionCandidate[] = candidates.map(c => ({
    ...c,
    adoptionScore: Math.round(
      (8 * (allPatterns.find(p => p.patternName === c.patternName)?.confidence ?? 5)) /
      complexityWeight[c.estimatedEffort === '1h' ? 'low' : c.estimatedEffort === '4h' ? 'medium' : 'high'],
    ),
  })).sort((a, b) => b.adoptionScore - a.adoptionScore);

  // Sprint C-2D: Scan patterns for security concerns (advisory only — never blocks)
  if (!opts?.disableSecurityScan) {
    try {
      const scanResults = scanPatterns(
        scored.map(c => ({ patternName: c.patternName, implementationSnippet: c.referenceImplementation }))
      );
      const withConcerns = scanResults.filter(r => r.concerns.length > 0);
      if (withConcerns.length > 0) {
        logger.warn(`[oss-intel] Security scan: ${withConcerns.length} patterns have concerns (advisory only)`);
        for (const r of withConcerns) {
          logger.warn(`[oss-intel]   ${r.patternName}: ${r.recommendation} (${r.concerns.map(c => c.type).join(', ')})`);
        }
      }
    } catch {
      // Best-effort scan
    }
  }

  // Sprint B-1A: Build pattern constellation graph and surface co-adoption clusters
  if (!opts?.disableConstellations) {
    try {
      const graph = buildGraphFromPatterns(
        allPatterns.map(p => ({ patternName: p.patternName, category: p.category }))
      );
      const clusters = detectClusters(graph);
      if (clusters.length > 0) {
        logger.info(`[oss-intel] Pattern constellations detected: ${clusters.length} clusters`);
        // Boost adoption scores for patterns in clusters
        for (const candidate of scored) {
          const bonus = computeClusterBonus(
            candidate.patternName,
            graph,
            adoptedPatterns
          );
          if (bonus > 1.0) {
            candidate.adoptionScore = candidate.adoptionScore * bonus;
            logger.info(`[oss-intel]   ${candidate.patternName} cluster bonus: ${bonus}×`);
          }
        }
        // Re-sort after bonus application
        scored.sort((a, b) => b.adoptionScore - a.adoptionScore);
      }
    } catch {
      // Best-effort
    }
  }

  return scored;
}

async function writeAdoptionQueue(candidates: AdoptionCandidate[], cwd: string): Promise<void> {
  const lines = [
    '# Adoption Queue\n',
    `> Generated: ${new Date().toISOString()}`,
    `> ${candidates.length} candidates ranked by adoption score\n`,
    '---\n',
  ];

  candidates.forEach((c, i) => {
    lines.push(`## ${i + 1}. ${c.patternName} (score: ${c.adoptionScore})`);
    lines.push(`**Category**: ${c.category} | **Effort**: ${c.estimatedEffort} | **Source**: ${c.sourceRepo}\n`);
    lines.push(`**What to build**: ${c.whatToBuild}\n`);
    if (c.filesToModify.length > 0) {
      lines.push(`**Files to modify**: ${c.filesToModify.join(', ')}\n`);
    }
    if (c.unlocksGapClosure.length > 0) {
      lines.push(`**Closes gaps**: ${c.unlocksGapClosure.join(', ')}\n`);
    }
    if (c.referenceImplementation) {
      lines.push('**Reference implementation**:');
      lines.push('```');
      lines.push(c.referenceImplementation.slice(0, 300));
      lines.push('```\n');
    }
    lines.push('---\n');
  });

  const danteforgeDir = getDanteforgeDir(cwd);
  await fs.mkdir(danteforgeDir, { recursive: true });
  const queuePath = path.join(danteforgeDir, 'ADOPTION_QUEUE.md');
  await fs.writeFile(queuePath, lines.join('\n'), 'utf8');
  logger.info(`[oss-intel] ADOPTION_QUEUE.md written → ${queuePath}`);
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export async function ossIntel(opts: OssIntelOptions = {}): Promise<void> {
  try {
    const cwd = opts.cwd ?? process.cwd();
    const maxRepos = opts.maxRepos ?? 5;
    const crossSynthesisEvery = opts.crossSynthesisEvery ?? 3;

    // ── Prompt mode ────────────────────────────────────────────────────────
    if (opts.promptMode) {
      const plan = `# OSS Intel Systematic Harvest Plan

## Wave 1 — Universe scan
- Read feature-scores.json or use LLM to derive gap scores
- Sort dimensions by (targetScore - currentScore) descending
- For each top 5 gap: find 3 OSS repos via LLM

## Wave 2 — Deep harvest loop (max ${maxRepos} repos)
- Pop highest-priority repo from harvest-queue.json
- Run oss-deep on it → patterns.json + DEEP_HARVEST.md
- Update harvest-queue.json priority scores
- Cross-repo synthesis every ${crossSynthesisEvery} repos

## Wave 3 — Adoption planning
- Rank patterns by (impact × confidence) / adoptionComplexity
- Write ADOPTION_QUEUE.md with implementation specs

## Outputs
- .danteforge/harvest-queue.json (updated)
- .danteforge/oss-deep/{slug}/  (per repo)
- .danteforge/SYNTHESIS_REPORT.md
- .danteforge/ADOPTION_QUEUE.md
`;
      logger.info(plan);
      return;
    }

    const llmAvailable = opts._isLLMAvailable
      ? await opts._isLLMAvailable()
      : await isLLMAvailable();

    const llm = opts._llmCaller ?? (llmAvailable ? callLLM : null);

    // ── Wave 1: Get gap scores ─────────────────────────────────────────────
    logger.info('[oss-intel] Wave 1: Getting gap scores...');
    const gapScores = opts._getGapScores
      ? await opts._getGapScores()
      : await defaultGetGapScores(cwd, llm ?? undefined);

    const sortedGaps = [...gapScores].sort((a, b) => (b.target - b.score) - (a.target - a.score));
    logger.info(`[oss-intel] Found ${sortedGaps.length} gaps. Worst: ${sortedGaps[0]?.dimension ?? 'none'}`);

    // ── Wave 1: Populate harvest queue ────────────────────────────────────
    let queue = await (opts._loadQueue ?? loadHarvestQueue)(cwd);

    if (llm) {
      for (const gap of sortedGaps.slice(0, 5)) {
        const candidates = await findReposForGap(gap, queue, llm);
        for (const candidate of candidates) {
          const priority = computePriority(
            {
              dimension: gap.dimension,
              currentScore: gap.score,
              targetScore: gap.target,
              patternsAvailable: 0,
              patternsAdopted: 0,
            } satisfies HarvestGap,
            candidate.quality,
          );
          queue = addToQueue(queue, {
            url: candidate.url,
            slug: candidate.url.split('/').pop()?.replace(/\.git$/, '') ?? 'unknown',
            priority,
            gapTargets: [gap.dimension],
            status: 'queued',
          });
        }
      }
    }

    // Update gap coverage in queue
    for (const gap of gapScores) {
      queue = updateGapCoverage(queue, gap.dimension, gap.score);
    }

    // ── Wave 2: Deep harvest loop ─────────────────────────────────────────
    logger.info(`[oss-intel] Wave 2: Deep harvest loop (max ${maxRepos} repos)`);
    const deepExtract = opts._deepExtract ?? ossDeep;

    // Sprint B-1C: Query global pattern library to pre-populate patterns before deep extraction
    let libraryPatterns: DeepPattern[] = [];
    if (!opts.disableGlobalLibrary) {
      try {
        const queryLib = opts._queryLibrary ?? queryLibrary;
        const libEntries = await queryLib({ limit: 20 });
        libraryPatterns = libEntries.map(e => ({
          patternName: e.patternName,
          category: e.category as DeepPattern['category'],
          implementationSnippet: e.implementationSnippet,
          whyItWorks: e.whyItWorks,
          adoptionComplexity: e.adoptionComplexity,
          sourceFile: 'global-library',
          confidence: Math.round((e.avgRoi ?? 0.5) * 10),
        }));
        if (libraryPatterns.length > 0) {
          logger.info(`[oss-intel] Loaded ${libraryPatterns.length} patterns from global library`);
        }
      } catch {
        // Best-effort: never fail if library is unavailable
      }
    }

    const allPatterns: DeepPattern[] = [...libraryPatterns];
    let harvestedCount = 0;
    const processedThisRun = new Set<string>();

    while (harvestedCount < maxRepos) {
      const [repo, updatedQueue] = popHighestPriority(queue);
      if (!repo) {
        logger.info('[oss-intel] Queue exhausted — no more repos to harvest');
        break;
      }
      queue = updatedQueue;

      // Sprint C-2E: Skip re-extraction for fresh repos that haven't changed.
      // Guard: only skip if not already processed in this run (popHighestPriority sets
      // lastHarvestedAt when popping, so same-run repos would appear fresh otherwise).
      if (!processedThisRun.has(repo.url) && !isRepoStale(repo) && repo.patternsExtracted > 0) {
        logger.info(`[oss-intel] Repo ${repo.slug} is fresh (harvested ${repo.lastHarvestedAt ? Math.floor((Date.now() - new Date(repo.lastHarvestedAt).getTime()) / 86400000) : 'recently'}d ago), reusing cached patterns`);
        // Still contribute cached patterns to allPatterns if any exist in the deep dir
        processedThisRun.add(repo.url);
        harvestedCount++;
        continue;
      }
      processedThisRun.add(repo.url);

      logger.info(`[oss-intel] Harvesting [${harvestedCount + 1}/${maxRepos}]: ${repo.url}`);
      try {
        const result = await deepExtract(repo.url, {
          cwd,
          _llmCaller: opts._llmCaller,
          _isLLMAvailable: opts._isLLMAvailable,
        });

        allPatterns.push(...result.patterns);
        const extracted = result.patterns.length;
        const adopted = repo.patternsAdopted;

        // Determine lifecycle status: exhausted when >80% of extracted patterns are adopted
        const nextStatus = extracted > 0 && adopted / extracted > 0.8 ? 'exhausted' : 'deep';
        queue = markRepoStatus(queue, repo.url, nextStatus);
        if (nextStatus === 'exhausted') {
          logger.info(`[oss-intel] Repo ${repo.slug} exhausted (${adopted}/${extracted} patterns adopted)`);
        }

        queue = {
          ...queue,
          totalPatternsExtracted: queue.totalPatternsExtracted + extracted,
          repos: queue.repos.map(r =>
            r.url === repo.url
              ? { ...r, patternsExtracted: extracted }
              : r,
          ),
        };

        // Recompute priorities for remaining queued repos using latest gap scores.
        // predictYield slot: multiply by yield factor (defaults to 1.0 until repo-yield-model
        // history exists — Sprint B wires the real value via _predictYield injection).
        const predictYield = opts._predictYield ?? (async () => 1.0);
        queue = {
          ...queue,
          repos: await Promise.all(queue.repos.map(async r => {
            if (r.status !== 'queued' && r.status !== 'shallow') return r;
            const primaryGapName = r.gapTargets[0];
            if (!primaryGapName) return r;
            const primaryGap = queue.gaps.find(g => g.dimension === primaryGapName);
            if (!primaryGap) return r;
            const yieldFactor = await predictYield(r.url).catch(() => 1.0);
            const basePriority = computePriority(primaryGap, r.priority);
            return { ...r, priority: Math.min(10, basePriority * yieldFactor) };
          })),
        };

        harvestedCount++;

        // Cross-repo synthesis every N repos
        if (harvestedCount % crossSynthesisEvery === 0 && llm) {
          logger.info('[oss-intel] Wave 3: Running cross-repo synthesis...');
          await runCrossRepoSynthesis(allPatterns, cwd, llm);
        }
      } catch (err) {
        logger.warn(`[oss-intel] Failed to harvest ${repo.url}: ${err instanceof Error ? err.message : String(err)}`);
        queue = markRepoStatus(queue, repo.url, 'queued');  // retry next time
      }
    }

    // Final cross-repo synthesis if not already run
    if (harvestedCount > 0 && harvestedCount % crossSynthesisEvery !== 0 && llm) {
      await runCrossRepoSynthesis(allPatterns, cwd, llm);
    }

    // Sprint B-1C: Publish extracted patterns to global library (best-effort)
    if (!opts.disableGlobalLibrary && allPatterns.length > 0) {
      try {
        const publishLib = opts._publishToLibrary ?? publishToLibrary;
        for (const pattern of allPatterns.slice(0, 50)) { // Limit to avoid huge writes
          await publishLib({
            patternName: pattern.patternName,
            category: pattern.category,
            implementationSnippet: pattern.implementationSnippet,
            whyItWorks: pattern.whyItWorks,
            adoptionComplexity: pattern.adoptionComplexity,
            sourceRepo: 'local-harvest',
            sourceProject: opts.cwd ?? process.cwd(),
          });
        }
      } catch {
        // Best-effort: never block harvest loop
      }
    }

    // ── Wave 4: Adoption planning ─────────────────────────────────────────
    logger.info('[oss-intel] Wave 4: Building adoption queue...');
    if (allPatterns.length > 0) {
      const candidates = await buildAdoptionQueue(allPatterns, sortedGaps, cwd, llm ?? (async () => '[]'), opts._adoptedPatterns ?? [], opts);
      await writeAdoptionQueue(candidates, cwd);
    } else {
      logger.info('[oss-intel] No patterns extracted — ADOPTION_QUEUE.md not written');
    }

    // Save updated queue
    await (opts._saveQueue ?? saveHarvestQueue)(queue, cwd);

    logger.info(`[oss-intel] Complete: ${harvestedCount} repos harvested, ${allPatterns.length} patterns extracted`);
  } catch (err) {
    logger.error(`[oss-intel] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
