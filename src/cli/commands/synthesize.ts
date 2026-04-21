// Synthesize command — merge all .danteforge/ docs into Ultimate Planning Resource (UPR.md)
import fs from 'fs/promises';
import path from 'path';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { REPO_PIPELINE_TEXT } from '../../core/workflow-surface.js';

const STATE_DIR = '.danteforge';

interface DocSection {
  filename: string;
  category: 'state' | 'review' | 'spec' | 'plan' | 'tasks' | 'other';
  content: string;
}

function categorizeDoc(filename: string): DocSection['category'] {
  const lower = filename.toLowerCase();
  if (lower.includes('state') && lower.endsWith('.yaml')) return 'state';
  if (lower.includes('current_state')) return 'review';
  if (lower.includes('spec') || lower.includes('constitution')) return 'spec';
  if (lower.includes('plan')) return 'plan';
  if (lower.includes('task')) return 'tasks';
  return 'other';
}

async function gatherDocs(): Promise<DocSection[]> {
  const docs: DocSection[] = [];
  try {
    const allFiles = await fs.readdir(STATE_DIR);
    const eligible = allFiles.filter(
      (f) => f !== 'UPR.md' && (f.endsWith('.md') || f.endsWith('.yaml')),
    );
    const readResults = await Promise.allSettled(
      eligible.map((f) => fs.readFile(path.join(STATE_DIR, f), 'utf8')),
    );
    for (let i = 0; i < eligible.length; i++) {
      const result = readResults[i]!;
      if (result.status !== 'fulfilled') continue;
      docs.push({ filename: eligible[i]!, category: categorizeDoc(eligible[i]!), content: result.value });
    }
  } catch {
    logger.warn('No .danteforge/ directory found — run "danteforge review" first');
  }
  return docs;
}

export async function synthesize() {
  return withErrorBoundary('synthesize', async () => {
  logger.info('Synthesizing Ultimate Planning Resource (UPR.md)...');

  const state = await loadState();
  const canSynthesize = state.workflowStage === 'verify' || state.workflowStage === 'synthesize';
  if (!state.lastVerifiedAt || !canSynthesize) {
    logger.error('Synthesis is blocked until verification succeeds. Run "danteforge verify" after a real forge pass first.');
    process.exitCode = 1;
    return;
  }
  const docs = await gatherDocs();
  const timestamp = new Date().toISOString();

  if (docs.length === 0) {
    logger.error('No artifacts found in .danteforge/ — run "danteforge review" or "danteforge constitution" first');
    return;
  }

  const sections: string[] = [];

  sections.push('# Ultimate Planning Resource (UPR.md)');
  sections.push(`> Synthesized by DanteForge on ${timestamp}`);
  sections.push(`> Project: ${state.project} | Phase: ${state.currentPhase} | Profile: ${state.profile}`);
  sections.push('');

  sections.push('## Executive Summary');
  sections.push('');
  sections.push(`This document merges all DanteForge artifacts into a single actionable resource.`);
  sections.push(`It covers the current project state, specifications, execution plan, and development pipeline.`);
  sections.push(`Use this as the definitive reference for completing the project.`);
  sections.push('');
  sections.push(`- **Artifacts synthesized**: ${docs.length}`);
  sections.push(`- **Current phase**: ${state.currentPhase}`);
  sections.push(`- **Last handoff**: ${state.lastHandoff}`);
  sections.push(`- **Audit entries**: ${state.auditLog.length}`);
  sections.push('');

  if (state.constitution) {
    sections.push('## Constitution');
    sections.push('');
    sections.push(state.constitution);
    sections.push('');
  }

  const categoryOrder: DocSection['category'][] = ['review', 'spec', 'plan', 'tasks', 'state', 'other'];
  const categoryLabels: Record<DocSection['category'], string> = {
    review: 'Current State (Repo Review)',
    spec: 'Specifications',
    plan: 'Execution Plan',
    tasks: 'Tasks & Roadmap',
    state: 'State Tracking',
    other: 'Additional Artifacts',
  };

  for (const category of categoryOrder) {
    const categoryDocs = docs.filter(d => d.category === category);
    if (categoryDocs.length === 0) continue;

    sections.push(`## ${categoryLabels[category]}`);
    sections.push('');

    for (const doc of categoryDocs) {
      sections.push(`### Source: ${doc.filename}`);
      sections.push('');
      sections.push(doc.content);
      sections.push('');
      sections.push('---');
      sections.push('');
    }
  }

  sections.push('## DanteForge Pipeline');
  sections.push('');
  sections.push('```');
  sections.push(REPO_PIPELINE_TEXT);
  sections.push('  |                                                                                                                                            |');
  sections.push('  +-------------------- iterative loop: re-review or re-plan when gaps are found -----+');
  sections.push('```');
  sections.push('');
  sections.push('### Specification Refinement');
  sections.push('- Constitution: Zero-ambiguity principles enforced at every phase');
  sections.push('- Clarify: Automated gap detection and consistency checking');
  sections.push('- Templates: Structured artifacts for specs, plans, and tasks');
  sections.push('');
  sections.push('### Execution Waves');
  sections.push('- Structured prompts for LLM-driven task execution');
  sections.push('- Atomic commits with verification loops');
  sections.push('- Profile-adaptive: quality (thorough) | balanced | budget (fast)');
  sections.push('');
  sections.push('### Multi-Agent Orchestration');
  sections.push('- PM: Prioritization + constitution alignment');
  sections.push('- Architect: System design + trade-off evaluation');
  sections.push('- Dev: Implementation + atomic code units');
  sections.push('- UX: User-facing review + accessibility');
  sections.push('- Scrum Master: Progress monitoring + blocker detection');
  sections.push('');

  if (state.auditLog.length > 0) {
    sections.push('## Audit Trail');
    sections.push('');
    for (const entry of state.auditLog) {
      sections.push(`- ${entry}`);
    }
    sections.push('');
  }

  sections.push('## Next Steps');
  sections.push('');
  sections.push('1. Run `danteforge feedback` for manual refinement or `danteforge feedback --auto` with a verified live provider.');
  const nextPhase = state.currentPhase + 1;
  const hasNextPhase = (state.tasks[nextPhase] ?? []).length > 0;
  if (hasNextPhase) {
    sections.push(`2. When the next planned wave is ready, run \`danteforge forge ${nextPhase}\`.`);
  } else {
    sections.push('2. If more work is needed, refresh the artifacts with `danteforge review`, `danteforge specify`, or `danteforge tasks` before starting another forge wave.');
  }
  sections.push('3. Run `danteforge verify` after the next real execution wave.');
  sections.push('4. Re-run `danteforge synthesize` after the next verified milestone to keep UPR.md current.');
  sections.push('');

  const uprContent = sections.join('\n');

  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(path.join(STATE_DIR, 'UPR.md'), uprContent);

  recordWorkflowStage(state, 'synthesize', timestamp);
  state.auditLog.push(`${timestamp} | synthesize: UPR.md generated (${docs.length} artifacts merged)`);
  await saveState(state);

  logger.success(`UPR.md generated — ${docs.length} artifacts merged into Ultimate Planning Resource`);
  logger.info('Find it at .danteforge/UPR.md');
  });
}
