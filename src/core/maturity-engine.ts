// Maturity-Aware Quality Scoring Engine
// Scores artifacts across 8 quality dimensions + maps to 6 maturity levels

import fs from 'fs/promises';
import path from 'path';
import type { DanteState } from './state.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import { type MaturityLevel, scoreToMaturityLevel, getMaturityLevelName, describeLevelForFounders } from './maturity-levels.js';

export interface MaturityDimensions {
  functionality: number;      // 0-100 (PDSE completeness + integration fitness)
  testing: number;            // 0-100 (coverage, test files, c8rc config)
  errorHandling: number;      // 0-100 (try/catch, custom errors, ratio to functions)
  security: number;           // 0-100 (env vars, npm audit, dangerous patterns)
  uxPolish: number;           // 0-100 (loading states, accessibility, responsive)
  documentation: number;      // 0-100 (PDSE clarity + freshness)
  performance: number;        // 0-100 (nested loops, O(n²) patterns, profiling)
  maintainability: number;    // 0-100 (PDSE testability + constitution + function size)
}

export type GapSeverity = 'critical' | 'major' | 'minor';

export interface QualityGap {
  dimension: keyof MaturityDimensions;
  currentScore: number;
  targetScore: number;
  gapSize: number;
  severity: GapSeverity;
  recommendation: string;
}

export type MaturityRecommendation = 'proceed' | 'refine' | 'blocked' | 'target-exceeded';

export interface MaturityAssessment {
  currentLevel: MaturityLevel;
  targetLevel: MaturityLevel;
  overallScore: number;
  dimensions: MaturityDimensions;
  gaps: QualityGap[];
  founderExplanation: string;
  recommendation: MaturityRecommendation;
  timestamp: string;
}

export interface MaturityContext {
  cwd: string;
  state: DanteState;
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>;
  targetLevel: MaturityLevel;
  evidenceDir?: string;
  // Injection seams for testing
  _readFile?: (path: string) => Promise<string>;
  _readdir?: (path: string) => Promise<string[]>;
  _fileExists?: (path: string) => Promise<boolean>;
}

// ── 8-Dimension Scoring Heuristics ─────────────────────────────────────────

export async function scoreMaturityDimensions(
  ctx: MaturityContext,
): Promise<MaturityDimensions> {
  const readFile = ctx._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const readdir = ctx._readdir ?? ((p: string) => fs.readdir(p));
  const fileExists = ctx._fileExists ?? (async (p: string) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  });

  // 1. Functionality: Combine PDSE completeness + integrationFitness
  const functionality = await scoreFunctionality(ctx);

  // 2. Testing: Parse .c8rc.json, check for test files, read coverage summary
  const testing = await scoreTesting(ctx, readFile, readdir, fileExists);

  // 3. Error Handling: Grep for throw, try/catch, custom error classes
  const errorHandling = await scoreErrorHandling(ctx, readFile, readdir);

  // 4. Security: Scan for secrets, eval, npm audit
  const security = await scoreSecurity(ctx, readFile, readdir, fileExists);

  // 5. UX Polish: For web projects, grep for loading states, aria, responsive
  const uxPolish = await scoreUxPolish(ctx, readFile, readdir);

  // 6. Documentation: Combine PDSE clarity + freshness
  const documentation = scoreDocumentation(ctx);

  // 7. Performance: Scan for nested loops, SELECT *, await in loops
  const performance = await scorePerformance(ctx, readFile, readdir);

  // 8. Maintainability: PDSE testability + constitution + penalize >100 LOC functions
  const maintainability = await scoreMaintainability(ctx, readFile, readdir);

  return {
    functionality,
    testing,
    errorHandling,
    security,
    uxPolish,
    documentation,
    performance,
    maintainability,
  };
}

// ── Functionality: PDSE completeness + integrationFitness ──────────────────

