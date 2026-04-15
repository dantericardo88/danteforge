import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileOperation, ApplyAllResult } from '../../../core/code-writer.js';
import type { TestRunResult } from '../../../core/test-runner.js';
import { loadState, recordWorkflowStage, saveState } from '../../../core/state.js';
import { verifyTask } from '../../../core/verifier.js';
import { logger } from '../../../core/logger.js';
import { emitWaveStart, emitTaskStart, emitTaskComplete } from '../../../core/event-bus.js';
import { buildTaskPrompt, savePrompt, displayPrompt } from '../../../core/prompt-builder.js';
import { isLLMAvailable, callLLM } from '../../../core/llm.js';
import { callLLMWithProgress } from '../../../core/llm-stream.js';
import { recordMemory } from '../../../core/memory-engine.js';
import { createAgentWorktree, removeAgentWorktree } from '../../../utils/worktree.js';
import { reflect, evaluateVerdict, DEFAULT_REFLECTION_CONFIG } from '../../../core/reflection-engine.js';
import { createTelemetry, recordToolCall, recordFileModified, type ExecutionTelemetry } from '../../../core/execution-telemetry.js';

export const DEFAULT_TASK_TIMEOUT_MS = 300_000; // 5 minutes per task
const MAX_CODE_APPLY_RETRIES = 2;

// ── Design context injection ─────────────────────────────────────────────────

export interface DesignContextFsOps {
  readFile: (p: string, enc: string) => Promise<string>;
}

// Minimal structural type for recursive node walk (satisfies OPNode)
interface DesignNodeLike {
  type: string;
  name: string;
  children?: DesignNodeLike[];
}

function collectAllNodes(nodes: DesignNodeLike[]): DesignNodeLike[] {
  const result: DesignNodeLike[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children?.length) {
      result.push(...collectAllNodes(node.children));
    }
  }
  return result;
}

/**
 * Reads DESIGN.op from `.danteforge/DESIGN.op` and returns a concise design
 * context block suitable for injection into forge task prompts.
 * Returns null when no DESIGN.op exists (graceful skip).
 */
export async function readDesignContext(
  cwd: string,
  opts?: { _fsOps?: DesignContextFsOps },
): Promise<string | null> {
  try {
    const readFile = opts?._fsOps?.readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding));
    const raw = await readFile(path.join(cwd, '.danteforge', 'DESIGN.op'), 'utf-8');
    const { parseOP } = await import('../../openpencil/op-codec.js');
    const doc = parseOP(raw);
    const allNodes = collectAllNodes(doc.nodes as DesignNodeLike[]);
    const components = allNodes
      .filter(n => n.type === 'component' || n.type === 'frame')
      .map(n => n.name)
      .slice(0, 10);
    const lines = ['## Design Context (from DESIGN.op)'];
    if (components.length > 0) {
      lines.push(`Components: ${components.join(', ')}`);
    }
    lines.push('Design tokens: .danteforge/design-tokens.css — use CSS custom properties');
    return lines.join('\n');
  } catch {
    return null;
  }
}

export interface ExecuteWaveResult {
  mode: 'executed' | 'prompt' | 'blocked';
  success: boolean;
  totalTokens?: number;
  totalCostUsd?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, taskName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Task "${taskName}" timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export interface ExecuteWaveOptions {
  _llmCaller?: (prompt: string) => Promise<string>;
  _verifier?: (task: { name: string; verify?: string }, output?: string) => Promise<boolean>;
  _reflector?: typeof reflect;
  /** Inject state load/save for testing */
  _stateCaller?: {
    load: (opts?: { cwd?: string }) => Promise<ReturnType<typeof loadState>>;
    save: (state: Awaited<ReturnType<typeof loadState>>, opts?: { cwd?: string }) => Promise<void>;
  };
  /** Inject memory recording for testing */
  _memorizer?: typeof recordMemory;
  /** Inject design context reader for testing */
  _readDesignContext?: (cwd: string) => Promise<string | null>;
  /** Working directory — defaults to process.cwd() */
  cwd?: string;
  /** Token usage callback — fires after each LLM call with cost metadata */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; costUsd: number; model: string }) => void;
  /** Inject code application for testing — defaults to applyAllOperations from code-writer */
  _applyOperations?: (ops: FileOperation[], opts: { cwd: string }) => Promise<ApplyAllResult>;
  /** Inject test runner for testing — defaults to runProjectTests from test-runner */
  _runTests?: (opts: { cwd: string }) => Promise<TestRunResult>;
  /** Inject file reader for retry context enrichment — defaults to fs.readFile */
  _readFileFn?: (filePath: string) => Promise<string>;
  /** Inject LLM availability check — defaults to isLLMAvailable() from llm.ts */
  _isLLMAvailable?: () => Promise<boolean>;
  /** Stream LLM output chunks to caller — fires per token in TTY mode */
  _onChunk?: (chunk: string) => void;
}

