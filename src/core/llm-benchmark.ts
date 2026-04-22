// LLM Benchmark — A/B comparison: raw prompt vs DanteForge-structured context
import path from 'node:path';
import fs from 'node:fs/promises';
import { callLLM } from './llm.js';

export interface BenchmarkTask {
  id: string;
  description: string;
  successCriteria: string[];
}

export interface BenchmarkApproach {
  name: 'raw' | 'danteforge';
  prompt: string;
  response: string;
  durationMs: number;
}

export interface BenchmarkMetrics {
  testLinesRatio: number;      // 0-1: lines with test/describe/it keywords / total lines
  errorHandlingRatio: number;  // 0-1: lines with try/catch/throw / total lines
  typeSafetyScore: number;     // 0-1: TypeScript type annotation count / function count (capped at 1)
  completenessScore: number;   // 0-1: successCriteria matched / total criteria
  docCoverageRatio: number;    // 0-1: JSDoc/comment lines / function count (capped at 1)
}

export interface BenchmarkResult {
  task: BenchmarkTask;
  raw: BenchmarkApproach & { metrics: BenchmarkMetrics };
  danteforge: BenchmarkApproach & { metrics: BenchmarkMetrics };
  improvement: {
    testLinesRatio: number;
    errorHandlingRatio: number;
    typeSafetyScore: number;
    completenessScore: number;
    docCoverageRatio: number;
    overallDeltaPercent: number;  // average of all 5 deltas * 100
  };
  verdict: 'significant' | 'moderate' | 'marginal' | 'none';
  savedAt: string;  // ISO timestamp
}

