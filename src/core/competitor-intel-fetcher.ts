// competitor-intel-fetcher.ts — Real-time competitor weakness intelligence.
// Fetches from GitHub Issues (public API), HackerNews (Algolia), and Reddit
// (public JSON) to build an evidence-based weakness map for each competitor.
// No auth required for basic usage; set GITHUB_TOKEN env for higher rate limits.
//
// Output: WeaknessSignal[] — ranked opportunities where competitor pain = our gain.

import https from 'node:https';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeaknessSignal {
  tool: string;
  source: 'github-issues' | 'hackernews' | 'reddit';
  title: string;
  snippet: string;
  url: string;
  demandScore: number;     // reactions/upvotes/points — proxy for user demand
  category: string;        // mapped to a matrix dimension id
  foundAt: string;         // ISO timestamp
}

export interface IntelReport {
  generatedAt: string;
  signals: WeaknessSignal[];
  opportunities: OpportunityScore[];
}

export interface OpportunityScore {
  category: string;
  dimensionId: string;
  totalDemand: number;
  signalCount: number;
  topSignals: WeaknessSignal[];
  opportunityScore: number; // demand × gap / competitor_strength (set by caller)
}

// ── Competitor repo map ───────────────────────────────────────────────────────

export const COMPETITOR_REPOS: Record<string, { owner: string; repo: string }> = {
  'Aider':                  { owner: 'Aider-AI',          repo: 'aider' },
  'OpenHands':              { owner: 'All-Hands-AI',       repo: 'OpenHands' },
  'Plandex':                { owner: 'plandex-ai',         repo: 'plandex' },
  'Cline':                  { owner: 'cline',              repo: 'cline' },
  'CrewAI':                 { owner: 'crewAIInc',          repo: 'crewAI' },
  'AutoGen (Microsoft)':    { owner: 'microsoft',          repo: 'autogen' },
  'MetaGPT':                { owner: 'geekan',             repo: 'MetaGPT' },
  'SWE-Agent (Princeton)':  { owner: 'SWE-agent',          repo: 'SWE-agent' },
  'LangChain Agents':       { owner: 'langchain-ai',       repo: 'langchain' },
  'Codex':                  { owner: 'openai',             repo: 'codex' },
};

// ── Category classifier ───────────────────────────────────────────────────────
// Maps issue/comment text to a DanteForge matrix dimension id.

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; dimensionId: string; label: string }> = [
  { pattern: /windows|cmd\.exe|powershell|wsl/i,          dimensionId: 'developer_experience', label: 'Windows support' },
  { pattern: /slow|perf|latency|hang|timeout|fast/i,      dimensionId: 'performance',          label: 'Performance' },
  { pattern: /test|coverage|flak|ci|broken\s+test/i,      dimensionId: 'testing',              label: 'Test quality' },
  { pattern: /doc|readme|example|confusing|unclear/i,     dimensionId: 'documentation',        label: 'Documentation' },
  { pattern: /autonom|self.?improv|loop|daemon|agent/i,   dimensionId: 'autonomy',             label: 'Autonomy' },
  { pattern: /multi.?agent|orchestrat|parallel|crew/i,    dimensionId: 'multi_agent_orchestration', label: 'Multi-agent' },
  { pattern: /security|vuln|exploit|sanitiz|inject/i,     dimensionId: 'security',             label: 'Security' },
  { pattern: /ux|ui|output|format|display|color|cli/i,    dimensionId: 'ux_polish',            label: 'UX/CLI polish' },
  { pattern: /context|token|memory|limit|window/i,        dimensionId: 'token_economy',        label: 'Token/context management' },
  { pattern: /enterprise|rbac|audit|compliance|scale/i,   dimensionId: 'enterprise_readiness', label: 'Enterprise features' },
  { pattern: /spec|plan|task|backlog|roadmap/i,            dimensionId: 'spec_driven_pipeline', label: 'Spec/planning pipeline' },
  { pattern: /error|crash|exception|fail|bug|broken/i,    dimensionId: 'error_handling',       label: 'Error handling' },
];

function classifyText(text: string): { dimensionId: string; label: string } {
  for (const { pattern, dimensionId, label } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return { dimensionId, label };
  }
  return { dimensionId: 'functionality', label: 'General functionality' };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DanteForge-Intel/1.0 (competitive-intelligence)',
        ...headers,
      },
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        try { resolve(JSON.parse(data) as T); }
        catch { reject(new Error(`JSON parse failed for ${url}`)); }
      });
    }).on('error', reject);
  });
}

// ── GitHub Issues fetcher ─────────────────────────────────────────────────────

const WEAKNESS_LABELS = 'bug,enhancement,help wanted,feature request,question';
const NEGATIVE_KEYWORDS = /broken|doesn.t work|not work|fail|crash|missing|can.t|cannot|wish|request|please add|want|need|improve/i;