async function scoreFunctionality(ctx: MaturityContext): Promise<number> {
  const pdseScores = Object.values(ctx.pdseScores);
  if (pdseScores.length === 0) return 50; // neutral default

  let totalCompleteness = 0;
  let totalIntegration = 0;
  let count = 0;

  for (const result of pdseScores) {
    if (!result) continue;
    totalCompleteness += result.dimensions.completeness;
    totalIntegration += result.dimensions.integrationFitness;
    count++;
  }

  if (count === 0) return 50;

  // Weighted average: 70% completeness (max 20), 30% integration (max 10)
  const avgCompleteness = totalCompleteness / count; // 0-20
  const avgIntegration = totalIntegration / count;   // 0-10

  const normalized = (avgCompleteness / 20) * 70 + (avgIntegration / 10) * 30;
  return Math.round(Math.min(100, normalized));
}

// ── Testing: Coverage files, test files, .c8rc.json ───────────────────────

async function scoreTesting(
  ctx: MaturityContext,
  readFile: (path: string) => Promise<string>,
  readdir: (path: string) => Promise<string[]>,
  fileExists: (path: string) => Promise<boolean>,
): Promise<number> {
  let score = 50; // neutral default

  // Check for .c8rc.json
  const c8Path = path.join(ctx.cwd, '.c8rc.json');
  if (await fileExists(c8Path)) {
    score += 10;
  }

  // Check for test directory
  const testDir = path.join(ctx.cwd, 'tests');
  let testFileCount = 0;
  try {
    const entries = await readdir(testDir);
    testFileCount = entries.filter(e => e.endsWith('.test.ts') || e.endsWith('.test.js')).length;
    if (testFileCount > 0) {
      score += Math.min(20, testFileCount * 2);
    }
  } catch {
    // No test directory
  }

  // Check for coverage summary
  const evidenceDir = ctx.evidenceDir ?? path.join(ctx.cwd, '.danteforge', 'evidence');
  const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
  if (await fileExists(coveragePath)) {
    try {
      const content = await readFile(coveragePath);
      const summary = JSON.parse(content) as { total?: { lines?: { pct?: number } } };
      const lineCoverage = summary.total?.lines?.pct ?? 0;
      if (lineCoverage >= 90) score += 20;
      else if (lineCoverage >= 85) score += 15;
      else if (lineCoverage >= 80) score += 10;
      else if (lineCoverage >= 70) score += 5;
    } catch {
      // Invalid JSON or missing fields
    }
  }

  return Math.min(100, score);
}

// ── Error Handling: throw, try/catch, custom error classes ────────────────

