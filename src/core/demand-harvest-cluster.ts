// demand-harvest-cluster.ts — the pure, deterministic core of demand harvesting (Phase 6 v1).
//
// Demand grounding answers the question the matrix can't answer for itself: "is this capability actually
// WANTED?" (CH-007 — provability is not desirability). We harvest open feature-request issues from
// competitor/topic repos, cluster them into demand themes, and rank by a transparent signal model so the
// loudest, freshest, most-specific, most-buildable demand floats to the top of a backlog that feeds
// `specify`. This file is pure (no IO) so the ranking is fully testable; the gh-CLI fetch lives in
// demand-harvest.ts. Signal weights are explicit and surfaced per-cluster — the operator sees WHY a theme
// ranked where it did, never an opaque number.

export interface DemandIssue {
  repo: string;          // owner/repo
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
  createdAt: string;     // ISO timestamp
}

export interface DemandSignals {
  frequency: number;     // 0..1 — how many distinct issues ask for this theme
  recency: number;       // 0..1 — how recent the freshest ask is
  specificity: number;   // 0..1 — does the ask carry an acceptance criterion the builder can target
  buildability: number;  // 0..1 — is it a concrete feature ask vs a question/discussion
}

export interface DemandCluster {
  theme: string;         // human label, derived from the shared keywords
  keywords: string[];
  issues: DemandIssue[];
  signals: DemandSignals;
  score: number;         // 0..10 — weighted blend of the four signals
}

// Signal weights (sum to 1). Frequency dominates — many distinct asks is the strongest demand signal —
// but specificity is close behind because an ask the builder can't turn into an acceptance criterion is
// not actionable. Exposed so the ranking is auditable, not magic.
export const DEMAND_WEIGHTS: Readonly<DemandSignals> = { frequency: 0.35, recency: 0.20, specificity: 0.25, buildability: 0.20 };

const FREQUENCY_SATURATION = 5;   // 5+ distinct issues on one theme = maximal frequency signal
const RECENCY_HALF_LIFE_DAYS = 365; // an ask a year old has decayed to ~0 recency

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'with', 'is', 'are', 'be', 'as',
  'at', 'by', 'it', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'when', 'if', 'can', 'could',
  'would', 'should', 'add', 'support', 'allow', 'enable', 'feature', 'request', 'please', 'able', 'want',
  'need', 'using', 'use', 'make', 'not', 'no', 'do', 'does', 'have', 'has', 'from', 'into', 'via', 'new',
  // GitHub issue-TEMPLATE boilerplate — appears in most bodies, would falsely cluster everything together.
  'describe', 'description', 'problem', 'solution', 'alternatives', 'context', 'behavior', 'behaviour',
  'current', 'expected', 'actual', 'like', 'such', 'also', 'would', 'additional', 'screenshots', 'steps',
]);