// ── Code Application Pipeline ─────────────────────────────────────────────────
// Extracts code operations from LLM output, applies them to disk, runs tests,
// and retries up to MAX_CODE_APPLY_RETRIES times on failure. Best-effort: never
// throws — errors are logged and the forge step continues to verify.

async function applyCodePipeline(
  result: string,
  taskName: string,
  taskPrompt: string,
  effectiveCwd: string,
  options: ExecuteWaveOptions | undefined,
  internalOnUsage: (u: { inputTokens: number; outputTokens: number; costUsd: number; model: string }) => void,
  cwd: string | undefined,
): Promise<void> {
  try {
    const { parseCodeOperations, applyAllOperations } = await import('../../../core/code-writer.js');
    const { runProjectTests, formatErrorsForLLM } = await import('../../../core/test-runner.js');

    const ops = parseCodeOperations(result);
    if (ops.length === 0) return;

    logger.info(`[forge] Applying ${ops.length} code operation(s) for "${taskName}"`);
    const applyFn = options?._applyOperations
      ?? ((o: FileOperation[], o2: { cwd: string }) => applyAllOperations(o, o2));
    const applyResult = await applyFn(ops, { cwd: effectiveCwd });

    if (applyResult.filesWritten.length > 0) {
      logger.success(`[forge] Applied: ${applyResult.filesWritten.join(', ')}`);
    }
    if (applyResult.filesFailedToApply.length > 0) {
      logger.warn(`[forge] Failed to apply: ${applyResult.filesFailedToApply.join(', ')}`);
    }

    const testFn = options?._runTests ?? ((o: { cwd: string }) => runProjectTests(o));
    let testResult = await testFn({ cwd: effectiveCwd });
    let filesInFlight: string[] = [...applyResult.filesWritten, ...applyResult.filesFailedToApply];
    const readFn = options?._readFileFn ?? ((p: string) => fs.readFile(p, 'utf8'));

    for (let attempt = 0; !testResult.passed && attempt < MAX_CODE_APPLY_RETRIES; attempt++) {
      const errorSummary = formatErrorsForLLM(testResult);
      logger.warn(`[forge] Tests failed (attempt ${attempt + 1}/${MAX_CODE_APPLY_RETRIES}), retrying with error context...`);

      let fileContext = '';
      if (filesInFlight.length > 0) {
        const sections: string[] = ['Current state of files after previous apply:'];
        for (const filePath of filesInFlight) {
          try {
            const absPath = path.isAbsolute(filePath) ? filePath : path.join(effectiveCwd, filePath);
            const content = await readFn(absPath);
            sections.push(`=== ${filePath} ===\n${content.split('\n').slice(0, 200).join('\n')}`);
          } catch { /* file may not exist — best-effort */ }
        }
        if (sections.length > 1) fileContext = '\n\n' + sections.join('\n\n');
      }

      const retryPrompt = `${taskPrompt}\n\n---\nPrevious attempt produced code that failed tests:\n${errorSummary}${fileContext}\n\nFix all failing tests. Provide the corrected files using the same SEARCH/REPLACE or NEW_FILE format.`;
      const retryResponse = options?._llmCaller
        ? await options._llmCaller(retryPrompt)
        : await callLLM(retryPrompt, undefined, { enrichContext: true, cwd, onUsage: internalOnUsage });
      const retryOps = parseCodeOperations(retryResponse);
      if (retryOps.length > 0) {
        const retryApplyResult = await applyFn(retryOps, { cwd: effectiveCwd });
        if (retryApplyResult.filesWritten.length > 0) {
          logger.success(`[forge] Retry applied: ${retryApplyResult.filesWritten.join(', ')}`);
        }
        if (retryApplyResult.filesFailedToApply.length > 0) {
          logger.warn(`[forge] Retry failed to apply: ${retryApplyResult.filesFailedToApply.join(', ')}`);
        }
        filesInFlight = [...retryApplyResult.filesWritten, ...retryApplyResult.filesFailedToApply];
      }
      testResult = await testFn({ cwd: effectiveCwd });
    }

    if (testResult.passed) {
      logger.success(`[forge] Tests pass after code application for "${taskName}"`);
    } else {
      logger.warn(`[forge] Tests still failing after ${MAX_CODE_APPLY_RETRIES} retries for "${taskName}"`);
    }
  } catch (applyErr) {
    // Best-effort — never block the verify step
    logger.verbose(`[best-effort] code application: ${applyErr instanceof Error ? applyErr.message : String(applyErr)}`);
  }
}

