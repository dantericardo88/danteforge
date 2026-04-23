// src/dossier/self-scorer.ts — Scores DanteForge itself using source files as evidence

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dossier, DossierDimension, EvidenceItem, RubricDimension } from './types.js';
import type { ExtractorDeps } from './extractor.js';
import type { ScorerDeps } from './scorer.js';
import type { Rubric } from './types.js';

export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type WriteFileFn = (p: string, d: string) => Promise<void>;
export type MkdirFn = (p: string, opts: { recursive: boolean }) => Promise<unknown>;
export type GlobFn = (pattern: string, opts: { cwd: string }) => Promise<string[]>;
export type GetRubricFn = (cwd: string) => Promise<Rubric>;

export type SelfExtractEvidenceFn = (
  fileContent: string,
  filePath: string,
  dim: number,
  dimDef: RubricDimension,
  deps?: ExtractorDeps,
) => Promise<EvidenceItem[]>;

export type ScoreDimensionFn = (
  evidence: EvidenceItem[],
  dim: number,
  dimDef: RubricDimension,
  competitor: string,
  deps?: ScorerDeps,
) => Promise<{ score: number; justification: string }>;

export interface SelfScorerOptions {
  cwd: string;
  competitorId?: string;      // default: "dantescode"
  displayName?: string;       // default: project name from package.json
  sourceGlob?: string[];      // files to read; defaults to key src/ patterns
  // Injection seams
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _mkdir?: MkdirFn;
  _glob?: GlobFn;
  _loadRubric?: GetRubricFn;
  _extractEvidence?: SelfExtractEvidenceFn;
  _scoreDimension?: ScoreDimensionFn;
}

const DEFAULT_SELF_COMPETITOR_ID = 'dantescode';
const DEFAULT_SOURCE_PATTERNS = [
  'src/core/*.ts',
  'src/cli/commands/*.ts',
  'src/dossier/*.ts',
];

// Key source files to read for self-scoring (bounded set)
const KEY_SOURCE_FILES = [
  'src/core/ascend-engine.ts',
  'src/core/autoforge-loop.ts',
  'src/core/llm.ts',
  'src/core/llm-stream.ts',
  'src/core/mcp-server.ts',
  'src/core/harsh-scorer.ts',
  'src/core/compete-matrix.ts',
  'src/core/circuit-breaker.ts',
  'src/core/state.ts',
  'src/cli/commands/forge.ts',
  'src/cli/commands/ascend.ts',
  'src/cli/commands/go.ts',
  'src/cli/commands/score.ts',
  'src/cli/commands/assess.ts',
  'src/dossier/builder.ts',
  'src/dossier/landscape.ts',
];

function buildCodeExtractionPrompt(
  dim: number,
  dimDef: RubricDimension,
  filePath: string,
  fileContent: string,
): string {
  const criteriaBlock = Object.entries(dimDef.scoreCriteria)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([score, criteria]) =>
      `Score ${score}: ${(criteria as string[]).join(' | ')}`,
    )
    .join('\n');

  return (
    `You are extracting evidence of a software feature from TypeScript source code.\n\n` +
    `DIMENSION: ${dim} — ${dimDef.name}\n` +
    `SCORING CRITERIA:\n${criteriaBlock}\n\n` +
    `SOURCE FILE: ${filePath}\n` +
    `FILE CONTENT:\n${fileContent.slice(0, 3000)}\n\n` +
    `Task: Find all evidence in this file that is relevant to the dimension above.\n` +
    `Evidence items must reference real code in the file: function signatures, doc comments, variable names, etc.\n\n` +
    `For each piece of evidence:\n` +
    `1. State the specific claim (one sentence)\n` +
    `2. Quote the exact relevant line(s) from the file (e.g. function signature or comment)\n` +
    `3. Use source format: "${filePath}#<functionOrSymbolName>"\n\n` +
    `If no relevant evidence exists in this file, return an empty array.\n\n` +
    `Return JSON only:\n` +
    `[{"claim":"...","quote":"...","source":"${filePath}#symbolName"}]`
  );
}

async function selfExtractEvidence(
  fileContent: string,
  filePath: string,
  dim: number,
  dimDef: RubricDimension,
  deps: ExtractorDeps = {},
): Promise<EvidenceItem[]> {
  const { parseEvidenceItems } = await import('./extractor.js');

  async function defaultLLMCaller(prompt: string): Promise<string> {
    const { callLLM } = await import('../core/llm.js');
    return callLLM(prompt, 'claude' as never);
  }

  const callLLM = deps._callLLM ?? defaultLLMCaller;
  const prompt = buildCodeExtractionPrompt(dim, dimDef, filePath, fileContent);

  let raw: string;
  try {
    raw = await callLLM(prompt);
  } catch {
    return [];
  }

  const items = parseEvidenceItems(raw, dim, filePath);
  return items;
}

function dossierDir(cwd: string): string {
  return path.join(cwd, '.danteforge', 'dossiers');
}

function dossierPath(cwd: string, id: string): string {
  return path.join(dossierDir(cwd), `${id}.json`);
}

