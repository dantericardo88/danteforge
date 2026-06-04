// dim-triage — classify each competitive dimension by HOW it can be advanced, then route it to the
// right autonomous loop. The fleet proved autoresearch is mechanically sound but advances nothing on a
// matrix whose remaining sub-target dims are either genuinely ceilinged, need feature-scale
// construction (wrong tool for autoresearch's surgical one-edit loop), or carry a mis-specified test.
// This module is the router: stop pointing autoresearch at dead targets.
//
// Pure logic only (no IO). The deterministic classifier handles the unambiguous cases; the rest carry
// needsLLM=true for a judgment pass in the CLI layer.

import { MARKET_DIM_MAX_SCORE } from './compete-matrix-score.js';

export type DimCategory = 'ceilinged' | 'yardstick_bug' | 'feature_construction' | 'surgical' | 'unknown';
export type DimRoute = 'none' | 'autoresearch' | 'matrixdev' | 'fix-test' | 'manual';

/** Default score below which a dim is considered "needs work" and worth triaging. */
export const ADVANCE_TARGET = 7.0;

/** The category → recommended autonomous loop. */
export const ROUTE_BY_CATEGORY: Record<DimCategory, DimRoute> = {
  ceilinged: 'none',
  yardstick_bug: 'fix-test',
  feature_construction: 'matrixdev',
  surgical: 'autoresearch',
  unknown: 'manual',
};

export interface DimSignals {
  id: string;
  label?: string;
  score: number;
  ceiling?: number;
  closingStrategy?: string;
  noCapabilityTest?: boolean;
  capabilityTestCommand?: string;
  /** Whether the script the capability_test references actually exists on disk (undefined = no path). */
  scriptExists?: boolean;
  /** community_adoption / enterprise_readiness — internal evidence can't certify above the market cap. */
  isMarketCapped?: boolean;
}

export interface DimClassification {
  id: string;
  label?: string;
  score: number;
  category: DimCategory;
  route: DimRoute;
  reason: string;
  /** True when the deterministic pass couldn't decide — the CLI runs an LLM judgment for these. */
  needsLLM: boolean;
  /** When set, `--apply` writes this as the dim's explicit ceiling so selection stops picking it. */
  suggestedCeiling?: number;
}

/**
 * Deterministic classification — only the unambiguous cases. A dim with a real, existing capability_test
 * is left `unknown` (needsLLM) because surgical-vs-feature can't be told from static signals.
 */
