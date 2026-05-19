import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import { requirePlan, runGate } from '../../core/gates.js';
import {
  buildLocalTasks,
  extractNumberedTasks,
  FIRST_EXECUTION_PHASE,
  writeArtifact,
} from '../../core/local-artifacts.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { buildDependencyGraph } from '../../core/plan-quality-scorer.js';

const STATE_DIR = '.danteforge';

function buildTasksPrompt(state: Awaited<ReturnType<typeof loadState>>, planContent: string, specContent: string): string {
  return `You are a project manager breaking down a software plan into atomic, executable tasks.

${state.constitution ? `Project principles:\n${state.constitution}\n` : ''}
${planContent ? `Implementation plan:\n${planContent.slice(0, 3000)}\n` : ''}
${specContent ? `Specification:\n${specContent.slice(0, 2000)}\n` : ''}

## DEPTH DOCTRINE — MANDATORY

Every task must have a TYPE. Use exactly two types:

**FORGE TASK** — writes new modules + unit tests. Score ceiling: 6.
Every forge task MUST answer before it is considered complete:
1. Callsite: What production function calls this module? (not a test — the real entry point)
2. Artifact: What is the observable output? (file path, log line, CLI output)
3. Silent failure: What breaks silently if this module fails?
If answer 1 is "nothing yet" → mark as orphan-pending. Score ceiling: 5.

**VALIDATE TASK** — runs outcomes on existing code to produce receipts. Unlocks scores 7-9.
No new production code. Run danteforge validate <dim>. Output: OutcomeEvidenceEntry file.

**Zero Tolerance:** No mocks, no stubs, no TODOs in any code. Implement the real thing.
Code without a receipt is a hypothesis, not a feature.

## Generate TASKS.md with:

1. **Task List** — each task as a numbered item with:
   - Type: [FORGE] or [VALIDATE]
   - Clear action verb (Implement, Create, Configure, Validate, etc.)
   - Files to modify (if known)
   - Verification criteria
   - [P] flag for tasks that can run in parallel
   - Effort estimate (S/M/L)
   - For FORGE tasks: answer the 3 callsite questions
   - For VALIDATE tasks: include receipt path and expected artifact

2. **Dependencies** — which tasks must complete before others
   (VALIDATE tasks always depend on the corresponding FORGE task)

3. **Phase Grouping** — alternate waves:
   - Phase 1: FORGE wave (build modules, ceiling 6)
   - Phase 2: VALIDATE wave (run outcomes, unlock 7-9)
   - Phase 3: FORGE wave (new modules for remaining gaps)
   - Phase 4: VALIDATE wave (validate new modules)

Format each task as:
\`N. [P?] [FORGE|VALIDATE] <action> - files: <paths> - verify: <criteria> - effort: <S/M/L>\`

For VALIDATE tasks, add:
\`   receipt: .danteforge/outcome-evidence/<dim>_<outcome>.json\`
\`   command: danteforge validate <dimId>\`

Output ONLY the markdown content - no preamble.`;
}

