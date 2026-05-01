// showcase - Reproducible external proof command
// Scores a real project using the full harsh-scorer and generates docs/CASE_STUDY.md
// with an 18-dimension scorecard. Defaults to scoring the bundled demo project.
// This is the first step to demonstrating real-world DanteForge value.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { generatedByLine } from '../../core/version.js';
import {
  computeHarshScore,
  type HarshScoreResult,
  type HarshScorerOptions,
  type ScoringDimension,
} from '../../core/harsh-scorer.js';

// Types

export interface ShowcaseOptions {
  /** Path to the project to score. Defaults to the bundled sample CLI project. */
  project?: string;
  /** Output format: 'markdown' (default) or 'json' */
  format?: 'markdown' | 'json';
  cwd?: string;
  // Injection seams for testing
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
}

export interface ShowcaseResult {
  projectPath: string;
  score: HarshScoreResult;
  outputPath: string;
}

// Dimension display order

const DIM_ORDER: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
  'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
  'contextEconomy', 'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
  'causalCoherence',
];

const DIM_LABELS: Record<ScoringDimension, string> = {
  functionality: 'Functionality',
  testing: 'Testing',
  errorHandling: 'Error Handling',
  security: 'Security',
  uxPolish: 'UX Polish',
  documentation: 'Documentation',
  performance: 'Performance',
  maintainability: 'Maintainability',
  developerExperience: 'Developer Experience',
  autonomy: 'Autonomy',
  planningQuality: 'Planning Quality',
  selfImprovement: 'Self Improvement',
  specDrivenPipeline: 'Spec-Driven Pipeline',
  convergenceSelfHealing: 'Convergence / Self-Healing',
  tokenEconomy: 'Token Economy',
  contextEconomy: 'Context Economy',
  ecosystemMcp: 'Ecosystem / MCP',
  enterpriseReadiness: 'Enterprise Readiness',
  communityAdoption: 'Community Adoption',
  causalCoherence: 'Causal Coherence',
};

// Main command

