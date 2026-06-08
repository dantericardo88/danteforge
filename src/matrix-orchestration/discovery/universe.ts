// Competitive Universe Discovery — Phase 1.2 of PRD-MATRIX-ORCHESTRATION-V1.
//
// Given a ProjectIntent, build a CompetitiveUniverse by aggregating across:
//   * GitHub search (injected via _githubSearch; no real network call in v1)
//   * awesome-list scan (calls existing awesomeScan substrate)
//   * the user's intent.competitiveCategoryBoundary (manual seeds)
//
// Each entry is license-classified (via core/oss-researcher.classifyLicense)
// and assigned a recommendedAction. The final universe is persisted via
// state-io.saveOrch and gated behind a user approval prompt unless
// skipApproval is set.

import { callLLM, isLLMAvailable } from '../../core/llm.js';
import { classifyLicense } from '../../core/oss-researcher.js';
import { awesomeScan } from '../../cli/commands/awesome-scan.js';
import { saveOrch, appendAudit, loadOrch, ensureOrchDir } from '../state-io.js';
import type {
  ProjectIntent,
  CompetitiveUniverse,
  UniverseEntry,
  DiscoverySource,
  RecommendedAction,
} from '../types.js';
import type { Competitor } from '../../matrix/types/dimension-graph.js';

// ── Options ────────────────────────────────────────────────────────────────

export interface GithubSearchHit {
  name: string;
  url: string;
  license?: string;
  description?: string;
  stars?: number;
}

export interface DiscoveryOptions {
  cwd: string;
  mode?: 'llm' | 'prompt' | 'local';
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _awesomeScan?: (args: { source?: string; domain?: string }) => Promise<unknown>;
  _githubSearch?: (query: string) => Promise<GithubSearchHit[]>;
  _now?: () => string;
  /** Skip approval prompt — set by --skip-approval. */
  skipApproval?: boolean;
  /** Confirm callback. Defaults to refusing (no stdin in non-interactive flow). */
  _confirm?: (msg: string) => Promise<boolean>;
  /** Used in audit-log payloads. */
  runId?: string;
  /** Cap on queries to send (defaults to 8). */
  maxQueries?: number;
}

// ── Query generation ───────────────────────────────────────────────────────

async function buildQueries(
  intent: ProjectIntent,
  options: Required<Pick<DiscoveryOptions, 'maxQueries'>> & Pick<DiscoveryOptions, '_llmCaller' | '_isLLMAvailable' | 'mode'>,
): Promise<string[]> {
  // Heuristic baseline always seeds the queries — even in LLM mode we union
  // the LLM's suggestions with the deterministic ones to keep coverage.
  const heuristics = heuristicQueries(intent, options.maxQueries);

  const mode = options.mode ?? 'llm';
  if (mode === 'local' || mode === 'prompt') return heuristics;

  const probe = options._isLLMAvailable ?? isLLMAvailable;
  if (!(await probe())) return heuristics;

  const prompt = [
    'Generate up to 8 short search query strings (under 6 words each)',
    'that will find competing or comparable projects on GitHub and awesome-lists.',
    'Return ONE JSON array of strings, no prose.',
    '',
    `Project: ${intent.projectName}`,
    `Type: ${intent.projectType}; Target user: ${intent.targetUser}`,
    `Goal: ${intent.goal}`,
    `Key features: ${intent.keyFeatures.slice(0, 8).join(', ')}`,
    `Direct categories: ${intent.competitiveCategoryBoundary.direct.join(', ') || '(none specified)'}`,
  ].join('\n');

  try {
    const caller = options._llmCaller ?? ((p: string) => callLLM(p));
    const text = await caller(prompt);
    const arr = extractJsonArray(text);
    if (Array.isArray(arr)) {
      const strings = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      const merged = dedupeStrings([...strings, ...heuristics]).slice(0, options.maxQueries);
      if (merged.length > 0) return merged;
    }
  } catch {
    // best-effort — fall through to heuristics
  }
  return heuristics;
}

function heuristicQueries(intent: ProjectIntent, cap: number): string[] {
  const out: string[] = [];
  for (const cat of intent.competitiveCategoryBoundary.direct) out.push(cat);
  out.push(`${intent.projectType.replace(/_/g, ' ')} tool`);
  for (const feat of intent.keyFeatures.slice(0, 4)) out.push(feat);
  if (intent.projectName) out.push(`${intent.projectName} alternative`);
  return dedupeStrings(out.map(s => s.toLowerCase().trim()).filter(s => s.length > 0)).slice(0, cap);
}

function dedupeStrings(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

// ── Source fetchers ────────────────────────────────────────────────────────

/** A shell runner (seam): real impl shells out, tests inject canned output. */
export type ExecRunner = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

async function realRunner(cmd: string, args: string[]): Promise<{ stdout: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)(cmd, args, { timeout: 25_000, maxBuffer: 8 * 1024 * 1024 });
  return { stdout };
}