export function classifyDimDeterministic(s: DimSignals): DimClassification {
  const base = { id: s.id, label: s.label, score: s.score };
  const done = (category: DimCategory, reason: string, suggestedCeiling?: number): DimClassification =>
    ({ ...base, category, route: ROUTE_BY_CATEGORY[category], reason, needsLLM: false, suggestedCeiling });

  if (s.isMarketCapped) {
    return done('ceilinged', `market dimension — internal evidence cannot certify above ${MARKET_DIM_MAX_SCORE}`, MARKET_DIM_MAX_SCORE);
  }
  if (s.closingStrategy === 'human' || s.closingStrategy === 'ceiling') {
    return done('ceilinged', `closingStrategy=${s.closingStrategy} — not advanceable by code`, s.ceiling ?? round1(s.score));
  }
  if (s.ceiling !== undefined && s.score >= s.ceiling) {
    return done('ceilinged', `already at operator-set ceiling ${s.ceiling}`);
  }
  if (s.noCapabilityTest) {
    return done('ceilinged', 'no_capability_test — exempt from machine verification; needs a real outcome or a ceiling');
  }
  if (!s.capabilityTestCommand || !s.capabilityTestCommand.trim()) {
    return done('yardstick_bug', 'no capability_test command declared — author a real failing test (Depth Doctrine T2)');
  }
  if (s.scriptExists === false) {
    return done('yardstick_bug', 'capability_test references a script that does not exist on disk — broken/mis-specified');
  }
  return { ...base, category: 'unknown', route: 'manual', reason: 'has a real capability_test — needs judgment: surgical edit vs feature construction', needsLLM: true };
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/** Extract path-like tokens from a shell command so the caller can check which scripts exist. */
export function extractCommandPaths(command: string): string[] {
  const out: string[] = [];
  for (const tok of command.split(/\s+/)) {
    if (!tok || tok.startsWith('-')) continue;
    if (/[\\/]/.test(tok) || /\.(mjs|cjs|js|ts|mts|cts|py|sh|rb|go|json|yaml|yml)$/i.test(tok)) {
      out.push(tok.replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

// ── LLM judgment pass (for `unknown` dims) ─────────────────────────────────────

const LLM_CATEGORIES: DimCategory[] = ['surgical', 'feature_construction', 'yardstick_bug'];

export function buildClassifyPrompt(s: DimSignals, scriptSource: string): string {
  const src = scriptSource.trim()
    ? `\nIts capability_test script source:\n\`\`\`\n${scriptSource.slice(0, 4000)}\n\`\`\`\n`
    : '\n(The capability_test script source was not readable.)\n';
  return `You are triaging a competitive dimension for an autonomous engineering system.

Dimension: ${s.id}${s.label ? ` (${s.label})` : ''}
Current self-score: ${s.score}/10 (target ${ADVANCE_TARGET})
capability_test command (a pass/fail gate that must exit 0): ${s.capabilityTestCommand}
${src}
Classify how this dimension should be advanced. Respond with EXACTLY this JSON, no markdown fences:
{ "category": "surgical" | "feature_construction" | "yardstick_bug", "reason": "<one sentence>" }

Definitions:
- surgical: a small, localized change could plausibly make the test pass (a near-complete capability, a bug, a threshold/config). Suited to autoresearch.
- feature_construction: passing requires substantial NEW multi-file implementation — too large for one surgical edit. Route to a feature-build loop.
- yardstick_bug: the test is a stub or can only pass by editing the test itself; it does not assert a real outcome and should be re-specified.`;
}

export function parseClassifyResponse(s: DimSignals, raw: string): DimClassification | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const start = cleaned.indexOf('{');
    if (start === -1) return null;
    const parsed = JSON.parse(cleaned.slice(start)) as { category?: string; reason?: string };
    const category = parsed.category as DimCategory;
    if (!LLM_CATEGORIES.includes(category)) return null;
    return {
      id: s.id, label: s.label, score: s.score, category,
      route: ROUTE_BY_CATEGORY[category],
      reason: (parsed.reason || 'classified by judgment pass').trim(),
      needsLLM: false,
    };
  } catch { return null; }
}

// ── Reporting ──────────────────────────────────────────────────────────────────

export interface TriageSummary {
  total: number;
  byCategory: Record<DimCategory, number>;
  byRoute: Record<DimRoute, number>;
}

export function summarize(classes: DimClassification[]): TriageSummary {
  const byCategory = { ceilinged: 0, yardstick_bug: 0, feature_construction: 0, surgical: 0, unknown: 0 } as Record<DimCategory, number>;
  const byRoute = { none: 0, autoresearch: 0, matrixdev: 0, 'fix-test': 0, manual: 0 } as Record<DimRoute, number>;
  for (const c of classes) { byCategory[c.category]++; byRoute[c.route]++; }
  return { total: classes.length, byCategory, byRoute };
}

export function formatTriageReport(project: string, classes: DimClassification[]): string {
  const s = summarize(classes);
  const lines: string[] = [
    `# Dimension Triage — ${project}`,
    '',
    `Triaged ${s.total} sub-target dimension(s). Route each to the loop that can actually move it.`,
    '',
    '## Summary',
    `- **surgical** → autoresearch: ${s.byCategory.surgical}`,
    `- **feature_construction** → matrixdev/forge: ${s.byCategory.feature_construction}`,
    `- **yardstick_bug** → fix the test: ${s.byCategory.yardstick_bug}`,
    `- **ceilinged** → mark + skip: ${s.byCategory.ceilinged}`,
    `- **unknown** → manual review: ${s.byCategory.unknown}`,
    '',
    '## Dimensions',
    '| dim | score | category | route | why |',
    '|-----|-------|----------|-------|-----|',
  ];
  for (const c of [...classes].sort((a, b) => a.category.localeCompare(b.category) || a.score - b.score)) {
    lines.push(`| ${c.id} | ${c.score} | ${c.category} | ${c.route} | ${c.reason.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  return lines.join('\n');
}