export async function fetchGitHubIssues(toolName: string, timeoutMs = 15_000): Promise<WeaknessSignal[]> {
  const repo = COMPETITOR_REPOS[toolName];
  if (!repo) return [];

  const token = process.env['GITHUB_TOKEN'];
  const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues` +
    `?state=open&sort=reactions&direction=desc&per_page=50&labels=${WEAKNESS_LABELS}`;

  try {
    const promise = fetchJson<Array<{
      title: string; body: string | null; html_url: string;
      reactions: { '+1': number; total_count: number };
      labels: Array<{ name: string }>;
    }>>(url, headers);

    const data = await (timeoutMs > 0
      ? Promise.race([promise, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), timeoutMs))])
      : promise);

    // GitHub returns a JSON OBJECT (not an array) on rate-limit/error — e.g.
    // {message:"API rate limit exceeded", documentation_url:…}. Iterating it with for..of threw
    // "i is not iterable" (CH-048), masking the REAL cause and crashing the whole harvest. Surface the
    // actual message + the actionable fix (set GITHUB_TOKEN) so the failure is honest, then delegate to
    // the pure transform (which itself returns [] for a non-array, never a crash).
    if (!Array.isArray(data)) {
      const msg = (data as { message?: string } | null)?.message ?? 'non-array response';
      logger.warn(`[intel] GitHub returned no issue list for ${toolName}: ${msg}` +
        (token ? '' : ' (no GITHUB_TOKEN — unauthenticated GitHub is rate-limited to ~60 req/hr; set GITHUB_TOKEN for 5000/hr)'));
    }
    return issuesToWeaknessSignals(data, toolName);
  } catch (err) {
    logger.warn(`[intel] GitHub fetch failed for ${toolName}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Pure transform: GitHub issues API response → weakness signals. Returns [] for ANY non-array input
 * (a rate-limit/error object like {message:"API rate limit exceeded"}) so the harvest fails honestly
 * instead of crashing on for..of (CH-048). Extracted from fetchGitHubIssues so the guard is unit-testable
 * without network.
 */
export function issuesToWeaknessSignals(data: unknown, toolName: string): WeaknessSignal[] {
  if (!Array.isArray(data)) return [];
  const signals: WeaknessSignal[] = [];
  for (const issue of data as Array<{
    title: string; body: string | null; html_url: string;
    reactions: { '+1': number; total_count: number };
  }>) {
    const text = `${issue.title} ${issue.body?.slice(0, 300) ?? ''}`;
    if (!NEGATIVE_KEYWORDS.test(text) && (issue.reactions?.['+1'] ?? 0) < 3) continue;

    const { dimensionId } = classifyText(text);
    signals.push({
      tool: toolName,
      source: 'github-issues',
      title: issue.title,
      snippet: issue.body?.slice(0, 200) ?? '',
      url: issue.html_url,
      demandScore: (issue.reactions?.['+1'] ?? 0) + (issue.reactions?.total_count ?? 0) * 0.5,
      category: dimensionId, // Phase 0.2: matrix dim id (was `label` — broke intelToDemandSignals filtering)
      foundAt: new Date().toISOString(),
    });
  }
  return signals;
}

// ── HackerNews (Algolia) fetcher ──────────────────────────────────────────────

const HN_NEGATIVE = /broken|doesn.t work|not work|wish|missing|problem|annoying|frustrat|fail|bug|hate|bad|worse|limitation|can.t/i;

export async function fetchHackerNewsMentions(toolName: string, timeoutMs = 15_000): Promise<WeaknessSignal[]> {
  const encodedQuery = encodeURIComponent(toolName);
  const url = `https://hn.algolia.com/api/v1/search?query=${encodedQuery}&tags=comment&hitsPerPage=30&numericFilters=created_at_i>1700000000`;

  try {
    const promise = fetchJson<{
      hits: Array<{ objectID: string; comment_text: string; points: number | null; story_url: string | null; created_at: string }>;
    }>(url);

    const data = await (timeoutMs > 0
      ? Promise.race([promise, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), timeoutMs))])
      : promise);

    const signals: WeaknessSignal[] = [];
    for (const hit of data.hits) {
      const text = hit.comment_text ?? '';
      if (!HN_NEGATIVE.test(text)) continue;

      const { dimensionId } = classifyText(text);
      signals.push({
        tool: toolName,
        source: 'hackernews',
        title: text.slice(0, 100).replace(/\s+/g, ' '),
        snippet: text.slice(0, 250),
        url: hit.story_url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        demandScore: (hit.points ?? 0) + 1,
        category: dimensionId, // Phase 0.2: matrix dim id
        foundAt: new Date().toISOString(),
      });
    }
    return signals;
  } catch (err) {
    logger.warn(`[intel] HackerNews fetch failed for ${toolName}: ${(err as Error).message}`);
    return [];
  }
}

// ── Reddit public JSON fetcher ────────────────────────────────────────────────