async function scoreErrorHandling(
  ctx: MaturityContext,
  readFile: (path: string) => Promise<string>,
  readdir: (path: string) => Promise<string[]>,
): Promise<number> {
  let throwCount = 0;
  let tryCount = 0;
  let customErrorCount = 0;
  let functionCount = 0;

  const srcDir = path.join(ctx.cwd, 'src');
  try {
    const files = await collectTypeScriptFiles(srcDir, readdir);
    for (const filePath of files) {
      try {
        const content = await readFile(filePath);
        throwCount += (content.match(/throw new/g) || []).length;
        tryCount += (content.match(/try\s*\{/g) || []).length;
        customErrorCount += (content.match(/class\s+\w+Error\s+extends\s+Error/g) || []).length;
        functionCount += (content.match(/function\s+\w+|=>\s*\{|async\s+\w+\(/g) || []).length;
      } catch {
        // Unreadable file
      }
    }
  } catch {
    // No src directory
    return 50;
  }

  if (functionCount === 0) return 50;

  const ratio = (tryCount + throwCount) / functionCount;
  let score = Math.round(ratio * 100);

  if (customErrorCount > 0) {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
}

// ── Security: Secrets, eval, npm audit ─────────────────────────────────────

async function scoreSecurity(
  ctx: MaturityContext,
  readFile: (path: string) => Promise<string>,
  readdir: (path: string) => Promise<string[]>,
  fileExists: (path: string) => Promise<boolean>,
): Promise<number> {
  let score = 70; // Assume decent baseline

  const srcDir = path.join(ctx.cwd, 'src');
  let dangerousPatterns = 0;

  try {
    const files = await collectTypeScriptFiles(srcDir, readdir);
    for (const filePath of files) {
      try {
        const content = await readFile(filePath);
        if (/process\.env\.SECRET/i.test(content)) dangerousPatterns++;
        if (/eval\(/g.test(content)) dangerousPatterns++;
        if (/innerHTML\s*=/g.test(content)) dangerousPatterns++;
        if (/FROM.*WHERE/i.test(content)) {
          // SQL query without parameterization check
          if (!/\$\d+|\?/g.test(content)) dangerousPatterns++;
        }
      } catch {
        // Unreadable file
      }
    }
  } catch {
    // No src directory
  }

  score -= dangerousPatterns * 10;

  // Check for .env file (good practice)
  const envPath = path.join(ctx.cwd, '.env');
  if (await fileExists(envPath)) {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
}

// ── UX Polish: Loading states, accessibility, responsive ───────────────────

async function scoreUxPolish(
  ctx: MaturityContext,
  readFile: (path: string) => Promise<string>,
  readdir: (path: string) => Promise<string[]>,
): Promise<number> {
  if (ctx.state.projectType !== 'web') {
    return 50; // N/A for non-web projects
  }

  let score = 50;
  const srcDir = path.join(ctx.cwd, 'src');

  try {
    const files = await collectTypeScriptFiles(srcDir, readdir);
    let loadingStateCount = 0;
    let ariaCount = 0;
    let spinnerCount = 0;

    for (const filePath of files) {
      try {
        const content = await readFile(filePath);
        if (/isLoading|loading\s*:/i.test(content)) loadingStateCount++;
        if (/aria-/i.test(content)) ariaCount++;
        if (/<Spinner|<Loading|loading\.\.\.]/i.test(content)) spinnerCount++;
      } catch {
        // Unreadable file
      }
    }

    if (loadingStateCount > 0) score += 15;
    if (ariaCount > 0) score += 15;
    if (spinnerCount > 0) score += 10;
  } catch {
    // No src directory
  }

  // Check for Tailwind config
  const tailwindPath = path.join(ctx.cwd, 'tailwind.config.js');
  try {
    await readFile(tailwindPath);
    score += 10;
  } catch {
    // No Tailwind config
  }

  return Math.min(100, Math.max(0, score));
}

// ── Documentation: PDSE clarity + freshness ────────────────────────────────

function scoreDocumentation(ctx: MaturityContext): number {
  const pdseScores = Object.values(ctx.pdseScores);
  if (pdseScores.length === 0) return 50;

  let totalClarity = 0;
  let totalFreshness = 0;
  let count = 0;

  for (const result of pdseScores) {
    if (!result) continue;
    totalClarity += result.dimensions.clarity;
    totalFreshness += result.dimensions.freshness;
    count++;
  }

  if (count === 0) return 50;

  // Weighted: 70% clarity (max 20), 30% freshness (max 10)
  const avgClarity = totalClarity / count;       // 0-20
  const avgFreshness = totalFreshness / count;   // 0-10

  const normalized = (avgClarity / 20) * 70 + (avgFreshness / 10) * 30;
  return Math.round(Math.min(100, normalized));
}

// ── Performance: Nested loops, SELECT *, await in loops ───────────────────

async function scorePerformance(
  ctx: MaturityContext,
  readFile: (path: string) => Promise<string>,
  readdir: (path: string) => Promise<string[]>,
): Promise<number> {
  let score = 70; // Assume decent baseline

  const srcDir = path.join(ctx.cwd, 'src');
  let antiPatterns = 0;

  try {
    const files = await collectTypeScriptFiles(srcDir, readdir);
    for (const filePath of files) {
      try {
        const content = await readFile(filePath);
        // Nested loops (simple heuristic: count for...for patterns)
        const nestedLoops = (content.match(/for\s*\(.*?\)\s*\{[\s\S]*?for\s*\(/g) || []).length;
        antiPatterns += nestedLoops;

        // SELECT * in SQL
        if (/SELECT\s+\*/i.test(content)) antiPatterns++;

        // await in loop
        if (/for\s*\(.*?\)\s*\{[\s\S]*?await\s+/g.test(content)) antiPatterns++;
      } catch {
        // Unreadable file
      }
    }
  } catch {
    // No src directory
  }

  score -= antiPatterns * 5;
  return Math.min(100, Math.max(0, score));
}

// ── Maintainability: PDSE testability + constitution + function size ──────

async function scoreMaintainability(
  ctx: MaturityContext,
  readFile: (path: string) => Promise<string>,
  readdir: (path: string) => Promise<string[]>,
): Promise<number> {
  const pdseScores = Object.values(ctx.pdseScores);
  let pdseBase = 50;

  if (pdseScores.length > 0) {
    let totalTestability = 0;
    let totalConstitution = 0;
    let count = 0;

    for (const result of pdseScores) {
      if (!result) continue;
      totalTestability += result.dimensions.testability;
      totalConstitution += result.dimensions.constitutionAlignment;
      count++;
    }

    if (count > 0) {
      const avgTestability = totalTestability / count;       // 0-20
      const avgConstitution = totalConstitution / count;     // 0-20

      pdseBase = Math.round(((avgTestability + avgConstitution) / 40) * 100);
    }
  }

  // Penalize >100 LOC functions
  const srcDir = path.join(ctx.cwd, 'src');
  let largeFunctionPenalty = 0;

  try {
    const files = await collectTypeScriptFiles(srcDir, readdir);
    for (const filePath of files) {
      try {
        const content = await readFile(filePath);
        const functions = extractFunctions(content);
        for (const fn of functions) {
          const loc = fn.split('\n').length;
          if (loc > 100) largeFunctionPenalty += 5;
        }
      } catch {
        // Unreadable file
      }
    }
  } catch {
    // No src directory
  }

  return Math.min(100, Math.max(0, pdseBase - largeFunctionPenalty));
}

// ── Gap Analysis ───────────────────────────────────────────────────────────

export function analyzeGaps(
  dimensions: MaturityDimensions,
  currentLevel: MaturityLevel,
  targetLevel: MaturityLevel,
): QualityGap[] {
  const gaps: QualityGap[] = [];
  const targetScoreThreshold = 70; // Target level expects most dimensions at 70+

  for (const [key, currentScore] of Object.entries(dimensions)) {
    const dimension = key as keyof MaturityDimensions;
    const gapSize = targetScoreThreshold - currentScore;

    if (gapSize > 0) {
      const severity: GapSeverity =
        gapSize > 20 ? 'critical' :
        gapSize > 10 ? 'major' :
        'minor';

      gaps.push({
        dimension,
        currentScore,
        targetScore: targetScoreThreshold,
        gapSize,
        severity,
        recommendation: generateGapRecommendation(dimension, currentScore, targetScoreThreshold),
      });
    }
  }

  return gaps.sort((a, b) => b.gapSize - a.gapSize); // Critical gaps first
}

function generateGapRecommendation(
  dimension: keyof MaturityDimensions,
  currentScore: number,
  targetScore: number,
): string {
  const recommendations: Record<keyof MaturityDimensions, string> = {
    functionality: 'Complete missing features and improve integration fitness',
    testing: 'Increase test coverage and add E2E tests',
    errorHandling: 'Add try/catch blocks and create custom error classes',
    security: 'Run npm audit, move secrets to .env, remove dangerous patterns',
    uxPolish: 'Add loading states, ARIA labels, and responsive design',
    documentation: 'Improve clarity and update stale documentation',
    performance: 'Profile code, eliminate nested loops, optimize queries',
    maintainability: 'Refactor large functions, improve modularity',
  };

  return recommendations[dimension];
}

// ── Assessment Engine ──────────────────────────────────────────────────────

export async function assessMaturity(ctx: MaturityContext): Promise<MaturityAssessment> {
  const dimensions = await scoreMaturityDimensions(ctx);

  // Weighted average across 8 dimensions
  const weights = {
    functionality: 0.20,
    testing: 0.15,
    errorHandling: 0.10,
    security: 0.15,
    uxPolish: 0.10,
    documentation: 0.10,
    performance: 0.10,
    maintainability: 0.10,
  };

  const overallScore = Math.round(
    dimensions.functionality * weights.functionality +
    dimensions.testing * weights.testing +
    dimensions.errorHandling * weights.errorHandling +
    dimensions.security * weights.security +
    dimensions.uxPolish * weights.uxPolish +
    dimensions.documentation * weights.documentation +
    dimensions.performance * weights.performance +
    dimensions.maintainability * weights.maintainability,
  );

  const currentLevel = scoreToMaturityLevel(overallScore);
  const gaps = analyzeGaps(dimensions, currentLevel, ctx.targetLevel);

  const founderExplanation = generateFounderExplanation(
    currentLevel,
    ctx.targetLevel,
    overallScore,
    dimensions,
    gaps,
  );

  const recommendation = computeRecommendation(currentLevel, ctx.targetLevel, gaps);

  return {
    currentLevel,
    targetLevel: ctx.targetLevel,
    overallScore,
    dimensions,
    gaps,
    founderExplanation,
    recommendation,
    timestamp: new Date().toISOString(),
  };
}

function generateFounderExplanation(
  currentLevel: MaturityLevel,
  targetLevel: MaturityLevel,
  overallScore: number,
  dimensions: MaturityDimensions,
  gaps: QualityGap[],
): string {
  const currentName = getMaturityLevelName(currentLevel);
  const targetName = getMaturityLevelName(targetLevel);
  const currentDesc = describeLevelForFounders(currentLevel);

  let explanation = `Your code is at ${currentName} level (${overallScore}/100).\n\n${currentDesc}\n\n`;

  if (currentLevel >= targetLevel) {
    explanation += `Good news: You've met or exceeded your ${targetName} target.\n`;
  } else {
    const criticalGaps = gaps.filter(g => g.severity === 'critical');
    const majorGaps = gaps.filter(g => g.severity === 'major');

    explanation += `Target: ${targetName} level (${targetLevel}/6).\n\n`;

    if (criticalGaps.length > 0) {
      explanation += `Critical gaps (${criticalGaps.length}):\n`;
      for (const gap of criticalGaps.slice(0, 3)) {
        explanation += `- ${capitalize(gap.dimension)}: ${gap.currentScore}/100 (need ${gap.targetScore}+)\n`;
      }
      explanation += '\n';
    }

    if (majorGaps.length > 0) {
      explanation += `Major gaps (${majorGaps.length}):\n`;
      for (const gap of majorGaps.slice(0, 3)) {
        explanation += `- ${capitalize(gap.dimension)}: ${gap.currentScore}/100 (need ${gap.targetScore}+)\n`;
      }
    }
  }

  return explanation.trim();
}

function computeRecommendation(
  currentLevel: MaturityLevel,
  targetLevel: MaturityLevel,
  gaps: QualityGap[],
): MaturityRecommendation {
  if (currentLevel > targetLevel) return 'target-exceeded';
  if (currentLevel === targetLevel) return 'proceed';

  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  if (criticalGaps.length > 0) return 'blocked';

  const majorGaps = gaps.filter(g => g.severity === 'major');
  if (majorGaps.length > 0) return 'refine';

  return 'proceed';
}

// ── Helper Functions ───────────────────────────────────────────────────────

async function collectTypeScriptFiles(
  dir: string,
  readdir: (path: string) => Promise<string[]>,
): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        results.push(fullPath);
      }
      // Recursive (simple flat scan, not deep traversal for performance)
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

function extractFunctions(content: string): string[] {
  const functions: string[] = [];
  const regex = /function\s+\w+\s*\([^)]*\)\s*\{|const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{|async\s+function\s+\w+\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const start = match.index;
    const end = findClosingBrace(content, start);
    if (end > start) {
      functions.push(content.slice(start, end));
    }
  }

  return functions;
}

function findClosingBrace(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = start; i < content.length; i++) {
    const char = content[i];
    const prev = content[i - 1];

    if (!inString) {
      if ((char === '"' || char === "'" || char === '`') && prev !== '\\') {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    } else {
      if (char === stringChar && prev !== '\\') {
        inString = false;
      }
    }
  }

  return start;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