/** Map one `gh search repos --json` row to a hit. Tolerant of missing fields / shape drift. */
function ghRowToHit(row: Record<string, unknown>): GithubSearchHit | null {
  const name = typeof row.fullName === 'string' ? row.fullName : typeof row.name === 'string' ? row.name : '';
  const url = typeof row.url === 'string' ? row.url : '';
  if (!name || !url) return null;
  const lic = row.license as Record<string, unknown> | undefined;
  const license = lic && typeof lic === 'object'
    ? (typeof lic.name === 'string' ? lic.name : typeof lic.key === 'string' ? lic.key : undefined)
    : (typeof row.license === 'string' ? row.license : undefined);
  const hit: GithubSearchHit = { name, url };
  if (typeof row.description === 'string' && row.description) hit.description = row.description;
  if (typeof row.stargazersCount === 'number') hit.stars = row.stargazersCount;
  if (license) hit.license = license;
  return hit;
}

/**
 * Real GitHub competitor search via the `gh` CLI (the council's named stub, now wired). Best-effort:
 * if `gh` is absent, unauthenticated, or rate-limited, returns [] so discovery degrades to the
 * LLM/awesome-list/manual-seed sources rather than failing the whole run. The runner is injectable so
 * the network call is fully seamed in tests.
 */
export async function ghSearchRepos(query: string, run?: ExecRunner, limit = 10): Promise<GithubSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const exec = run ?? realRunner;
  try {
    const { stdout } = await exec('gh', [
      'search', 'repos', q,
      '--json', 'fullName,url,description,stargazersCount,license',
      '--sort', 'stars', '--limit', String(limit),
    ]);
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(r => ghRowToHit(r as Record<string, unknown>)).filter((h): h is GithubSearchHit => h !== null);
  } catch {
    return []; // gh missing / unauthenticated / rate-limited — degrade gracefully
  }
}

async function defaultGithubSearch(query: string): Promise<GithubSearchHit[]> {
  return ghSearchRepos(query);
}

async function fetchGithubEntries(
  queries: string[],
  search: (q: string) => Promise<GithubSearchHit[]>,
): Promise<UniverseEntry[]> {
  const out: UniverseEntry[] = [];
  for (const q of queries) {
    const hits = await search(q);
    for (const hit of hits) {
      out.push(toEntry({
        name: hit.name,
        repoUrl: hit.url,
        licenseHint: hit.license,
        source: 'github_search',
        provenanceUrl: hit.url,
        confidence: 0.7,
      }));
    }
  }
  return out;
}

async function fetchAwesomeEntries(
  intent: ProjectIntent,
  scan: (args: { source?: string; domain?: string }) => Promise<unknown>,
): Promise<UniverseEntry[]> {
  const entries: UniverseEntry[] = [];
  try {
    // The CLI awesomeScan returns void; the seam can return a list during
    // testing. When it returns void in production we fall back to nothing —
    // a follow-up will replace awesomeScan with a list-returning variant.
    const result = await scan({ domain: intent.projectType });
    if (Array.isArray(result)) {
      for (const r of result) {
        const rec = r as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name : undefined;
        if (!name) continue;
        const url = typeof rec.url === 'string' ? rec.url : undefined;
        entries.push(toEntry({
          name,
          repoUrl: url,
          licenseHint: typeof rec.license === 'string' ? rec.license : undefined,
          source: 'awesome_list',
          provenanceUrl: url,
          confidence: 0.6,
        }));
      }
    }
  } catch {
    // best-effort — awesome-scan failures should not abort discovery
  }
  return entries;
}

function manualSeedsFromIntent(intent: ProjectIntent): UniverseEntry[] {
  const out: UniverseEntry[] = [];
  const seed = (name: string, source: DiscoverySource, category: Competitor['category']): UniverseEntry =>
    toEntry({ name, source, confidence: 0.5, categoryOverride: category });
  for (const name of intent.competitiveCategoryBoundary.direct) out.push(seed(name, 'manual', 'unknown'));
  for (const name of intent.competitiveCategoryBoundary.adjacent) out.push(seed(name, 'manual', 'hybrid'));
  for (const name of intent.competitiveCategoryBoundary.research) out.push(seed(name, 'manual', 'research'));
  return out;
}

// ── Entry construction + classification ────────────────────────────────────

interface ToEntryInput {
  name: string;
  repoUrl?: string;
  homeUrl?: string;
  licenseHint?: string;
  source: DiscoverySource;
  provenanceUrl?: string;
  confidence: number;
  categoryOverride?: Competitor['category'];
}

function toEntry(i: ToEntryInput): UniverseEntry {
  const id = makeId(i.name);
  const category: Competitor['category'] = i.categoryOverride ?? (i.repoUrl ? 'oss' : 'unknown');
  let licenseStatus: UniverseEntry['licenseStatus'];
  if (i.licenseHint) licenseStatus = classifyLicense(i.licenseHint).status;
  const recommendedAction = computeRecommendedAction(category, licenseStatus);
  const entry: UniverseEntry = {
    id, name: i.name, category, source: i.source, confidence: i.confidence,
    recommendedAction,
  };
  if (i.repoUrl) entry.repoUrl = i.repoUrl;
  if (i.homeUrl) entry.homeUrl = i.homeUrl;
  if (i.licenseHint) entry.licenseHint = i.licenseHint;
  if (i.provenanceUrl) entry.provenanceUrl = i.provenanceUrl;
  if (licenseStatus) entry.licenseStatus = licenseStatus;
  return entry;
}