const SUBREDDITS = ['LocalLLaMA', 'MachineLearning', 'programming', 'SideProject', 'learnprogramming'];
const REDDIT_NEGATIVE = /broken|doesn.t work|not work|bug|crash|missing|wish|want|annoying|frustrat|problem|fail/i;
const REDDIT_UA = 'Mozilla/5.0 (compatible; DanteForge-Intel/1.0; +https://github.com/dantericardo88/danteforge)';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchRedditSubreddit(
  subreddit: string,
  encodedQuery: string,
  timeoutMs: number,
): Promise<Array<{ title: string; selftext: string; score: number; permalink: string }>> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodedQuery}&sort=new&limit=15&t=month&restrict_sr=1`;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const promise = fetchJson<{
        data: { children: Array<{ data: { title: string; selftext: string; score: number; permalink: string } }> };
      }>(url, { 'User-Agent': REDDIT_UA });

      const data = await (timeoutMs > 0
        ? Promise.race([promise, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), timeoutMs))])
        : promise);

      return data.data.children.map(c => c.data);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const is429 = msg.includes('429') || msg.includes('403');
      if (attempt < MAX_RETRIES && is429) {
        // Exponential backoff: 2s, 4s + jitter
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 500;
        await sleep(delay);
        continue;
      }
      return []; // non-retryable or exhausted retries
    }
  }
  return [];
}

export async function fetchRedditMentions(toolName: string, timeoutMs = 15_000): Promise<WeaknessSignal[]> {
  const signals: WeaknessSignal[] = [];
  const encodedQuery = encodeURIComponent(toolName);

  for (const subreddit of SUBREDDITS.slice(0, 3)) {
    const posts = await fetchRedditSubreddit(subreddit, encodedQuery, timeoutMs);
    for (const post of posts) {
      const text = `${post.title} ${post.selftext?.slice(0, 200) ?? ''}`;
      if (!REDDIT_NEGATIVE.test(text)) continue;

      const { dimensionId } = classifyText(text);
      signals.push({
        tool: toolName,
        source: 'reddit',
        title: post.title,
        snippet: post.selftext?.slice(0, 200) ?? '',
        url: `https://reddit.com${post.permalink}`,
        demandScore: Math.max(post.score, 1),
        category: dimensionId, // Phase 0.2: matrix dim id
        foundAt: new Date().toISOString(),
      });
    }
    // Brief inter-subreddit pause to be a polite client
    if (SUBREDDITS.indexOf(subreddit) < 2) await sleep(1000 + Math.random() * 500);
  }
  return signals;
}

// ── Aggregate fetcher ─────────────────────────────────────────────────────────

export async function fetchCompetitorIntel(
  toolNames: string[],
  options: { githubOnly?: boolean; timeoutMs?: number } = {},
): Promise<WeaknessSignal[]> {
  const { timeoutMs = 20_000 } = options;
  const allSignals: WeaknessSignal[] = [];

  for (const tool of toolNames) {
    logger.info(`[intel] Fetching intelligence for ${tool}...`);
    const [ghSignals, hnSignals, rdSignals] = await Promise.allSettled([
      fetchGitHubIssues(tool, timeoutMs),
      options.githubOnly ? Promise.resolve([]) : fetchHackerNewsMentions(tool, timeoutMs),
      options.githubOnly ? Promise.resolve([]) : fetchRedditMentions(tool, timeoutMs),
    ]);

    const signals = [
      ...(ghSignals.status === 'fulfilled' ? ghSignals.value : []),
      ...(hnSignals.status === 'fulfilled' ? hnSignals.value : []),
      ...(rdSignals.status === 'fulfilled' ? rdSignals.value : []),
    ];
    logger.info(`[intel]   ${tool}: ${signals.length} weakness signal(s) found`);
    allSignals.push(...signals);
  }

  return allSignals;
}

// ── Opportunity scorer ────────────────────────────────────────────────────────
// Converts raw signals into ranked opportunities: high demand + big gap = big opportunity.

export function scoreOpportunities(
  signals: WeaknessSignal[],
  ourGaps: Record<string, number>, // dimensionId → gap_to_leader (higher = we're further behind = more room to leapfrog)
): OpportunityScore[] {
  const byDim = new Map<string, WeaknessSignal[]>();
  for (const s of signals) {
    const existing = byDim.get(s.category) ?? [];
    existing.push(s);
    byDim.set(s.category, existing);
  }

  const opportunities: OpportunityScore[] = [];
  for (const [category, dimSignals] of byDim) {
    const totalDemand = dimSignals.reduce((s, x) => s + x.demandScore, 0);
    const dimensionId = category || 'functionality'; // Phase 0.2: category now IS the matrix dim id (signals grouped by it above)
    const gap = ourGaps[dimensionId] ?? 0;
    // Opportunity = demand × gap. High demand + big gap = we need this, customers want it.
    const opportunityScore = totalDemand * (1 + gap);

    opportunities.push({
      category,
      dimensionId,
      totalDemand,
      signalCount: dimSignals.length,
      topSignals: dimSignals.sort((a, b) => b.demandScore - a.demandScore).slice(0, 3),
      opportunityScore,
    });
  }

  return opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
}
