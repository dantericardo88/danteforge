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

function buildUPRTrailer(state: Awaited<ReturnType<typeof loadState>>): string[] {
  const parts: string[] = [];
  parts.push('## DanteForge Pipeline');
  parts.push('');
  parts.push('```');
  parts.push(REPO_PIPELINE_TEXT);
  parts.push('  |                                                                                                                                            |');
  parts.push('  +-------------------- iterative loop: re-review or re-plan when gaps are found -----+');
  parts.push('```');
  parts.push('');
  parts.push('### Specification Refinement');
  parts.push('- Constitution: Zero-ambiguity principles enforced at every phase');
  parts.push('- Clarify: Automated gap detection and consistency checking');
  parts.push('- Templates: Structured artifacts for specs, plans, and tasks');
  parts.push('');
  parts.push('### Execution Waves');
  parts.push('- Structured prompts for LLM-driven task execution');
  parts.push('- Atomic commits with verification loops');
  parts.push('- Profile-adaptive: quality (thorough) | balanced | budget (fast)');
  parts.push('');
  parts.push('### Multi-Agent Orchestration');
  parts.push('- PM: Prioritization + constitution alignment');
  parts.push('- Architect: System design + trade-off evaluation');
  parts.push('- Dev: Implementation + atomic code units');
  parts.push('- UX: User-facing review + accessibility');
  parts.push('- Scrum Master: Progress monitoring + blocker detection');
  parts.push('');

  if (state.auditLog.length > 0) {
    parts.push('## Audit Trail');
    parts.push('');
    for (const entry of state.auditLog) parts.push(`- ${entry}`);
    parts.push('');
  }

  parts.push('## Next Steps');
  parts.push('');
  parts.push('1. Run `danteforge feedback` for manual refinement or `danteforge feedback --auto` with a verified live provider.');
  const nextPhase = state.currentPhase + 1;
  const hasNextPhase = (state.tasks[nextPhase] ?? []).length > 0;
  if (hasNextPhase) {
    parts.push(`2. When the next planned wave is ready, run \`danteforge forge ${nextPhase}\`.`);
  } else {
    parts.push('2. If more work is needed, refresh the artifacts with `danteforge review`, `danteforge specify`, or `danteforge tasks` before starting another forge wave.');
  }
  parts.push('3. Run `danteforge verify` after the next real execution wave.');
  parts.push('4. Re-run `danteforge synthesize` after the next verified milestone to keep UPR.md current.');
  parts.push('');
  return parts;
}

export async function synthesize(options: {
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
} = {}) {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('synthesize', async () => {
  logger.info('Synthesizing Ultimate Planning Resource (UPR.md)...');

  const state = await loadFn();
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

  sections.push(...buildUPRTrailer(state));

  const uprContent = sections.join('\n');

  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(path.join(STATE_DIR, 'UPR.md'), uprContent);

  recordWorkflowStage(state, 'synthesize', timestamp);
  state.auditLog.push(`${timestamp} | synthesize: UPR.md generated (${docs.length} artifacts merged)`);
  await saveFn(state);

  logger.success(`UPR.md generated — ${docs.length} artifacts merged into Ultimate Planning Resource`);
  logger.info('Find it at .danteforge/UPR.md');
  });
}
