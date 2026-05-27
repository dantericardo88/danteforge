// Competitor Scanner â€” benchmarks the current project against relevant competitors
// The competitor universe is determined by priority:
//   1. User-defined list (state.competitors)
//   2. OSS discoveries (from OSS_REPORT.md)
//   3. LLM-discovered competitors for the project type
//   4. AI coding tool fallback ONLY if the project is itself a dev/coding tool
// All scores are 0-100 (displayed as X.X/10 in reports).

import { callLLM } from './llm.js';
import type { ScoringDimension } from './harsh-scorer.js';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type DimensionGapSeverity = 'leading' | 'minor' | 'major' | 'critical';

export type CompetitorSource = 'hardcoded' | 'web-enriched' | 'llm-discovered' | 'oss-derived' | 'user-defined';

export interface CompetitorProfile {
  name: string;
  url: string;
  description: string;
  source: CompetitorSource;
  scores: Record<ScoringDimension, number>; // 0-100
}

export interface DimensionGap {
  dimension: ScoringDimension;
  ourScore: number;
  bestScore: number;
  bestCompetitor: string;
  delta: number;          // bestScore - ourScore (negative means we're ahead)
  severity: DimensionGapSeverity;
}

export interface CompetitorComparison {
  ourDimensions: Record<ScoringDimension, number>; // 0-100
  projectName: string;
  competitors: CompetitorProfile[];
  leaderboard: Array<{ name: string; avgScore: number; rank: number }>;
  gapReport: DimensionGap[];
  overallGap: number;
  competitorSource: 'user-defined' | 'oss-derived' | 'llm-discovered' | 'dev-tool-default';
  analysisTimestamp: string;
}

// Project context for competitor discovery
export interface ProjectCompetitorContext {
  projectName: string;
  projectDescription?: string;   // from CONSTITUTION.md or SPEC.md
  ossDiscoveries?: string[];     // tool/repo names from OSS_REPORT.md
  userDefinedCompetitors?: string[]; // from state.competitors
}

export interface CompetitorScanOptions {
  ourScores: Record<ScoringDimension, number>;
  projectContext?: ProjectCompetitorContext;
  enableWebSearch?: boolean;              // default: true
  _callLLM?: (prompt: string) => Promise<string>;
  _now?: () => string;
}
import { DEV_TOOL_OPTIMIZER_BASELINES, CODING_ASSISTANT_BASELINES } from './competitor-baselines.js';

// Preset → baseline selector. Imported types stay local to avoid pulling
// peer-presets into module init eagerly. The string compare matches PeerPreset.
function getBaselineForPreset(preset: string | null): CompetitorProfile[] {
  if (preset === 'dev-tool-optimizer') return DEV_TOOL_OPTIMIZER_BASELINES.map((c) => ({ ...c }));
  if (preset === 'coding-assistant') return CODING_ASSISTANT_BASELINES.map((c) => ({ ...c }));
  // agent-framework, or null: default to coding-assistant since that's the
  // more common sibling-project category. DanteForge itself matches dev-tool-
  // optimizer via package.json name so it doesn't hit this branch.
  return CODING_ASSISTANT_BASELINES.map((c) => ({ ...c }));
}

// All 20 dimension keys for iteration
const ALL_DIMENSIONS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
  'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
  'contextEconomy', 'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
];

// Keywords that indicate the project is a developer/coding tool
const DEV_TOOL_KEYWORDS = [
  'cli', 'agent', 'ide', 'coding', 'developer tool', 'ai tool', 'code generator',
  'workflow', 'forge', 'autoforge', 'automate code', 'code assistant', 'copilot',
  'programming', 'software engineer', 'devtool', 'dev tool',
  'multi-agent', 'orchestrat', 'agent framework', 'test generation', 'code review',
  'autonomous', 'scaffold', 'agentic',
];