export async function tasks(options: {
  prompt?: boolean;
  light?: boolean;
  /** Validate dependency graph: check no cycles, all refs valid */
  validate?: boolean;
  _llmCaller?: typeof callLLM;
  _isLLMAvailable?: typeof isLLMAvailable;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _writeArtifact?: typeof writeArtifact;
} = {}) {
  const llmFn = options._llmCaller ?? callLLM;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;
  const writeFn = options._writeArtifact ?? writeArtifact;

  return withErrorBoundary('tasks', async () => {
  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'tasks: break plan into executable tasks', context: { workflowStage: 'tasks' }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

  if (!(await runGate(() => requirePlan(options.light)))) return;

  logger.info('Breaking plan into executable tasks...');

  const state = await loadFn();

  let planContent = '';
  let specContent = '';
  try {
    planContent = await fs.readFile(path.join(STATE_DIR, 'PLAN.md'), 'utf8');
  } catch {}
  try {
    specContent = await fs.readFile(path.join(STATE_DIR, 'SPEC.md'), 'utf8');
  } catch {}

  const prompt = buildTasksPrompt(state, planContent, specContent);

  if (options.prompt) {
    const savedPath = await savePrompt('tasks', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as TASKS.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | tasks: prompt generated`);
    await saveFn(state);
    return;
  }

  const llmAvailable = await llmAvailFn();
  if (llmAvailable) {
    logger.info('Sending to LLM for task breakdown...');
    try {
      let tasksMd = await llmFn(prompt, undefined, { enrichContext: true });
      tasksMd = appendDependencySection(tasksMd);
      await writeFn('TASKS.md', tasksMd);

      if (options.validate) {
        validateDependencies(tasksMd);
      }

      const parsedTasks = extractNumberedTasks(tasksMd, 'Phase 1');
      if (parsedTasks.length > 0) {
        state.tasks[FIRST_EXECUTION_PHASE] = parsedTasks;
        if (state.currentPhase < FIRST_EXECUTION_PHASE) {
          state.currentPhase = FIRST_EXECUTION_PHASE;
        }
      }

      const timestamp = recordWorkflowStage(state, 'tasks');
      state.auditLog.push(`${timestamp} | tasks: ${parsedTasks.length} tasks generated via API`);
      await saveFn(state);
      logger.success(`TASKS.md generated - ${parsedTasks.length} tasks ready for forge`);
      logger.info('Run "danteforge forge 1" to start executing');
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  const localTasks = buildLocalTasks(planContent, specContent);
  let localMd = localTasks.markdown;
  localMd = appendDependencySection(localMd);
  await writeFn('TASKS.md', localMd);

  if (options.validate) {
    validateDependencies(localMd);
  }

  state.tasks[FIRST_EXECUTION_PHASE] = localTasks.tasks;
  if (state.currentPhase < FIRST_EXECUTION_PHASE) {
    state.currentPhase = FIRST_EXECUTION_PHASE;
  }
  const timestamp = recordWorkflowStage(state, 'tasks');
  state.auditLog.push(`${timestamp} | tasks: ${localTasks.tasks.length} tasks generated locally`);
  await saveFn(state);
  logger.success(`TASKS.md generated locally - ${localTasks.tasks.length} tasks ready for forge`);
  logger.info('Run "danteforge forge 1" to start executing');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer task breakdowns: danteforge config --set-key "grok:<key>"');
  }

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'tasks: break plan into executable tasks [complete]', result: 'TASKS.md written', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }
  });
}

// ── Dependency helpers ────────────────────────────────────────────────────────

/**
 * Append a ## Dependencies section to a TASKS.md string.
 * Detects "depends on task N" / "after task N" references and builds an adjacency list.
 * If no dependencies are found the original text is returned unchanged.
 */
export function appendDependencySection(tasksMd: string): string {
  // Don't add a second Dependencies section
  if (/^##\s+Dependencies/m.test(tasksMd)) return tasksMd;

  const graph = buildDependencyGraph(tasksMd);
  const edges = graph.edges.filter(e => e.dependsOn.length > 0);
  if (edges.length === 0) return tasksMd;

  const lines = ['\n## Dependencies\n'];
  lines.push('Task dependency adjacency list (task → depends on):');
  lines.push('');
  for (const edge of edges) {
    lines.push(`- Task ${edge.taskId} → depends on: ${edge.dependsOn.map(d => `Task ${d}`).join(', ')}`);
  }

  if (!graph.isAcyclic) {
    lines.push('');
    lines.push('WARNING: Circular dependency detected — review task ordering.');
  }

  return tasksMd.trimEnd() + '\n' + lines.join('\n') + '\n';
}

/**
 * Validate dependency graph of a TASKS.md string.
 * Logs warnings for circular deps or dangling references.
 * Does NOT throw — validation is advisory.
 */
export function validateDependencies(tasksMd: string): void {
  const graph = buildDependencyGraph(tasksMd);

  if (!graph.isAcyclic) {
    logger.warn('[tasks] Circular dependency detected in task graph. Review "depends on" references.');
    process.exitCode = 1;
  } else {
    logger.info(`[tasks] Dependency graph is acyclic. ${graph.tasks.length} tasks, ${graph.edges.filter(e => e.dependsOn.length > 0).length} dependencies.`);
  }

  // Check for dangling references (deps that point to non-existent tasks)
  for (const edge of graph.edges) {
    for (const dep of edge.dependsOn) {
      if (!graph.tasks.includes(dep)) {
        logger.warn(`[tasks] Task ${edge.taskId} references non-existent task ${dep}.`);
      }
    }
  }
}
