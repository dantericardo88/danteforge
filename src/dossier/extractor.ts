// src/dossier/extractor.ts — LLM-based evidence extraction per rubric dimension

import type { EvidenceItem, RubricDimension } from './types.js';

export type LLMCallerFn = (prompt: string, provider?: string) => Promise<string>;

export interface ExtractorDeps {
  _callLLM?: LLMCallerFn;
}

const CHUNK_SIZE = 3000; // ~3000 chars per chunk to stay well within 4096 token limit

function chunkContent(content: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : [''];
}

function formatRubricCriteria(dimDef: RubricDimension): string {
  return Object.entries(dimDef.scoreCriteria)
    .sort(([a], [b]) => Number(b) - Number(a)) // 9 first, 1 last
    .map(([score, criteria]) =>
      `Score ${score}: ${(criteria as string[]).map((c) => `- ${c}`).join('\n')}`,
    )
    .join('\n\n');
}

function buildExtractionPrompt(
  competitor: string,
  dim: number,
  dimDef: RubricDimension,
  sourceUrl: string,
  chunk: string,
): string {
  return (
    `You are extracting competitive intelligence evidence from product documentation.\n\n` +
    `COMPETITOR: ${competitor}\n` +
    `DIMENSION: ${dim} — ${dimDef.name}\n` +
    `SCORING CRITERIA:\n${formatRubricCriteria(dimDef)}\n\n` +
    `SOURCE CONTENT (from ${sourceUrl}):\n${chunk}\n\n` +
    `Task: Find all evidence in the source content that is relevant to this dimension.\n` +
    `For each piece of evidence:\n` +
    `1. State the specific claim (one sentence)\n` +
    `2. Copy the exact verbatim quote from the source (do not paraphrase)\n` +
    `3. Note the source URL\n\n` +
    `If no relevant evidence exists in this content, return an empty array.\n\n` +
    `Return JSON only (no explanation, no markdown code fences):\n` +
    `[{"claim":"...","quote":"...","source":"${sourceUrl}"}]`
  );
}

function parseEvidenceItems(raw: string, dim: number, sourceUrl: string): EvidenceItem[] {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is { claim: string; quote: string; source: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['claim'] === 'string' &&
        typeof (item as Record<string, unknown>)['quote'] === 'string' &&
        typeof (item as Record<string, unknown>)['source'] === 'string',
    )
    .map((item) => ({
      claim: item.claim,
      quote: item.quote,
      source: item.source || sourceUrl,
      dim,
    }));
}

async function defaultLLMCaller(prompt: string, provider?: string): Promise<string> {
  const { callLLM } = await import('../core/llm.js');
  return callLLM(prompt, (provider ?? 'claude') as never);
}

export async function extractEvidence(
  sourceContent: string,
  sourceUrl: string,
  competitor: string,
  dim: number,
  dimDef: RubricDimension,
  deps: ExtractorDeps = {},
): Promise<EvidenceItem[]> {
  const callLLM = deps._callLLM ?? defaultLLMCaller;
  const chunks = chunkContent(sourceContent);
  const allEvidence: EvidenceItem[] = [];

  for (const chunk of chunks) {
    const prompt = buildExtractionPrompt(competitor, dim, dimDef, sourceUrl, chunk);
    let raw: string;
    try {
      raw = await callLLM(prompt, 'claude');
    } catch {
      // Best-effort: skip this chunk on LLM failure
      continue;
    }
    const items = parseEvidenceItems(raw, dim, sourceUrl);
    allEvidence.push(...items);
  }

  return allEvidence;
}

// Exported for testing
export { chunkContent, formatRubricCriteria, buildExtractionPrompt, parseEvidenceItems };