// â”€â”€ Main scan function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function scanCompetitors(opts: CompetitorScanOptions): Promise<CompetitorComparison> {
  const now = opts._now ?? (() => new Date().toISOString());
  const callLLMFn = opts._callLLM ?? ((prompt: string) => callLLM(prompt));
  const enableSearch = opts.enableWebSearch ?? true;
  const ctx = opts.projectContext;
  const projectName = ctx?.projectName ?? 'this project';

  let competitors: CompetitorProfile[] = [];
  let competitorSource: CompetitorComparison['competitorSource'] = 'dev-tool-default';

  // â”€â”€ Priority 1: User-defined competitor list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (ctx?.userDefinedCompetitors && ctx.userDefinedCompetitors.length > 0) {
    competitorSource = 'user-defined';
    competitors = await scoreCompetitorsByName(ctx.userDefinedCompetitors, ctx, callLLMFn);
  }

  // â”€â”€ Priority 2: OSS discoveries from OSS_REPORT.md â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  else if (ctx?.ossDiscoveries && ctx.ossDiscoveries.length > 0) {
    competitorSource = 'oss-derived';
    competitors = await scoreCompetitorsByName(ctx.ossDiscoveries, ctx, callLLMFn);
  }

  // â”€â”€ Priority 3: LLM-discovered competitors (web search) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  else if (enableSearch && ctx) {
    try {
      competitors = await discoverAndScoreCompetitors(ctx, callLLMFn);
      if (competitors.length > 0) {
        competitorSource = 'llm-discovered';
      }
    } catch { /* fall through to default */ }
  }

  // Priority 4: Dev-tool fallback — only if project appears to be a coding tool.
  // Selects the correct baseline based on the project's resolved peer preset
  // (DanteForge → dev-tool-optimizer; DanteCode et al → coding-assistant).
  if (competitors.length === 0) {
    if (isDevToolProject(ctx)) {
      let resolvedPreset: string | null = null;
      try {
        const { resolveProjectPreset } = await import('./peer-presets.js');
        const resolution = await resolveProjectPreset(process.cwd(), {
          project: ctx?.projectName,
        });
        resolvedPreset = resolution.preset;
      } catch { /* preset resolver failed — default branch handles it */ }
      competitors = getBaselineForPreset(resolvedPreset);
      competitorSource = 'dev-tool-default';
      if (enableSearch) {
        competitors = await enrichDevToolScores(competitors, callLLMFn);
      }
    }
    // Otherwise: no competitors (project type unknown, no OSS data)
  }

  // Build leaderboard using project name
  const leaderboard = buildLeaderboard([
    { name: projectName, avgScore: avg(Object.values(opts.ourScores)) },
    ...competitors.map((c) => ({ name: c.name, avgScore: avg(Object.values(c.scores)) })),
  ]);

  const gapReport = buildGapReport(opts.ourScores, competitors);

  const positiveDeltas = gapReport.filter((g) => g.delta > 0).map((g) => g.delta);
  const overallGap = positiveDeltas.length > 0
    ? Math.round(positiveDeltas.reduce((a, b) => a + b, 0) / positiveDeltas.length)
    : 0;

  return {
    ourDimensions: opts.ourScores,
    projectName,
    competitors,
    leaderboard,
    gapReport,
    overallGap,
    competitorSource,
    analysisTimestamp: now(),
  };
}

// â”€â”€ Project type detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function isDevToolProject(ctx: ProjectCompetitorContext | undefined): boolean {
  if (!ctx) return false;
  const text = [ctx.projectName, ctx.projectDescription ?? ''].join(' ').toLowerCase();
  return DEV_TOOL_KEYWORDS.some((kw) => text.includes(kw));
}

