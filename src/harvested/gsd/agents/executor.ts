import fs from 'node:fs/promises';
import path from 'node:path';
import { loadState, recordWorkflowStage, saveState } from '../../../core/state.js';
import { verifyTask } from '../../../core/verifier.js';
import { logger } from '../../../core/logger.js';
import { emitWaveStart, emitTaskStart, emitTaskComplete } from '../../../core/event-bus.js';
import { buildTaskPrompt, buildTaskPromptWithCodeFormat, savePrompt, displayPrompt } from '../../../core/prompt-builder.js';
import { isLLMAvailable, callLLM } from '../../../core/llm.js';
import { recordMemory } from '../../../core/memory-engine.js';
import { createAgentWorktree, removeAgentWorktree } from '../../../utils/worktree.js';
import { reflect, evaluateVerdict, DEFAULT_REFLECTION_CONFIG } from '../../../core/reflection-engine.js';
import { createTelemetry, recordToolCall, recordFileModified, type ExecutionTelemetry } from '../../../core/execution-telemetry.js';
import { parseCodeOperations, applyAllOperations, type ApplyAllResult, type CodeWriterOptions } from '../../../core/code-writer.js';
import { runTypecheck, runProjectTests, formatErrorsForLLM, type TestRunResult, type TestRunnerOptions } from '../../../core/test-runner.js';
import { stageAndCommit } from '../../../core/git-integration.js';
import { detectCodePresence, buildFormatNudgePrompt, MAX_NUDGE_ATTEMPTS } from '../../../core/format-nudge.js';

/** System prompt used for all code task LLM calls — anchors the format at the system level */
export const CODE_TASK_SYSTEM_PROMPT =
  'You are a code editor. Output all code changes using SEARCH/REPLACE blocks as instructed.';

export const DEFAULT_TASK_TIMEOUT_MS = 300_000; // 5 minutes per task

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
  /** Inject LLM availability check for testing — defaults to real isLLMAvailable() */
  _isLLMAvailable?: () => Promise<boolean>;
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
  /** Inject code writer for testing (parses + applies LLM response to disk) */
  _codeWriter?: (response: string, opts: CodeWriterOptions) => Promise<ApplyAllResult>;
  /** Inject test runner for testing */
  _testRunner?: (opts: TestRunnerOptions) => Promise<TestRunResult>;
  /** Inject typecheck runner for testing */
  _typecheckRunner?: (opts: TestRunnerOptions) => Promise<TestRunResult>;
  /** Inject format nudge caller — falls back to _llmCaller then real callLLM.
   *  Called when LLM returns code in wrong format (no SEARCH/REPLACE detected). */
  _nudgeCaller?: (prompt: string) => Promise<string>;
  /** Working directory — defaults to process.cwd() */
  cwd?: string;
  /** Injected for testing — replaces captureFailureLessons to avoid real LLM calls on task failure */
  _captureFailureLessons?: (failedTasks: Array<{ task: string; error?: string }>, context: string) => Promise<void>;
}

// ── Private helpers ────────────────────────────────────────────────────────────

