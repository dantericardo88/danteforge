// Maturity Assessment CLI Command
// Analyze current code maturity level and provide founder-friendly quality report

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import { scoreAllArtifacts } from '../../core/pdse.js';
import { assessMaturity, type MaturityAssessment } from '../../core/maturity-engine.js';
import { getMaturityLevelName, getMaturityUseCase, type MaturityLevel } from '../../core/maturity-levels.js';
import { MAGIC_PRESETS, type MagicLevel } from '../../core/magic-presets.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export interface MaturityOptions {
  preset?: string;
  json?: boolean;
  cwd?: string;
  // Injection seams for testing
  _loadState?: () => Promise<import('../../core/state.js').DanteState>;
  _scoreArtifacts?: (cwd: string, state: any) => Promise<any>;
  _assessMaturity?: (ctx: any) => Promise<MaturityAssessment>;
}

export async function maturity(options: MaturityOptions = {}): Promise<void> {
  return withErrorBoundary('maturity', async () => {
    const cwd = options.cwd ?? process.cwd();

    const loadStateFn = options._loadState ?? loadState;
    const scoreArtifactsFn = options._scoreArtifacts ?? scoreAllArtifacts;
    const assessMaturityFn = options._assessMaturity ?? assessMaturity;

    logger.info('Analyzing project maturity...');

    const state = await loadStateFn();
    const pdseScores = await scoreArtifactsFn(cwd, state);

    // Determine target maturity level
    let targetLevel: MaturityLevel;
    if (options.preset) {
      const normalizedPreset = options.preset.toLowerCase() as MagicLevel;
      const preset = MAGIC_PRESETS[normalizedPreset];
      if (!preset) {
        logger.error(`Unknown preset: ${options.preset}`);
        logger.info(`Valid presets: ${Object.keys(MAGIC_PRESETS).join(', ')}`);
        process.exitCode = 1;
        return;
      }
      targetLevel = preset.targetMaturityLevel;
    } else {
      // Default to Beta (level 4) if no preset specified
      targetLevel = 4;
    }

    const assessment = await assessMaturityFn({
      cwd,
      state,
      pdseScores,
      targetLevel,
    });

    if (options.json) {
      // JSON output mode
      process.stdout.write(JSON.stringify(assessment, null, 2) + '\n');
    } else {
      // Founder-friendly plain text output
      printFounderReport(assessment);
    }

    // Write markdown report to evidence directory
    await writeMaturityReport(assessment, cwd);

    // Exit code based on recommendation
    if (assessment.recommendation === 'blocked') {
      process.exitCode = 1;
    }
  });
}

function printFounderReport(assessment: MaturityAssessment): void {
  const currentName = getMaturityLevelName(assessment.currentLevel);
  const targetName = getMaturityLevelName(assessment.targetLevel);
  const currentUseCase = getMaturityUseCase(assessment.currentLevel);

  logger.info('');
  logger.info('═'.repeat(60));
  logger.success('  DanteForge Maturity Assessment');
  logger.info('═'.repeat(60));
  logger.info('');

  logger.info(`Current Level: ${currentName} (${assessment.currentLevel}/6)`);
  logger.info(`Target Level:  ${targetName} (${assessment.targetLevel}/6)`);
  logger.info(`Overall Score: ${assessment.overallScore}/100`);
  logger.info(`Use Case:      ${currentUseCase}`);
  logger.info('');

  // Show dimension scores
  logger.info('Quality Dimensions:');
  const dimensionEntries = Object.entries(assessment.dimensions).sort((a, b) => b[1] - a[1]);
  for (const [dimension, score] of dimensionEntries) {
    const emoji = score >= 80 ? '✅' : score >= 60 ? '⚠️ ' : '❌';
    const paddedName = capitalize(dimension).padEnd(20);
    logger.info(`  ${emoji} ${paddedName} ${score}/100`);
  }
  logger.info('');

  // Show gaps
  if (assessment.gaps.length > 0) {
    const criticalGaps = assessment.gaps.filter(g => g.severity === 'critical');
    const majorGaps = assessment.gaps.filter(g => g.severity === 'major');
    const minorGaps = assessment.gaps.filter(g => g.severity === 'minor');

    if (criticalGaps.length > 0) {
      logger.warn(`Critical Gaps (${criticalGaps.length}):`);
      for (const gap of criticalGaps) {
        logger.warn(`  - ${capitalize(gap.dimension)}: ${gap.currentScore}/100 (need ${gap.targetScore}+)`);
        logger.info(`    → ${gap.recommendation}`);
      }
      logger.info('');
    }

    if (majorGaps.length > 0) {
      logger.info(`Major Gaps (${majorGaps.length}):`);
      for (const gap of majorGaps) {
        logger.info(`  - ${capitalize(gap.dimension)}: ${gap.currentScore}/100 (need ${gap.targetScore}+)`);
      }
      logger.info('');
    }

    if (minorGaps.length > 0) {
      logger.info(`Minor Gaps (${minorGaps.length}):`);
      for (const gap of minorGaps) {
        logger.info(`  - ${capitalize(gap.dimension)}: ${gap.currentScore}/100`);
      }
      logger.info('');
    }
  } else {
    logger.success('No quality gaps detected - target level achieved!');
    logger.info('');
  }

  // Show founder explanation
  logger.info('What This Means:');
  const lines = assessment.founderExplanation.split('\n');
  for (const line of lines) {
    logger.info(line ? `  ${line}` : '');
  }
  logger.info('');

  // Show next steps
  if (assessment.gaps.length > 0) {
    logger.info('Next Steps:');
    const topGaps = assessment.gaps.slice(0, 3);
    let stepNum = 1;
    for (const gap of topGaps) {
      logger.info(`  ${stepNum}. ${gap.recommendation}`);
      stepNum++;
    }
    logger.info('');
  }

  // Recommendation
  const recommendationLabels = {
    'proceed': '✅ Proceed — quality meets target',
    'refine': '⚠️  Refine — address gaps before shipping',
    'blocked': '❌ Blocked — critical gaps must be fixed',
    'target-exceeded': '🎉 Target Exceeded — ready to ship!',
  };

  logger.info(`Recommendation: ${recommendationLabels[assessment.recommendation]}`);
  logger.info('');
  logger.info('═'.repeat(60));
}