export async function showcase(options: ShowcaseOptions = {}): Promise<ShowcaseResult> {
  const cwd = options.cwd ?? process.cwd();
  const projectPath = options.project
    ? path.resolve(cwd, options.project)
    : path.join(cwd, 'examples', 'todo-app');

  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const writeFn = options._writeFile
    ?? (async (filePath: string, content: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    });

  const projectName = path.basename(projectPath);
  const displayPath = path.isAbsolute(projectPath)
    ? path.relative(cwd, projectPath).replace(/\\/g, '/')
    : projectPath;

  logger.info(`[showcase] Scoring project: ${displayPath}`);

  const result = await harshScoreFn({ cwd: projectPath });
  const outPath = path.join(cwd, 'docs', 'CASE_STUDY.md');

  if (options.format === 'json') {
    const json = JSON.stringify({
      projectPath: displayPath,
      projectName,
      timestamp: result.timestamp,
      displayScore: result.displayScore,
      verdict: result.verdict,
      displayDimensions: result.displayDimensions,
      penalties: result.penalties,
      stubsDetected: result.stubsDetected,
    }, null, 2);

    await writeFn(outPath.replace('.md', '.json'), json);
    logger.info(json);
  } else {
    const markdown = buildCaseStudyMarkdown(projectName, displayPath, result);
    await writeFn(outPath, markdown);
    logger.success('Case study written to docs/CASE_STUDY.md');
  }

  logger.info(`Overall score: ${result.displayScore.toFixed(1)}/10  (${result.verdict})`);

  if (result.penalties.length > 0) {
    logger.warn(`Penalties applied: ${result.penalties.length}`);
  }

  const lowestDims = DIM_ORDER
    .map((dim) => ({ dim, score: result.displayDimensions[dim] ?? 0 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  logger.info('Top improvement opportunities:');
  for (const { dim, score } of lowestDims) {
    logger.info(`  - ${DIM_LABELS[dim]}: ${score.toFixed(1)}/10`);
  }

  return { projectPath, score: result, outputPath: outPath };
}

// Markdown builder

export function buildCaseStudyMarkdown(
  projectName: string,
  projectPath: string,
  result: HarshScoreResult,
): string {
  const date = result.timestamp.slice(0, 10);
  const verdictLabel =
    result.verdict === 'excellent' ? 'Excellent'
      : result.verdict === 'acceptable' ? 'Acceptable'
        : result.verdict === 'needs-work' ? 'Needs Work'
          : 'Blocked';

  const lines: string[] = [
    `# DanteForge Case Study - ${projectName}`,
    '',
    `> Generated by \`danteforge showcase\` on ${date}`,
    `> Project path: \`${projectPath}\``,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Overall Score | **${result.displayScore.toFixed(1)} / 10** |`,
    `| Verdict | ${verdictLabel} |`,
    `| Fake-Completion Risk | ${result.fakeCompletionRisk.toUpperCase()} |`,
    `| Stubs Detected | ${result.stubsDetected.length} file(s) |`,
    `| Penalties Applied | ${result.penalties.length} |`,
    '',
    '## 18-Dimension Scorecard',
    '',
    '| Dimension | Score | Bar |',
    '|-----------|-------|-----|',
  ];

  for (const dim of DIM_ORDER) {
    const score = result.displayDimensions[dim] ?? 0;
    lines.push(`| ${DIM_LABELS[dim]} | ${score.toFixed(1)} / 10 | ${buildBar(score)} |`);
  }

  const capReasons = buildScoreCapReasons(projectPath, result);
  if (capReasons.length > 0) {
    lines.push('', '## Why This Score Is Capped', '');
    for (const reason of capReasons) {
      lines.push(`- ${reason}`);
    }
  }

  if (result.penalties.length > 0) {
    lines.push('', '## Penalties Applied', '');
    for (const penalty of result.penalties) {
      lines.push(`- **-${penalty.deduction}** ${penalty.reason}`);
    }
  }

  if (result.stubsDetected.length > 0) {
    lines.push('', '## Stubs Detected', '');
    for (const stub of result.stubsDetected.slice(0, 10)) {
      lines.push(`- \`${stub}\``);
    }
  }

  const sorted = DIM_ORDER
    .map((dim) => ({ dim, score: result.displayDimensions[dim] ?? 0 }))
    .sort((a, b) => a.score - b.score);

  lines.push('', '## Top Improvement Opportunities', '');
  for (const { dim, score } of sorted.slice(0, 5)) {
    lines.push(
      `1. **${DIM_LABELS[dim]}** - currently ${score.toFixed(1)}/10. Run \`danteforge self-improve --focus ${dim}\` to close this gap.`,
    );
  }

  lines.push(
    '',
    '## How to Improve',
    '',
    '```bash',
    '# Run a full autonomous improvement loop against this project',
    `danteforge self-improve --cwd "${projectPath}"`,
    '',
    '# Or target a specific dimension',
    `danteforge self-improve --cwd "${projectPath}" --focus testing`,
    '```',
    '',
    '---',
    generatedByLine(),
  );

  return lines.join('\n');
}

function buildScoreCapReasons(projectPath: string, result: HarshScoreResult): string[] {
  const reasons: string[] = [];
  const normalizedProjectPath = projectPath.replace(/\\/g, '/');

  if (normalizedProjectPath.includes('examples/')) {
    reasons.push('This bundled example is intentionally minimal. It proves a finished pipeline snapshot and runnable artifact, not a launch-ready product.');
    reasons.push('Documentation and community-adoption dimensions stay capped until the example includes a richer public walkthrough and stronger operator story.');
  }

  for (const penalty of result.penalties) {
    reasons.push(`Penalty applied: ${penalty.reason}.`);
  }

  const lowestDims = DIM_ORDER
    .map((dim) => ({ dim, score: result.displayDimensions[dim] ?? 0 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  for (const { dim, score } of lowestDims) {
    reasons.push(`${DIM_LABELS[dim]} is still only ${score.toFixed(1)}/10.`);
  }

  return [...new Set(reasons)];
}

function buildBar(score: number): string {
  const filled = Math.round(score);
  const empty = 10 - filled;
  return '#'.repeat(filled) + '-'.repeat(empty);
}