export async function executeWave(
  phase: number,
  profile: string,
  parallel = false,
  promptMode = false,
  worktree = false,
  timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
  options?: ExecuteWaveOptions,
): Promise<ExecuteWaveResult> {
  const cwd = options?.cwd;
  const state = await (options?._stateCaller?.load ?? loadState)({ cwd });
  logger.success(`Wave ${phase} starting (${profile} profile${parallel ? ', parallel' : ''}${promptMode ? ', prompt mode' : ''}${worktree ? ', worktree isolation' : ''})`);

  const tasks = state.tasks[phase] ?? [];
  emitWaveStart(phase, tasks.length);
  if (tasks.length === 0) {
    logger.error(`No tasks defined for phase ${phase}. Run "danteforge tasks" before forge.`);
    return { mode: 'blocked', success: false };
  }

  const checkLLM = options?._isLLMAvailable ?? isLLMAvailable;
  const llmAvailable = options?._llmCaller != null || await checkLLM();
  if (!llmAvailable && !promptMode) {
    logger.error('No verified live LLM provider is configured for forge execution. Re-run with --prompt or configure a provider with working model access.');
    return { mode: 'blocked', success: false };
  }

  if (promptMode) {
    logger.info(`Generating ${tasks.length} task prompt(s) for manual execution...`);
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      let prompt = buildTaskPrompt(task, profile, state.constitution);
      try {
        const designCtx = options?._readDesignContext
          ? await options._readDesignContext(cwd ?? process.cwd())
          : await readDesignContext(cwd ?? process.cwd());
        if (designCtx) prompt = `${prompt}\n\n${designCtx}`;
      } catch { /* graceful skip */ }
      const savedPath = await savePrompt(`forge-phase${phase}-task${i + 1}`, prompt);

      logger.info('');
      logger.success(`--- Task ${i + 1}/${tasks.length}: ${task.name} ---`);
      displayPrompt(prompt, [
        'Paste into Claude Code / ChatGPT, then apply the changes to your codebase.',
        `Prompt saved to: ${savedPath}`,
      ].join('\n'));
    }

    logger.info('Apply the generated changes manually, then rerun forge or verify once the code is updated.');
    state.auditLog.push(`${new Date().toISOString()} | forge: ${tasks.length} task prompts generated for phase ${phase}`);
    await (options?._stateCaller?.save ?? saveState)(state, { cwd });
    return { mode: 'prompt', success: true };
  }

  let worktreeName: string | undefined;
  if (worktree) {
    try {
      worktreeName = `forge-phase-${phase}`;
      await createAgentWorktree(worktreeName);
      logger.info(`Worktree created: ${worktreeName}`);
    } catch (err) {
      logger.warn(`Worktree creation failed: ${err instanceof Error ? err.message : String(err)} - continuing without isolation`);
      worktreeName = undefined;
    }
  }

  const results: { task: string; success: boolean; error?: string }[] = [];

  // Token accumulator — driven by onUsage callback, forwarded to caller
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  const internalOnUsage = (usage: { inputTokens: number; outputTokens: number; costUsd: number; model: string }) => {
    totalInputTokens += usage.inputTokens;
    totalOutputTokens += usage.outputTokens;
    totalCostUsd += usage.costUsd;
    options?.onUsage?.(usage);
  };

  const runTask = async (task: { name: string; files?: string[]; verify?: string }, index: number) => {
    const taskLabel = `[${index + 1}/${tasks.length}] ${task.name}`;
    logger.info(`Executing: ${taskLabel}`);
    emitTaskStart(taskLabel);

    const telemetry: ExecutionTelemetry = createTelemetry();
    const taskStart = Date.now();

    try {
      recordToolCall(telemetry, 'callLLM', false);
      let taskPrompt = buildTaskPrompt(task, profile, state.constitution);
      // Inject design context when DESIGN.op is present (best-effort)
      try {
        const designCtx = options?._readDesignContext
          ? await options._readDesignContext(cwd ?? process.cwd())
          : await readDesignContext(cwd ?? process.cwd());
        if (designCtx) taskPrompt = `${taskPrompt}\n\n${designCtx}`;
      } catch { /* graceful skip — DESIGN.op is optional */ }
      // Inject relevant lessons into the prompt so past failures inform this forge cycle (best-effort)
      try {
        const { injectRelevantLessons } = await import('../../../core/lessons-index.js');
        taskPrompt = await injectRelevantLessons(taskPrompt, 3, cwd ?? process.cwd());
      } catch { /* best-effort — never block forge */ }
      const onChunk = options?._onChunk;
      const result = options?._llmCaller
        ? await options._llmCaller(taskPrompt)
        : onChunk
          ? await callLLMWithProgress(taskPrompt, onChunk, undefined, { enrichContext: true, cwd, onUsage: internalOnUsage })
          : await callLLM(taskPrompt, undefined, { enrichContext: true, cwd, onUsage: internalOnUsage });
      logger.success(`LLM result for "${task.name}" (${result.length} chars)`);

      // Apply LLM-generated code changes with retry on test failure (best-effort)
      await applyCodePipeline(result, task.name, taskPrompt, cwd ?? process.cwd(), options, internalOnUsage, cwd);

      // Track file modifications from task metadata
      for (const file of task.files ?? []) {
        recordFileModified(telemetry, file);
      }

      recordToolCall(telemetry, 'verifyTask', false);
      const verified = options?._verifier
        ? await options._verifier(task, result)
        : await verifyTask(task, result);

      // Reflection: structured self-assessment (harvested from Reflection-3 + Ralph Loop)
      telemetry.duration = Date.now() - taskStart;
      try {
        const reflector = options?._reflector ?? reflect;
        const verdict = await reflector(task.name, result, telemetry);
        const evaluation = evaluateVerdict(verdict, DEFAULT_REFLECTION_CONFIG);
        if (!evaluation.complete) {
          logger.warn(`Reflection: ${task.name} — ${evaluation.feedback}`);
        }
        // Update state with reflection score
        state.reflectionScore = evaluation.score;
        state.reflectionLastVerdict = verdict.timestamp;
      } catch (err) { logger.verbose(`[best-effort] reflection: ${err instanceof Error ? err.message : String(err)}`); }

      results.push({ task: task.name, success: verified });
      emitTaskComplete(taskLabel, verified ? 8 : 3);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`LLM failed for task "${task.name}": ${errMsg}`);
      try {
        await (options?._memorizer ?? recordMemory)({
          category: 'error',
          summary: `Forge task failed: ${task.name}`,
          detail: errMsg,
          tags: ['forge', 'task-failure'],
          relatedCommands: ['forge'],
        }, cwd);
      } catch (memErr) { logger.verbose(`[best-effort] memory recording: ${memErr instanceof Error ? memErr.message : String(memErr)}`); }
      results.push({ task: task.name, success: false, error: errMsg });
      emitTaskComplete(taskLabel, 0);
    }
  };

  if (parallel && tasks.length > 1) {
    logger.info(`Running ${tasks.length} tasks in parallel...`);
    await Promise.all(tasks.map((task, index) => withTimeout(runTask(task, index), timeoutMs, task.name)));
  } else {
    for (let i = 0; i < tasks.length; i++) {
      await runTask(tasks[i]!, i);
    }
  }

  if (worktreeName) {
    try {
      await removeAgentWorktree(worktreeName);
      logger.info(`Worktree cleaned up: ${worktreeName}`);
    } catch (err) {
      logger.warn(`Worktree cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const passed = results.filter(result => result.success).length;
  const failed = results.filter(result => !result.success).length;
  if (failed > 0) {
    logger.warn(`Wave ${phase} complete: ${passed} passed, ${failed} failed`);
    for (const result of results.filter(entry => !entry.success)) {
      logger.error(`  FAILED: ${result.task}${result.error ? ` - ${result.error}` : ''}`);
    }

    try {
      const { captureFailureLessons } = await import('../../../cli/commands/lessons.js');
      const failedTasks = results
        .filter(result => !result.success)
        .map(result => ({ task: result.task, error: result.error }));
      await captureFailureLessons(failedTasks, 'forge failure');
    } catch (err) { logger.verbose(`[best-effort] lessons capture: ${err instanceof Error ? err.message : String(err)}`); }
  } else {
    logger.success(`Wave ${phase} complete - all ${passed} tasks passed`);
  }

  const timestamp = new Date().toISOString();
  if (failed === 0) {
    state.currentPhase = phase + 1;
    recordWorkflowStage(state, 'forge', timestamp);
  }
  state.auditLog.push(`${timestamp} | forge: wave ${phase} complete (${passed}/${tasks.length} passed, profile: ${profile}${parallel ? ', parallel' : ''}${failed > 0 ? ', failed' : ''})`);
  await (options?._stateCaller?.save ?? saveState)(state, { cwd });

  // Persist token economy metrics — best-effort, never blocks main path
  const totalTokens = totalInputTokens + totalOutputTokens;
  if (totalTokens > 0) {
    try {
      const latestState = await (options?._stateCaller?.load ?? loadState)({ cwd });
      latestState.totalTokensUsed = (latestState.totalTokensUsed ?? 0) + totalTokens;
      latestState.lastComplexityPreset = profile;
      await (options?._stateCaller?.save ?? saveState)(latestState, { cwd });
    } catch { /* best-effort — token tracking never blocks forge */ }
  }

  if (failed === 0) {
    logger.info('Ready for next wave or party mode');
  }
  return { mode: 'executed', success: failed === 0, totalTokens: totalTokens || undefined, totalCostUsd: totalCostUsd || undefined };
}