// â”€â”€ LLM-based competitor discovery for any project type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function discoverAndScoreCompetitors(
  ctx: ProjectCompetitorContext,
  callLLMFn: (prompt: string) => Promise<string>,
): Promise<CompetitorProfile[]> {
  const prompt = [
    `You are a market analyst. Identify the top 5-8 competitors or comparable products to: "${ctx.projectName}".`,
    ctx.projectDescription ? `Description: ${ctx.projectDescription}` : '',
    '',
    'Return a JSON array of objects with these fields:',
    '  name: string, url: string, description: string (1 sentence)',
    '  scores: object with keys: functionality, testing, errorHandling, security, uxPolish,',
    '    documentation, performance, maintainability, developerExperience, autonomy,',
    '    planningQuality, selfImprovement, specDrivenPipeline, convergenceSelfHealing,',
    '    tokenEconomy, ecosystemMcp, enterpriseReadiness, communityAdoption â€” each scored 0-100.',
    '',
    'Score each competitor honestly based on public reputation and capabilities.',
    'Respond ONLY with valid JSON: [{"name":"...","url":"...","description":"...","scores":{...}}, ...]',
  ].filter(Boolean).join('\n');

  let response: string;
  try {
    response = await callLLMFn(prompt);
  } catch {
    return [];
  }

  return parseDiscoveredCompetitors(response);
}

function parseDiscoveredCompetitors(response: string): CompetitorProfile[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    const results: CompetitorProfile[] = [];

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj['name'] === 'string' ? obj['name'] : '';
      const url = typeof obj['url'] === 'string' ? obj['url'] : '';
      const description = typeof obj['description'] === 'string' ? obj['description'] : '';
      const rawScores = typeof obj['scores'] === 'object' && obj['scores'] !== null
        ? obj['scores'] as Record<string, unknown>
        : {};

      if (!name) continue;

      const scores = buildScoresFromRaw(rawScores);
      results.push({ name, url, description, source: 'llm-discovered', scores });
    }
    return results;
  } catch {
    return [];
  }
}

// â”€â”€ Score named competitors via LLM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function scoreCompetitorsByName(
  names: string[],
  ctx: ProjectCompetitorContext,
  callLLMFn: (prompt: string) => Promise<string>,
): Promise<CompetitorProfile[]> {
  const source: CompetitorSource = ctx.userDefinedCompetitors?.length ? 'user-defined' : 'oss-derived';
  const prompt = [
    `You are scoring competitors of "${ctx.projectName}" across quality dimensions.`,
    ctx.projectDescription ? `Project description: ${ctx.projectDescription}` : '',
    '',
    'Score each competitor listed below (0-100 per dimension):',
    names.map((n) => `- ${n}`).join('\n'),
    '',
    'Dimensions: functionality, testing, errorHandling, security, uxPolish, documentation,',
    'performance, maintainability, developerExperience, autonomy, planningQuality, selfImprovement,',
    'specDrivenPipeline, convergenceSelfHealing, tokenEconomy, ecosystemMcp, enterpriseReadiness, communityAdoption',
    '',
    'Respond ONLY with JSON: {"name": {"url":"...", "description":"...", "scores":{...}}, ...}',
    'Estimate scores based on public reputation. Use 70 as the default if uncertain.',
  ].filter(Boolean).join('\n');

  let enriched: Record<string, { url?: string; description?: string; scores?: Record<string, unknown> }> = {};
  try {
    const response = await callLLMFn(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      enriched = JSON.parse(jsonMatch[0]) as typeof enriched;
    }
  } catch { /* use defaults */ }

  return names.map((name) => {
    const data = enriched[name] ?? {};
    const rawScores = data.scores ?? {};
    return {
      name,
      url: data.url ?? '',
      description: data.description ?? '',
      source,
      scores: buildScoresFromRaw(rawScores as Record<string, unknown>),
    };
  });
}