export interface LLMBenchmarkOptions {
  cwd?: string;
  _llmCaller?: (prompt: string) => Promise<string>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function measureOutputMetrics(output: string, task: BenchmarkTask): BenchmarkMetrics {
  const lines = output.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const total = nonEmptyLines.length;

  if (total === 0) {
    const completenessScore = task.successCriteria.length === 0 ? 1.0 : 0;
    return {
      testLinesRatio: 0,
      errorHandlingRatio: 0,
      typeSafetyScore: 0,
      completenessScore,
      docCoverageRatio: 0,
    };
  }

  // testLinesRatio
  const testLineCount = nonEmptyLines.filter((l) =>
    /\b(test|describe|it|expect|assert|beforeEach|afterEach)\b/i.test(l),
  ).length;
  const testLinesRatio = round4(testLineCount / total);

  // errorHandlingRatio
  const errorLineCount = nonEmptyLines.filter((l) =>
    /\b(try|catch|throw|Error|reject)\b/.test(l),
  ).length;
  const errorHandlingRatio = round4(errorLineCount / total);

  // typeSafetyScore
  const annotationCount = (output.match(/:\s*\w+|<\w+>|interface\s|type\s/g) ?? []).length;
  const functionCount = (output.match(/function|=>|\bconst\s+\w+\s*=/g) ?? []).length;
  let typeSafetyScore: number;
  if (functionCount === 0) {
    typeSafetyScore = round4(Math.min(annotationCount / 5, 1.0));
  } else {
    typeSafetyScore = round4(Math.min(annotationCount / functionCount, 1.0));
  }

  // completenessScore
  let completenessScore: number;
  if (task.successCriteria.length === 0) {
    completenessScore = 1.0;
  } else {
    const lowerOutput = output.toLowerCase();
    let matched = 0;
    for (const criterion of task.successCriteria) {
      const words = criterion.split(/\s+/).filter((w) => w.length >= 4);
      const anyMatch = words.some((w) => lowerOutput.includes(w.toLowerCase()));
      if (anyMatch) matched++;
    }
    completenessScore = round4(matched / task.successCriteria.length);
  }

  // docCoverageRatio
  const commentLineCount = nonEmptyLines.filter((l) =>
    /^\s*(\/\/|\/\*|\*|#)/.test(l),
  ).length;
  let docCoverageRatio: number;
  if (functionCount === 0) {
    docCoverageRatio = round4(Math.min(commentLineCount / 3, 1.0));
  } else {
    docCoverageRatio = round4(Math.min(commentLineCount / functionCount, 1.0));
  }

  return {
    testLinesRatio,
    errorHandlingRatio,
    typeSafetyScore,
    completenessScore,
    docCoverageRatio,
  };
}

async function buildDanteForgePrompt(
  task: BenchmarkTask,
  cwd: string,
  readFile: (p: string) => Promise<string>,
  exists: (p: string) => Promise<boolean>,
): Promise<string> {
  const artifactPaths: Array<{ label: string; filePath: string }> = [
    { label: 'CONSTITUTION', filePath: path.join(cwd, '.danteforge', 'CONSTITUTION.md') },
    { label: 'SPECIFICATION', filePath: path.join(cwd, '.danteforge', 'SPEC.md') },
    { label: 'PLAN', filePath: path.join(cwd, '.danteforge', 'PLAN.md') },
  ];

  const contextParts: string[] = [];
  for (const artifact of artifactPaths) {
    try {
      const fileExists = await exists(artifact.filePath);
      if (!fileExists) continue;
      const content = await readFile(artifact.filePath);
      contextParts.push(`${artifact.label}:\n${content}\n`);
    } catch {
      // best-effort: skip missing files
    }
  }

  let prompt = 'You are implementing a feature. Follow these project rules exactly:\n\n';
  for (const part of contextParts) {
    prompt += `${part}\n`;
  }
  prompt += `TASK: ${task.description}\n\nImplement this feature following all project principles. Include tests.`;
  return prompt;
}

function assembleBenchmarkResult(
  task: BenchmarkTask,
  rawPrompt: string, rawResponse: string, rawDurationMs: number,
  danteforgePrompt: string, danteforgeResponse: string, dfDurationMs: number,
): BenchmarkResult {
  const rawMetrics = measureOutputMetrics(rawResponse, task);
  const dfMetrics = measureOutputMetrics(danteforgeResponse, task);
  const deltaTest = round4(dfMetrics.testLinesRatio - rawMetrics.testLinesRatio);
  const deltaError = round4(dfMetrics.errorHandlingRatio - rawMetrics.errorHandlingRatio);
  const deltaType = round4(dfMetrics.typeSafetyScore - rawMetrics.typeSafetyScore);
  const deltaComplete = round4(dfMetrics.completenessScore - rawMetrics.completenessScore);
  const deltaDoc = round4(dfMetrics.docCoverageRatio - rawMetrics.docCoverageRatio);
  const overallDeltaPercent = round4(((deltaTest + deltaError + deltaType + deltaComplete + deltaDoc) / 5) * 100);
  let verdict: BenchmarkResult['verdict'];
  if (overallDeltaPercent > 20) verdict = 'significant';
  else if (overallDeltaPercent > 5) verdict = 'moderate';
  else if (overallDeltaPercent > 0) verdict = 'marginal';
  else verdict = 'none';
  return {
    task,
    raw: { name: 'raw', prompt: rawPrompt, response: rawResponse, durationMs: rawDurationMs, metrics: rawMetrics },
    danteforge: { name: 'danteforge', prompt: danteforgePrompt, response: danteforgeResponse, durationMs: dfDurationMs, metrics: dfMetrics },
    improvement: { testLinesRatio: deltaTest, errorHandlingRatio: deltaError, typeSafetyScore: deltaType, completenessScore: deltaComplete, docCoverageRatio: deltaDoc, overallDeltaPercent },
    verdict,
    savedAt: new Date().toISOString(),
  };
}

export async function runLLMBenchmark(
  task: BenchmarkTask,
  opts: LLMBenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const cwd = opts.cwd ?? process.cwd();
  const llm = opts._llmCaller ?? ((prompt: string) => callLLM(prompt));
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = opts._writeFile ?? ((p: string, content: string) => fs.writeFile(p, content, 'utf8'));
  const exists = opts._exists ?? ((p: string) => fs.access(p).then(() => true).catch(() => false));

  const rawPrompt = task.description;
  const rawStart = Date.now();
  const rawResponse = await llm(rawPrompt);
  const rawDurationMs = Date.now() - rawStart;

  const danteforgePrompt = await buildDanteForgePrompt(task, cwd, readFile, exists);
  const dfStart = Date.now();
  const danteforgeResponse = await llm(danteforgePrompt);
  const dfDurationMs = Date.now() - dfStart;

  const result = assembleBenchmarkResult(task, rawPrompt, rawResponse, rawDurationMs, danteforgePrompt, danteforgeResponse, dfDurationMs);

  // --- Save results ---
  const resultsPath = path.join(cwd, '.danteforge', 'benchmark-results.json');
  let existing: BenchmarkResult[] = [];
  try {
    const raw = await readFile(resultsPath);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      existing = parsed as BenchmarkResult[];
    }
  } catch {
    // file missing or invalid — start fresh
  }
  existing.push(result);
  try {
    await writeFile(resultsPath, JSON.stringify(existing, null, 2));
  } catch {
    // best-effort write
  }

  return result;
}

export function formatBenchmarkReport(result: BenchmarkResult): string {
  const lines: string[] = [];
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const delta = (n: number): string => (n >= 0 ? `+${(n * 100).toFixed(1)}%` : `${(n * 100).toFixed(1)}%`);

  lines.push(`LLM Benchmark — ${result.task.description}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push('BEFORE (raw prompt):');
  lines.push(`  Test coverage ratio  : ${pct(result.raw.metrics.testLinesRatio)}`);
  lines.push(`  Error handling ratio : ${pct(result.raw.metrics.errorHandlingRatio)}`);
  lines.push(`  Type safety score    : ${pct(result.raw.metrics.typeSafetyScore)}`);
  lines.push(`  Completeness score   : ${pct(result.raw.metrics.completenessScore)}`);
  lines.push(`  Doc coverage ratio   : ${pct(result.raw.metrics.docCoverageRatio)}`);
  lines.push('');
  lines.push('AFTER (DanteForge structured context):');
  lines.push(`  Test coverage ratio  : ${pct(result.danteforge.metrics.testLinesRatio)}`);
  lines.push(`  Error handling ratio : ${pct(result.danteforge.metrics.errorHandlingRatio)}`);
  lines.push(`  Type safety score    : ${pct(result.danteforge.metrics.typeSafetyScore)}`);
  lines.push(`  Completeness score   : ${pct(result.danteforge.metrics.completenessScore)}`);
  lines.push(`  Doc coverage ratio   : ${pct(result.danteforge.metrics.docCoverageRatio)}`);
  lines.push('');
  lines.push('IMPROVEMENT:');
  lines.push(`  Test coverage ratio  : ${delta(result.improvement.testLinesRatio)}`);
  lines.push(`  Error handling ratio : ${delta(result.improvement.errorHandlingRatio)}`);
  lines.push(`  Type safety score    : ${delta(result.improvement.typeSafetyScore)}`);
  lines.push(`  Completeness score   : ${delta(result.improvement.completenessScore)}`);
  lines.push(`  Doc coverage ratio   : ${delta(result.improvement.docCoverageRatio)}`);
  lines.push('');
  lines.push(`  Overall delta        : ${result.improvement.overallDeltaPercent >= 0 ? '+' : ''}${result.improvement.overallDeltaPercent.toFixed(2)}%`);
  lines.push(`  Verdict              : ${result.verdict.toUpperCase()}`);
  lines.push('');
  lines.push(`Saved: ${result.savedAt}`);

  return lines.join('\n');
}

export async function loadBenchmarkHistory(
  cwd: string,
  opts: Pick<LLMBenchmarkOptions, '_readFile'> = {},
): Promise<BenchmarkResult[]> {
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const resultsPath = path.join(cwd, '.danteforge', 'benchmark-results.json');
  try {
    const raw = await readFile(resultsPath);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as BenchmarkResult[];
    }
    return [];
  } catch {
    return [];
  }
}