function buildRepairPrompt(taskName: string, previousResponse: string, errorOutput: string): string {
  const truncatedPrev = previousResponse.slice(0, 2000);
  return [
    `Task: ${taskName}`,
    '',
    'Your previous implementation had errors. Fix ONLY the specific errors listed below.',
    'Output ONLY corrected SEARCH/REPLACE blocks — no explanation.',
    '',
    '## Previous implementation (first 2000 chars):',
    truncatedPrev,
    '',
    '## Errors to fix:',
    errorOutput,
    '',
    'Output ONLY SEARCH/REPLACE blocks for the minimal changes needed to fix these errors.',
  ].join('\n');
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

  const llmAvailable = options?._llmCaller != null || await (options?._isLLMAvailable ?? isLLMAvailable)();
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
      const savedPath = await savePrompt(`forge-phase${phase}-task${i + 1}`, prompt, cwd);

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

  const runTask = async (task: { name: string; files?: string[]; verify?: string }, index: number) => {
    const taskLabel = `[${index + 1}/${tasks.length}] ${task.name}`;
    logger.info(`Executing: ${taskLabel}`);
    emitTaskStart(taskLabel);

    const telemetry: ExecutionTelemetry = createTelemetry();
    const taskStart = Date.now();

    try {
      recordToolCall(telemetry, 'callLLM', false);
      // Use code-format prompt for live execution so LLM outputs SEARCH/REPLACE blocks
      let taskPrompt = buildTaskPromptWithCodeFormat(task, profile, state.constitution);
      // Inject design context when DESIGN.op is present (best-effort)
      try {
        const designCtx = options?._readDesignContext
          ? await options._readDesignContext(cwd ?? process.cwd())
          : await readDesignContext(cwd ?? process.cwd());
        if (designCtx) taskPrompt = `${taskPrompt}\n\n${designCtx}`;
      } catch { /* graceful skip — DESIGN.op is optional */ }
      let llmResponse = options?._llmCaller
        ? await options._llmCaller(taskPrompt)
        : await callLLM(taskPrompt, undefined, {
            enrichContext: true,
            cwd,
            systemPrompt: CODE_TASK_SYSTEM_PROMPT,
          });
      logger.success(`LLM result for "${task.name}" (${llmResponse.length} chars)`);

      // ── Format nudge: if LLM gave code in wrong format, ask it to reformat ──
      let codeOps = parseCodeOperations(llmResponse);
      if (codeOps.length === 0 && detectCodePresence(llmResponse)) {
        const nudgeCaller =
          options?._nudgeCaller ??
          options?._llmCaller ??
          ((p: string) => callLLM(p, undefined, { cwd }));
        let nudgeAttempts = 0;
        while (codeOps.length === 0 && nudgeAttempts < MAX_NUDGE_ATTEMPTS && detectCodePresence(llmResponse)) {
          logger.warn(`[format-nudge] No SEARCH/REPLACE blocks — requesting reformat (attempt ${nudgeAttempts + 1}/${MAX_NUDGE_ATTEMPTS})`);
          llmResponse = await nudgeCaller(buildFormatNudgePrompt(task.name, llmResponse));
          codeOps = parseCodeOperations(llmResponse);
          nudgeAttempts++;
        }
      }

      // ── Code execution: parse LLM response → apply to disk → typecheck → test → repair ──
      let applyResult: ApplyAllResult | undefined;
      let finalTestResult: TestRunResult | undefined;

      if (codeOps.length > 0) {
        const taskCwd = cwd ?? process.cwd();
        const codeWriterFn = options?._codeWriter ??
          ((r: string, o: CodeWriterOptions) => applyAllOperations(parseCodeOperations(r), o));
        const typecheckFn = options?._typecheckRunner ?? runTypecheck;
        const testRunnerFn = options?._testRunner ?? runProjectTests;

        applyResult = await codeWriterFn(llmResponse, { cwd: taskCwd });
        logger.info(`Code applied: ${applyResult.filesWritten.length} file(s) written`);

        const MAX_REPAIRS = 3;
        let repairAttempts = 0;

        while (repairAttempts < MAX_REPAIRS) {
          const tcResult = await typecheckFn({ cwd: taskCwd });
          if (tcResult.passed) {
            const testResult = await testRunnerFn({ cwd: taskCwd });
            finalTestResult = testResult;
            if (testResult.passed) break;
            const repairPrompt = buildRepairPrompt(task.name, llmResponse, formatErrorsForLLM(testResult));
            llmResponse = options?._llmCaller
              ? await options._llmCaller(repairPrompt)
              : await callLLM(repairPrompt, undefined, { cwd });
          } else {
            finalTestResult = tcResult;
            const repairPrompt = buildRepairPrompt(task.name, llmResponse, formatErrorsForLLM(tcResult));
            llmResponse = options?._llmCaller
              ? await options._llmCaller(repairPrompt)
              : await callLLM(repairPrompt, undefined, { cwd });
          }
          const repairOps = parseCodeOperations(llmResponse);
          if (repairOps.length > 0) {
            applyResult = await codeWriterFn(llmResponse, { cwd: taskCwd });
            logger.info(`Repair attempt ${repairAttempts + 1}: ${applyResult.filesWritten.length} file(s) re-applied`);
          }
          repairAttempts++;
        }

        if (applyResult.filesWritten.length > 0) {
          try {
            await stageAndCommit(state, { cwd: taskCwd, filesToStage: applyResult.filesWritten });
            logger.info(`Auto-committed: ${applyResult.filesWritten.join(', ')}`);
          } catch { /* non-fatal — git may not be initialized */ }
        }
      }

      // Track file modifications from task metadata
      for (const file of task.files ?? []) {
        recordFileModified(telemetry, file);
      }

      // ── Verification: real test result for code tasks; LLM opinion for non-code tasks ──
      const codeWasApplied = codeOps.length > 0 && applyResult !== undefined;
      let verified: boolean;

      if (codeWasApplied && finalTestResult !== undefined) {
        // Real test exit code is the authoritative signal for code tasks
        verified = finalTestResult.passed;
        if (!verified) {
          logger.error(`Verification FAILED: tests did not pass after repair attempts`);
        } else {
          logger.success(`Verification PASSED: all tests pass after code application`);
        }
      } else {
        // Non-code tasks (plans, specs, pure LLM output) → LLM verifier
        recordToolCall(telemetry, 'verifyTask', false);
        verified = options?._verifier
          ? await options._verifier(task, llmResponse)
          : await verifyTask(task, llmResponse);
      }

      // Write lastVerifyStatus so completion-tracker sees real data
      try {
        const stateLoader = options?._stateCaller?.load ?? ((o?: { cwd?: string }) => loadState(o));
        const stateSaver = options?._stateCaller?.save ?? ((s: Awaited<ReturnType<typeof loadState>>, o?: { cwd?: string }) => saveState(s, o));
        const taskState = await stateLoader(cwd ? { cwd } : undefined);
        taskState.lastVerifyStatus = verified ? 'pass' : 'fail';
        taskState.lastVerifiedAt = new Date().toISOString();
        await stateSaver(taskState, cwd ? { cwd } : undefined);
      } catch { /* non-fatal */ }

      // Reflection: structured self-assessment (harvested from Reflection-3 + Ralph Loop)
      telemetry.duration = Date.now() - taskStart;
      try {
        const reflector = options?._reflector ?? reflect;
        const verdict = await reflector(task.name, llmResponse, telemetry);
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
      const failedTasks = results
        .filter(result => !result.success)
        .map(result => ({ task: result.task, error: result.error }));
      if (options?._captureFailureLessons) {
        await options._captureFailureLessons(failedTasks, 'forge failure');
      } else {
        const { captureFailureLessons } = await import('../../../cli/commands/lessons.js');
        await captureFailureLessons(failedTasks, 'forge failure');
      }
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
  if (failed === 0) {
    logger.info('Ready for next wave or party mode');
  }
  return { mode: 'executed', success: failed === 0 };
}