// â”€â”€ Dev tool enrichment (existing logic, kept for fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function enrichDevToolScores(
  competitors: CompetitorProfile[],
  callLLMFn: (prompt: string) => Promise<string>,
): Promise<CompetitorProfile[]> {
  const prompt = [
    'You are a technical analyst benchmarking AI coding tools.',
    'For each tool below, provide updated capability scores (0-100) based on recent public information.',
    'Respond ONLY with a JSON object. Keys are tool names, values are score objects.',
    'Dimensions: functionality, testing, errorHandling, security, uxPolish, documentation,',
    'performance, maintainability, developerExperience, autonomy, planningQuality, selfImprovement,',
    'specDrivenPipeline, convergenceSelfHealing, tokenEconomy, ecosystemMcp, enterpriseReadiness, communityAdoption',
    '',
    'Tools to score:',
    competitors.map((c) => `- ${c.name}`).join('\n'),
    '',
    'Example format:',
    '{"Devin (Cognition AI)": {"functionality": 88, "autonomy": 92, ...}, ...}',
    '',
    'Focus on CAPABILITY (what the tool can do), not the underlying model performance.',
    'Only update dimensions where you have reliable recent information (2024-2025).',
  ].join('\n');

  let enriched: Record<string, Partial<Record<ScoringDimension, number>>> = {};
  try {
    const response = await callLLMFn(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      for (const [name, scores] of Object.entries(parsed)) {
        if (typeof scores !== 'object' || scores === null) continue;
        const dimScores: Partial<Record<ScoringDimension, number>> = {};
        for (const dim of ALL_DIMENSIONS) {
          const val = (scores as Record<string, unknown>)[dim];
          if (typeof val === 'number' && val >= 0 && val <= 100) dimScores[dim] = val;
        }
        enriched[name] = dimScores;
      }
    }
  } catch { /* use hardcoded */ }

  return competitors.map((comp) => {
    const updates = enriched[comp.name];
    if (!updates) return comp;
    return { ...comp, source: 'web-enriched', scores: { ...comp.scores, ...updates } };
  });
}

// â”€â”€ Score builder from raw LLM output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildScoresFromRaw(raw: Record<string, unknown>): Record<ScoringDimension, number> {
  const defaults: Record<ScoringDimension, number> = {
    functionality: 70, testing: 70, errorHandling: 70, security: 70,
    uxPolish: 70, documentation: 70, performance: 70, maintainability: 70,
    developerExperience: 70, autonomy: 70, planningQuality: 70, selfImprovement: 70,
    specDrivenPipeline: 40, convergenceSelfHealing: 45, tokenEconomy: 50,
    ecosystemMcp: 50, enterpriseReadiness: 50, communityAdoption: 60,
    contextEconomy: 0, causalCoherence: 0,
  };
  for (const dim of ALL_DIMENSIONS) {
    const val = raw[dim];
    if (typeof val === 'number' && val >= 0 && val <= 100) {
      defaults[dim] = val;
    }
  }
  return defaults;
}

// â”€â”€ OSS Report parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Extracts tool/repo names from OSS_REPORT.md for use as competitor list.

