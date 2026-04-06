import { loadState, recordWorkflowStage, saveState } from '../../../core/state.js';
import { verifyTask } from '../../../core/verifier.js';
import { logger } from '../../../core/logger.js';
import { emitWaveStart, emitTaskStart, emitTaskComplete } from '../../../core/event-bus.js';
import { buildTaskPrompt, savePrompt, displayPrompt } from '../../../core/prompt-builder.js';
import { isLLMAvailable, callLLM } from '../../../core/llm.js';
import { recordMemory } from '../../../core/memory-engine.js';
import { createAgentWorktree, removeAgentWorktree } from '../../../utils/worktree.js';
import { reflect, evaluateVerdict, DEFAULT_REFLECTION_CONFIG } from '../../../core/reflection-engine.js';
import { createTelemetry, recordToolCall, recordFileModified, type ExecutionTelemetry } from '../../../core/execution-telemetry.js';

export const DEFAULT_TASK_TIMEOUT_MS = 300_000; // 5 minutes per task

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
  _verifier?: (task: { name: string; verify?: string }, output?: string) => Promise<boolean>;
  _reflector?: typeof reflect;
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
  const state = await loadState();
  logger.success(`Wave ${phase} starting (${profile} profile${parallel ? ', parallel' : ''}${promptMode ? ', prompt mode' : ''}${worktree ? ', worktree isolation' : ''})`);

  const tasks = state.tasks[phase] ?? [];
  emitWaveStart(phase, tasks.length);
  if (tasks.length === 0) {
    process.exitCode = 1;
    logger.error(`No tasks defined for phase ${phase}. Run "danteforge tasks" before forge.`);
    return { mode: 'blocked', success: false };
  }

  const llmAvailable = options?._llmCaller != null || await isLLMAvailable();
  if (!llmAvailable && !promptMode) {
    logger.error('No verified live LLM provider is configured for forge execution. Re-run with --prompt or configure a provider with working model access.');
    process.exitCode = 1;
    return { mode: 'blocked', success: false };
  }

  if (promptMode) {
    logger.info(`Generating ${tasks.length} task prompt(s) for manual execution...`);
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const prompt = buildTaskPrompt(task, profile, state.constitution);
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
    await saveState(state);
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
      const taskPrompt = buildTaskPrompt(task, profile, state.constitution);
      const result = options?._llmCaller
        ? await options._llmCaller(taskPrompt)
        : await callLLM(taskPrompt, undefined, { enrichContext: true });
      logger.success(`LLM result for "${task.name}" (${result.length} chars)`);

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
      } catch {
        // Reflection should not block forge execution
      }

      results.push({ task: task.name, success: verified });
      emitTaskComplete(taskLabel, verified ? 8 : 3);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`LLM failed for task "${task.name}": ${errMsg}`);
      await recordMemory({
        category: 'error',
        summary: `Forge task failed: ${task.name}`,
        detail: errMsg,
        tags: ['forge', 'task-failure'],
        relatedCommands: ['forge'],
      });
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
    } catch {
      // Lessons capture should not block forge.
    }
    process.exitCode = 1;
  } else {
    logger.success(`Wave ${phase} complete - all ${passed} tasks passed`);
  }

  const timestamp = new Date().toISOString();
  if (failed === 0) {
    state.currentPhase = phase + 1;
    recordWorkflowStage(state, 'forge', timestamp);
  }
  state.auditLog.push(`${timestamp} | forge: wave ${phase} complete (${passed}/${tasks.length} passed, profile: ${profile}${parallel ? ', parallel' : ''}${failed > 0 ? ', failed' : ''})`);
  await saveState(state);
  if (failed === 0) {
    logger.info('Ready for next wave or party mode');
  }
  return { mode: 'executed', success: failed === 0 };
}