async function writeMaturityReport(assessment: MaturityAssessment, cwd: string): Promise<void> {
  try {
    const evidenceDir = path.join(cwd, '.danteforge', 'evidence', 'maturity');
    await fs.mkdir(evidenceDir, { recursive: true });

    const reportPath = path.join(evidenceDir, 'latest.md');
    const content = buildMarkdownReport(assessment);

    const tmpPath = `${reportPath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, reportPath);

    logger.info(`Maturity report written to: ${reportPath}`);
  } catch (err) {
    logger.warn(`Failed to write maturity report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildMarkdownReport(assessment: MaturityAssessment): string {
  const currentName = getMaturityLevelName(assessment.currentLevel);
  const targetName = getMaturityLevelName(assessment.targetLevel);
  const currentUseCase = getMaturityUseCase(assessment.currentLevel);

  let md = '# DanteForge Maturity Assessment\n\n';
  md += `**Generated**: ${new Date(assessment.timestamp).toLocaleString()}\n\n`;
  md += '## Summary\n\n';
  md += `- **Current Level**: ${currentName} (${assessment.currentLevel}/6)\n`;
  md += `- **Target Level**: ${targetName} (${assessment.targetLevel}/6)\n`;
  md += `- **Overall Score**: ${assessment.overallScore}/100\n`;
  md += `- **Use Case**: ${currentUseCase}\n`;
  md += `- **Recommendation**: ${assessment.recommendation}\n\n`;

  md += '## Quality Dimensions\n\n';
  md += '| Dimension | Score | Status |\n';
  md += '| --- | --- | --- |\n';

  for (const [dimension, score] of Object.entries(assessment.dimensions)) {
    const status = score >= 80 ? '✅ Excellent' : score >= 60 ? '⚠️ Acceptable' : '❌ Needs Work';
    md += `| ${capitalize(dimension)} | ${score}/100 | ${status} |\n`;
  }
  md += '\n';

  if (assessment.gaps.length > 0) {
    md += '## Quality Gaps\n\n';
    const groupedGaps = {
      critical: assessment.gaps.filter(g => g.severity === 'critical'),
      major: assessment.gaps.filter(g => g.severity === 'major'),
      minor: assessment.gaps.filter(g => g.severity === 'minor'),
    };

    for (const [severity, gaps] of Object.entries(groupedGaps)) {
      if (gaps.length > 0) {
        md += `### ${capitalize(severity)} (${gaps.length})\n\n`;
        for (const gap of gaps) {
          md += `- **${capitalize(gap.dimension)}**: ${gap.currentScore}/100 (target: ${gap.targetScore}+)\n`;
          md += `  - Gap: ${gap.gapSize} points\n`;
          md += `  - Recommendation: ${gap.recommendation}\n\n`;
        }
      }
    }
  } else {
    md += '## Quality Gaps\n\nNo gaps detected — target level achieved!\n\n';
  }

  md += '## Founder Explanation\n\n';
  md += assessment.founderExplanation.split('\n').map(line => line || '').join('\n');
  md += '\n\n';

  md += '## Next Steps\n\n';
  if (assessment.gaps.length > 0) {
    const topGaps = assessment.gaps.slice(0, 5);
    for (let i = 0; i < topGaps.length; i++) {
      md += `${i + 1}. ${topGaps[i]!.recommendation}\n`;
    }
  } else {
    md += 'No action required — quality meets target!\n';
  }

  return md;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