export function parseOssDiscoveries(ossReportContent: string): string[] {
  const names: string[] = [];

  // Extract from "## Repositories Scanned" section
  const repoSection = ossReportContent.match(/## Repositories Scanned([\s\S]*?)(?=##|$)/);
  if (repoSection) {
    const repoLines = repoSection[1]!.split('\n');
    for (const line of repoLines) {
      // Match markdown links: [name](url) or ### name or - **name**
      const linkMatch = line.match(/\[([^\]]+)\]/);
      const boldMatch = line.match(/\*\*([^*]+)\*\*/);
      const headingMatch = line.match(/^#{1,4}\s+(.+)/);
      const name = (linkMatch?.[1] ?? boldMatch?.[1] ?? headingMatch?.[1] ?? '').trim();
      if (name && name.length > 1 && name !== 'No repositories scanned.') {
        names.push(name);
      }
    }
  }

  // Also extract from "## Patterns Extracted" tool mentions
  const patternSection = ossReportContent.match(/## Patterns Extracted([\s\S]*?)(?=##|$)/);
  if (patternSection) {
    const toolMatches = patternSection[1]!.matchAll(/`([a-zA-Z][\w/-]{2,})`/g);
    for (const match of toolMatches) {
      const name = match[1]!.trim();
      if (!names.includes(name)) names.push(name);
    }
  }

  return [...new Set(names)].slice(0, 10); // max 10 competitors
}

// â”€â”€ Gap report builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function buildGapReport(
  ourScores: Record<ScoringDimension, number>,
  competitors: CompetitorProfile[],
): DimensionGap[] {
  return ALL_DIMENSIONS.map((dim) => {
    const ourScore = ourScores[dim] ?? 0;
    let bestScore = ourScore;
    let bestCompetitor = 'us';

    for (const comp of competitors) {
      const compScore = comp.scores[dim] ?? 0;
      if (compScore > bestScore) {
        bestScore = compScore;
        bestCompetitor = comp.name;
      }
    }

    const delta = bestScore - ourScore;
    let severity: DimensionGapSeverity;
    if (delta <= 0) severity = 'leading';
    else if (delta < 10) severity = 'minor';
    else if (delta < 20) severity = 'major';
    else severity = 'critical';

    return { dimension: dim, ourScore, bestScore, bestCompetitor, delta, severity };
  });
}

// â”€â”€ Leaderboard builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function buildLeaderboard(
  entries: Array<{ name: string; avgScore: number }>,
): Array<{ name: string; avgScore: number; rank: number }> {
  const sorted = [...entries].sort((a, b) => b.avgScore - a.avgScore);
  return sorted.map((entry, i) => ({
    ...entry,
    rank: i + 1,
    avgScore: Math.round(entry.avgScore * 10) / 10,
  }));
}

// â”€â”€ Report formatter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function formatCompetitorReport(comparison: CompetitorComparison): string {
  const lines: string[] = [
    '## Competitor Benchmarking Report',
    `Source: ${formatSourceLabel(comparison.competitorSource)}`,
    '',
    '### Leaderboard (average across all dimensions)',
    '',
  ];

  for (const entry of comparison.leaderboard) {
    const marker = entry.name === comparison.projectName ? ' â—„ (us)' : '';
    lines.push(`  ${entry.rank}. ${entry.name}: ${(entry.avgScore / 10).toFixed(1)}/10${marker}`);
  }

  lines.push('', '### Gap Analysis', '');

  if (comparison.competitors.length === 0) {
    lines.push('  No competitors found. Run `/oss` or set `state.competitors` to add them.');
    return lines.join('\n');
  }

  const sorted = [...comparison.gapReport].sort((a, b) => b.delta - a.delta);
  for (const gap of sorted) {
    const ours = (gap.ourScore / 10).toFixed(1);
    const best = (gap.bestScore / 10).toFixed(1);
    const delta = gap.delta > 0 ? `-${(gap.delta / 10).toFixed(1)}` : `+${(Math.abs(gap.delta) / 10).toFixed(1)}`;
    const icon = gap.severity === 'leading' ? 'âœ“' : gap.severity === 'critical' ? 'âš ' : 'â–³';
    lines.push(`  ${icon} ${gap.dimension.padEnd(22)} us: ${ours}  best: ${best} (${gap.bestCompetitor}) ${delta}`);
  }

  return lines.join('\n');
}

function formatSourceLabel(source: CompetitorComparison['competitorSource']): string {
  switch (source) {
    case 'user-defined': return 'user-defined competitor list (state.competitors)';
    case 'oss-derived': return 'OSS discoveries from /oss command (OSS_REPORT.md)';
    case 'llm-discovered': return 'LLM-discovered based on project description';
    case 'dev-tool-default': return 'default AI coding tool benchmark (project is a dev tool)';
  }
}

// â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Export for tests and assess command — re-exported from competitor-baselines.ts.
export { DEV_TOOL_OPTIMIZER_BASELINES, CODING_ASSISTANT_BASELINES } from './competitor-baselines.js';
export { DEV_TOOL_OPTIMIZER_BASELINES as COMPETITOR_BASELINES } from './competitor-baselines.js';
export { DEV_TOOL_OPTIMIZER_BASELINES as DEV_TOOL_BASELINES } from './competitor-baselines.js';
