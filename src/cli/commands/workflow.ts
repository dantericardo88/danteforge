// Workflow — visual pipeline showing current stage and progression
import chalk from 'chalk';
import { loadState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const PIPELINE_STAGES = [
  { stage: 'initialized', label: 'review', desc: 'Scan existing project' },
  { stage: 'constitution', label: 'constitution', desc: 'Define principles' },
  { stage: 'specified', label: 'specify', desc: 'Generate SPEC.md' },
  { stage: 'clarified', label: 'clarify', desc: 'Q&A refinement' },
  { stage: 'planned', label: 'plan', desc: 'Create PLAN.md' },
  { stage: 'tasked', label: 'tasks', desc: 'Break into task list' },
  { stage: 'designed', label: 'design', desc: 'Design artifacts' },
  { stage: 'forging', label: 'forge', desc: 'Execute waves' },
  { stage: 'ux-refined', label: 'ux-refine', desc: 'Polish UX' },
  { stage: 'verified', label: 'verify', desc: 'Confirm results' },
  { stage: 'synthesized', label: 'synthesize', desc: 'Generate UPR.md' },
];

export interface WorkflowOptions {
  _loadState?: typeof loadState;
}

export async function workflow(options: WorkflowOptions = {}): Promise<void> {
  return withErrorBoundary('workflow', async () => {
    const loadStateFn = options._loadState ?? loadState;
    let currentStage = 'initialized';
    try {
      const state = await loadStateFn();
      currentStage = state.workflowStage ?? 'initialized';
    } catch {
      // If state can't be loaded, assume initialized
    }

    logger.info('DanteForge Workflow Pipeline');
    logger.info('');

    let passedCurrent = false;
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      const { stage, label, desc } = PIPELINE_STAGES[i];
      const isCurrent = stage === currentStage;
      const num = String(i + 1).padStart(2, ' ');
      const arrow = i < PIPELINE_STAGES.length - 1 ? '  │' : '';

      if (isCurrent) {
        logger.info(chalk.green(`  ${num}. ▶ ${label.padEnd(14)} ${desc}  ← YOU ARE HERE`));
        passedCurrent = true;
      } else if (!passedCurrent) {
        logger.info(chalk.gray(`  ${num}. ✓ ${label.padEnd(14)} ${desc}`));
      } else {
        logger.info(`  ${num}.   ${label.padEnd(14)} ${desc}`);
      }
      if (arrow) logger.info(chalk.gray(arrow));
    }

    logger.info('');
    logger.info(`Current stage: ${currentStage}`);
    logger.info('Run "danteforge <command>" to advance to the next stage.');
  });
}

// Export pipeline stages for testing
export { PIPELINE_STAGES };
