// tool-search.ts — searchable + token-budgeted MCP tool discovery.
//
// PROVENANCE (engineering-frontier, server-owned slice of the ecosystem_mcp bundle): the council named
// "lazy/searchable tool discovery" and "schema-token budgeting" as part of the genuine rung-9 surface, with CLEAN
// attribution — DanteForge IS the server exposing 60+ tools, so helping a host discover the right ones WITHOUT
// loading every schema (context-token bloat) is squarely the server's own job. A host on a tight context budget
// can call a discovery tool with a query instead of paying for all schemas up front.

import type { ToolDefinition } from './mcp-tool-definitions.js';

export interface ToolSearchHit {
  name: string;
  description: string;
  /** Relevance score (higher = better). Name matches weigh more than description matches. */
  score: number;
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length > 1);
}

/**
 * Rank tools by relevance to a free-text query (deterministic). Exact name-token matches weigh most, then a
 * substring in the name, then description-term overlap. Returns at most `limit` hits with score > 0.
 */
export function searchTools(query: string, defs: ToolDefinition[], limit = 8): ToolSearchHit[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const hits: ToolSearchHit[] = [];
  for (const def of defs) {
    const lowerName = def.name.toLowerCase();
    const nameTokens = new Set(tokenize(def.name));
    const descTokens = new Set(tokenize(def.description));
    let score = 0;
    for (const t of terms) {
      if (nameTokens.has(t)) score += 5;
      else if (lowerName.includes(t)) score += 3;
      if (descTokens.has(t)) score += 1;
    }
    if (score > 0) hits.push({ name: def.name, description: def.description, score });
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, Math.max(0, limit));
}

const CHARS_PER_TOKEN = 4; // a coarse, model-agnostic estimate (~4 chars/token) — for budgeting, not billing

/** Rough context-token cost of a single tool's schema (name + description + JSON inputSchema). */
export function toolSchemaTokens(def: ToolDefinition): number {
  const json = def.name + def.description + JSON.stringify(def.inputSchema ?? {});
  return Math.ceil(json.length / CHARS_PER_TOKEN);
}

/** The combined schema-token cost of exposing an entire tool set up front. */
export function totalSchemaTokens(defs: ToolDefinition[]): number {
  return defs.reduce((sum, d) => sum + toolSchemaTokens(d), 0);
}

/**
 * Lazy discovery: the most query-relevant tools whose COMBINED schema cost fits `maxTokens`. Greedy by relevance,
 * skipping any tool that would bust the budget — so a host can ask "which tools fit my remaining context?" and
 * get a usable, ranked subset instead of the whole catalog.
 */
export function selectWithinBudget(query: string, defs: ToolDefinition[], maxTokens: number): ToolSearchHit[] {
  const byName = new Map(defs.map(d => [d.name, d]));
  const ranked = searchTools(query, defs, defs.length);
  const out: ToolSearchHit[] = [];
  let used = 0;
  for (const hit of ranked) {
    const cost = toolSchemaTokens(byName.get(hit.name)!);
    if (used + cost > maxTokens) continue;
    out.push(hit);
    used += cost;
  }
  return out;
}

/** The discovery tool itself — lets a host find DanteForge's tools by query without loading every schema. */
export const SEARCH_TOOLS_TOOL: ToolDefinition = {
  name: 'danteforge_search_tools',
  description: "Search DanteForge's MCP tools by free-text query and get the most relevant ones ranked by relevance. "
    + 'Use this to discover the right tool on a tight context budget WITHOUT loading every tool schema up front. '
    + 'Returns each match\'s name, description, and score.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text query, e.g. "score a dimension" or "run a gate".' },
      limit: { type: 'number', description: 'Maximum number of results to return (default 8).' },
    },
    required: ['query'],
  },
};