function dossierHistoryDir(cwd: string, id: string): string {
  return path.join(dossierDir(cwd), 'history', id);
}

function dossierSnapshotPath(cwd: string, id: string, lastBuilt: string): string {
  return path.join(dossierHistoryDir(cwd, id), `${lastBuilt.replace(/[:.]/g, '-')}.json`);
}

async function loadExistingDossier(
  cwd: string,
  id: string,
  readFileFn: ReadFileFn,
): Promise<Dossier | null> {
  try {
    const raw = await readFileFn(dossierPath(cwd, id), 'utf8');
    return JSON.parse(raw) as Dossier;
  } catch {
    return null;
  }
}

function computeComposite(dimensions: Record<string, DossierDimension>): number {
  const scores = Object.values(dimensions).map((d) => d.humanOverride ?? d.score);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

async function buildDossierDimensions(
  dimEntries: Array<[string, RubricDimension]>,
  fileContents: Array<{ filePath: string; content: string }>,
  extractEvidenceFn: SelfExtractEvidenceFn,
  scoreDimensionFn: ScoreDimensionFn,
  displayName: string,
): Promise<Record<string, DossierDimension>> {
  const dimensions: Record<string, DossierDimension> = {};
  for (const [dimKey, dimDef] of dimEntries) {
    const dimNum = parseInt(dimKey, 10);
    let allEvidence: EvidenceItem[] = [];
    for (const { filePath, content } of fileContents) {
      const evidence = await extractEvidenceFn(content, filePath, dimNum, dimDef);
      allEvidence = allEvidence.concat(evidence);
    }
    const { score, justification } = await scoreDimensionFn(allEvidence, dimNum, dimDef, displayName);
    const unverified = allEvidence.length === 0 ||
      allEvidence.every((e) => !e.quote || e.quote.trim() === '');
    dimensions[dimKey] = {
      score,
      scoreJustification: justification,
      evidence: allEvidence,
      humanOverride: null,
      humanOverrideReason: null,
      unverified,
    };
  }
  return dimensions;
}

export async function buildSelfDossier(opts: SelfScorerOptions): Promise<Dossier> {
  const { cwd } = opts;
  const competitorId = opts.competitorId ?? DEFAULT_SELF_COMPETITOR_ID;

  const { getRubric: defaultGetRubric } = await import('./rubric.js');
  const { scoreDimension: defaultScore } = await import('./scorer.js');

  const loadRubricFn = opts._loadRubric ?? defaultGetRubric;
  const scoreDimensionFn = opts._scoreDimension ?? defaultScore;
  const extractEvidenceFn = opts._extractEvidence ?? selfExtractEvidence;
  const readFileFn: ReadFileFn = opts._readFile ?? ((p, e) => fs.readFile(p, e as BufferEncoding));
  const writeFileFn: WriteFileFn = opts._writeFile ?? ((p, d) => fs.writeFile(p, d));
  const mkdirFn: MkdirFn = opts._mkdir ?? ((p, o) => fs.mkdir(p, o));
  const existing = await loadExistingDossier(cwd, competitorId, readFileFn);

  const rubric = await loadRubricFn(cwd);

  // Resolve display name from package.json if not provided
  let displayName = opts.displayName ?? 'DanteForge';
  try {
    const pkgRaw = await readFileFn(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    if (typeof pkg['name'] === 'string') displayName = pkg['name'];
  } catch { /* use default */ }

  // Determine source files to read
  const sourceFiles = opts.sourceGlob ?? KEY_SOURCE_FILES;

  // Read source files
  const fileContents: Array<{ filePath: string; content: string }> = [];
  for (const relPath of sourceFiles) {
    const absPath = path.join(cwd, relPath);
    try {
      const content = await readFileFn(absPath, 'utf8');
      fileContents.push({ filePath: relPath, content });
    } catch { /* skip missing files */ }
  }

  const dimensions = await buildDossierDimensions(
    Object.entries(rubric.dimensions),
    fileContents,
    extractEvidenceFn,
    scoreDimensionFn,
    displayName,
  );

  const dossier: Dossier = {
    competitor: competitorId,
    displayName,
    type: 'open-source',
    lastBuilt: new Date().toISOString(),
    sources: fileContents.map(({ filePath }) => ({
      url: filePath,
      fetchedAt: new Date().toISOString(),
      title: filePath,
      contentHash: `file:${filePath}`,
    })),
    dimensions,
    composite: computeComposite(dimensions),
    compositeMethod: 'mean_28_dims',
    rubricVersion: rubric.version,
  };

  await mkdirFn(dossierDir(cwd), { recursive: true });
  if (existing) {
    await mkdirFn(dossierHistoryDir(cwd, competitorId), { recursive: true });
    await writeFileFn(
      dossierSnapshotPath(cwd, competitorId, existing.lastBuilt),
      JSON.stringify(existing, null, 2),
    );
  }
  await writeFileFn(dossierPath(cwd, competitorId), JSON.stringify(dossier, null, 2));

  return dossier;
}