// Markers that an issue carries an acceptance criterion / concrete expectation a builder can target.
const ACCEPTANCE_MARKERS = [/\bexpected\b/i, /\bshould\b/i, /\bacceptance\b/i, /\bsteps to\b/i, /- \[ \]/, /```/, /\bso that\b/i, /\bexample\b/i];
// Labels that mark an issue as a concrete feature ask vs a question/discussion (buildability).
const BUILD_POSITIVE = ['enhancement', 'feature', 'feature request', 'feature-request', 'help wanted', 'good first issue'];
const BUILD_NEGATIVE = ['question', 'discussion', 'wontfix', "won't fix", 'duplicate', 'invalid', 'support'];

/** Extract the meaningful keywords from an issue. TITLE-ONLY by design: issue BODIES are dominated by
 *  GitHub-template boilerplate ("Describe the problem you'd like…"), which falsely clusters unrelated asks
 *  together. The title is the real demand signal; the body still feeds specificity scoring separately. */
export function extractKeywords(issue: Pick<DemandIssue, 'title' | 'body'>): string[] {
  const text = issue.title.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^[.+#]+|[.+#]+$/g, '');
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (!seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

/**
 * Cluster issues into demand themes (deterministic, no embeddings in v1). Greedy by shared keyword:
 * repeatedly seed a cluster on the most frequent still-unclustered keyword, absorb every unclustered
 * issue containing it, and continue. An issue lands in exactly one cluster (its strongest keyword), so
 * frequency counts are honest (no double-counting). Singletons are kept — a single specific, recent,
 * highly-reacted ask can still out-rank a vague crowd.
 */
export function clusterIssues(issues: DemandIssue[]): DemandCluster[] {
  const kw = new Map<number, string[]>();         // issue index -> keywords
  const freq = new Map<string, number>();         // keyword -> # issues containing it
  issues.forEach((iss, i) => {
    const words = extractKeywords(iss);
    kw.set(i, words);
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  });

  const unclustered = new Set(issues.map((_, i) => i));
  const clusters: DemandCluster[] = [];
  // Process keywords most-frequent first so the biggest demand themes form before singletons.
  const keywordsByFreq = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);

  for (const seed of keywordsByFreq) {
    const members = [...unclustered].filter(i => kw.get(i)!.includes(seed));
    if (members.length === 0) continue;
    for (const i of members) unclustered.delete(i);
    const clusterIssues = members.map(i => issues[i]!);
    clusters.push({
      theme: deriveTheme(seed, clusterIssues),
      keywords: sharedKeywords(clusterIssues),
      issues: clusterIssues,
      signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 },
      score: 0,
    });
  }
  return clusters;
}

function deriveTheme(seed: string, issues: DemandIssue[]): string {
  const shared = sharedKeywords(issues).slice(0, 3);
  const words = shared.includes(seed) ? shared : [seed, ...shared].slice(0, 3);
  return words.join(' / ');
}

/** Keywords ordered by how many issues in the cluster share them (the cluster's center of gravity). */
function sharedKeywords(issues: DemandIssue[]): string[] {
  const f = new Map<string, number>();
  for (const iss of issues) for (const w of extractKeywords(iss)) f.set(w, (f.get(w) ?? 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
}

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

function issueSpecificity(iss: DemandIssue): number {
  const body = iss.body ?? '';
  const lengthScore = clamp01(body.length / 600);                       // a few sentences of detail
  const markers = ACCEPTANCE_MARKERS.filter(re => re.test(body)).length;
  const markerScore = clamp01(markers / 2);                             // 2+ acceptance markers = strong
  return clamp01(0.5 * lengthScore + 0.5 * markerScore);
}

function issueBuildability(iss: DemandIssue): number {
  const labels = iss.labels.map(l => l.toLowerCase());
  const text = `${iss.title} ${iss.body}`.toLowerCase();
  let s = 0.5;                                                          // neutral prior
  if (labels.some(l => BUILD_POSITIVE.includes(l))) s += 0.35;
  if (labels.some(l => BUILD_NEGATIVE.includes(l))) s -= 0.4;
  if (/\?$/.test(iss.title.trim()) || /\bhow (do|can|to)\b/.test(text)) s -= 0.2; // a question, not an ask
  return clamp01(s);
}

/** Score one cluster (0..10) from its four signals. `nowMs` is passed in (scripts can't read the clock). */
export function scoreCluster(cluster: DemandCluster, nowMs: number): DemandCluster {
  const frequency = clamp01(cluster.issues.length / FREQUENCY_SATURATION);
  const newestMs = Math.max(...cluster.issues.map(i => Date.parse(i.createdAt) || 0));
  const ageDays = newestMs > 0 ? (nowMs - newestMs) / 86_400_000 : RECENCY_HALF_LIFE_DAYS;
  const recency = clamp01(1 - ageDays / RECENCY_HALF_LIFE_DAYS);
  const specificity = clamp01(avg(cluster.issues.map(issueSpecificity)));
  const buildability = clamp01(avg(cluster.issues.map(issueBuildability)));
  const signals: DemandSignals = { frequency, recency, specificity, buildability };
  const score = 10 * (
    DEMAND_WEIGHTS.frequency * frequency +
    DEMAND_WEIGHTS.recency * recency +
    DEMAND_WEIGHTS.specificity * specificity +
    DEMAND_WEIGHTS.buildability * buildability
  );
  return { ...cluster, signals, score: Math.round(score * 10) / 10 };
}

function avg(ns: number[]): number { return ns.length === 0 ? 0 : ns.reduce((a, b) => a + b, 0) / ns.length; }

/** Cluster + score + rank highest-demand first. `nowMs` injected for determinism. */
export function rankClusters(issues: DemandIssue[], nowMs: number): DemandCluster[] {
  return clusterIssues(issues)
    .map(c => scoreCluster(c, nowMs))
    .sort((a, b) => b.score - a.score || b.issues.length - a.issues.length);
}