function computeRecommendedAction(
  category: Competitor['category'],
  licenseStatus: UniverseEntry['licenseStatus'],
): RecommendedAction {
  if (category === 'oss' || category === 'hybrid') {
    if (licenseStatus === 'blocked') return 'skip';
    if (licenseStatus === 'allowed') return 'harvest';
    return 'profile'; // license unknown — read first, decide later
  }
  if (category === 'closed_source') return 'profile';
  if (category === 'research') return 'observe';
  return 'observe';
}

function makeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'entry';
}

function dedupeEntries(entries: UniverseEntry[]): UniverseEntry[] {
  const seen = new Map<string, UniverseEntry>();
  for (const e of entries) {
    const key = `${e.name.toLowerCase()}::${e.repoUrl ?? ''}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, e);
    } else {
      // Merge: keep the higher confidence and prefer the entry with a license.
      const winner = pickBetter(prior, e);
      seen.set(key, winner);
    }
  }
  return Array.from(seen.values());
}

function pickBetter(a: UniverseEntry, b: UniverseEntry): UniverseEntry {
  if (b.confidence > a.confidence) return b;
  if (a.confidence > b.confidence) return a;
  if (b.licenseStatus && !a.licenseStatus) return b;
  return a;
}

// ── Approval flow ──────────────────────────────────────────────────────────

function summarizeForApproval(universe: CompetitiveUniverse): string {
  const byAction: Record<RecommendedAction, number> = { harvest: 0, profile: 0, observe: 0, skip: 0 };
  for (const e of universe.entries) byAction[e.recommendedAction]++;
  return [
    `Competitive universe for ${universe.projectName}:`,
    `  ${universe.entries.length} entries discovered`,
    `  harvest=${byAction.harvest}, profile=${byAction.profile}, observe=${byAction.observe}, skip=${byAction.skip}`,
    'Approve to proceed? (y/N)',
  ].join('\n');
}

// ── Top-level discovery ────────────────────────────────────────────────────

export async function discoverUniverse(
  intent: ProjectIntent,
  options: DiscoveryOptions,
): Promise<CompetitiveUniverse> {
  const cwd = options.cwd;
  const now = options._now ?? (() => new Date().toISOString());
  const runId = options.runId ?? 'discovery';
  const search = options._githubSearch ?? defaultGithubSearch;
  const scan = options._awesomeScan ?? ((args) => awesomeScan(args));
  const maxQueries = options.maxQueries ?? 8;

  await ensureOrchDir(cwd);

  // Verify intent is persisted (best-effort — function takes intent directly).
  await loadOrch(cwd, 'projectIntent');

  const queries = await buildQueries(intent, {
    maxQueries,
    _llmCaller: options._llmCaller,
    _isLLMAvailable: options._isLLMAvailable,
    mode: options.mode,
  });

  const ghEntries = await fetchGithubEntries(queries, search);
  const awEntries = await fetchAwesomeEntries(intent, scan);
  const manual = manualSeedsFromIntent(intent);
  const allEntries = dedupeEntries([...ghEntries, ...awEntries, ...manual]);

  const universe: CompetitiveUniverse = {
    generatedAt: now(),
    projectName: intent.projectName,
    entries: allEntries,
    approvedByUser: false,
  };

  if (options.skipApproval) {
    universe.approvedByUser = true;
    universe.approvedAt = now();
    await appendAudit(cwd, {
      ts: now(), runId, kind: 'user_approval',
      stage: 'discovering_universe',
      payload: { reason: 'skipApproval set', entryCount: allEntries.length },
    });
  } else if (options._confirm) {
    const ok = await options._confirm(summarizeForApproval(universe));
    if (ok) {
      universe.approvedByUser = true;
      universe.approvedAt = now();
      await appendAudit(cwd, {
        ts: now(), runId, kind: 'user_approval',
        stage: 'discovering_universe',
        payload: { entryCount: allEntries.length },
      });
    } else {
      await appendAudit(cwd, {
        ts: now(), runId, kind: 'user_rejection',
        stage: 'discovering_universe',
        payload: { entryCount: allEntries.length },
      });
    }
  }

  await saveOrch(cwd, 'competitiveUniverse', universe);
  await appendAudit(cwd, {
    ts: now(), runId, kind: 'stage_completed',
    stage: 'discovering_universe',
    payload: { entryCount: allEntries.length, approved: universe.approvedByUser },
  });
  return universe;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fence) {
    try { return JSON.parse(fence[1]!.trim()); } catch { /* fall through */ }
  }
  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* fall through */ }
  }
  return null;
}

// Exported for unit testing — keep at the bottom so the public surface above
// reads cleanly.
export const _internal = {
  buildQueries,
  heuristicQueries,
  dedupeEntries,
  toEntry,
  computeRecommendedAction,
  summarizeForApproval,
  extractJsonArray,
};
