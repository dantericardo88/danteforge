// mcp-injectable-handlers.ts — McpServerDeps interface, ToolName type, and
// dependency-injectable MCP tool handlers (return string, not ToolResult).
// Split from mcp-server.ts to keep files under the 750-LOC hard cap.
import { loadState } from './state.js';

// ---------------------------------------------------------------------------
// McpServerDeps â€” injection interface for testing
// ---------------------------------------------------------------------------

export interface McpServerDeps {
  /** Injected assess function â€” returns score and threshold result */
  _assess?: (opts: { cwd: string }) => Promise<{ overallScore: number; passesThreshold: boolean }>;
  /** Injected state loader â€” returns DanteState */
  _loadState?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected workflow info â€” returns workflowStage, currentPhase, lastHandoff, lastVerifyStatus */
  _workflow?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected lesson appender */
  _appendLesson?: (entry: string) => Promise<void>;
  /** Injected forge runner */
  _forge?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected autoforge runner */
  _autoforge?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected plan generator */
  _plan?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected tasks generator */
  _tasks?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected synthesize runner */
  _synthesize?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected retro runner */
  _retro?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected maturity assessor */
  _maturity?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected specify runner */
  _specify?: (opts: { cwd: string; idea?: string }) => Promise<unknown>;
  /** Injected constitution runner */
  _constitution?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected masterplan generator */
  _generateMasterplan?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected competitor scanner */
  _scanCompetitors?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected rate limiter â€” defaults to the MCP singleton. Override in tests to bypass. */
  _rateLimiter?: RateLimiter | null;
  /** Injected adversarial scorer â€” for testing danteforge_adversarial_score without LLM */
  _adversarialScore?: (opts: { cwd: string; summaryOnly?: boolean }) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Tool names
// ---------------------------------------------------------------------------

export type ToolName =
  | 'danteforge_state'
  | 'danteforge_score'
  | 'danteforge_score_all'
  | 'danteforge_gate_check'
  | 'danteforge_next_steps'
  | 'danteforge_task_list'
  | 'danteforge_artifact_read'
  | 'danteforge_lessons'
  | 'danteforge_memory_query'
  | 'danteforge_verify'
  | 'danteforge_handoff'
  | 'danteforge_budget_status'
  | 'danteforge_complexity'
  | 'danteforge_route_task'
  | 'danteforge_audit_log'
  | 'danteforge_assess'
  | 'danteforge_forge'
  | 'danteforge_autoforge'
  | 'danteforge_plan'
  | 'danteforge_tasks'
  | 'danteforge_synthesize'
  | 'danteforge_retro'
  | 'danteforge_maturity'
  | 'danteforge_specify'
  | 'danteforge_constitution'
  | 'danteforge_state_read'
  | 'danteforge_masterplan'
  | 'danteforge_competitors'
  | 'danteforge_lessons_add'
  | 'danteforge_workflow'
  | 'danteforge_adoption_queue'
  | 'danteforge_quality_certificate'
  | 'danteforge_pattern_coverage'
  | 'danteforge_harvest_next_pattern'
  | 'danteforge_explain_score'
  | 'danteforge_leapfrog_opportunities'
  | 'danteforge_pattern_search'
  | 'danteforge_universe'
  | 'danteforge_ensure_universe_ready'
  | 'danteforge_canonical_competitors'
  | 'danteforge_compete_reset'
  | 'danteforge_adversarial_score'
  | 'danteforge_convergence_status'
  | 'danteforge_git_activity'
  | 'danteforge_health'
  | 'danteforge_search_find_pattern'
  | 'danteforge_search_find_symbol'
  | 'danteforge_search_find_imports'
  | 'danteforge_research_get_status'
  | 'danteforge_research_get_history'
  | 'danteforge_research_get_caps';

// ---------------------------------------------------------------------------
// New injectable tool handlers
// ---------------------------------------------------------------------------

async function handleAssess(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  if (deps._assess) {
    const result = await deps._assess({ cwd });
    return JSON.stringify(result);
  }
  // Real implementation fallback
  try {
    const assessMod = await import('../cli/commands/assess.js');
    const runFn = (assessMod as Record<string, unknown>)['runAssess'] as ((opts: { cwd: string }) => Promise<unknown>) | undefined;
    if (runFn) {
      const result = await runFn({ cwd });
      return JSON.stringify(result);
    }
    return JSON.stringify({ overallScore: 0, passesThreshold: false, error: 'runAssess not exported' });
  } catch {
    return JSON.stringify({ overallScore: 0, passesThreshold: false, error: 'assess not available' });
  }
}

async function handleStateRead(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  if (deps._loadState) {
    const state = await deps._loadState({ cwd });
    return JSON.stringify(state);
  }
  const state = await loadState({ cwd });
  return JSON.stringify(state);
}

async function handleWorkflow(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  if (deps._workflow) {
    const result = await deps._workflow({ cwd });
    return JSON.stringify(result);
  }
  const state = await loadState({ cwd });
  return JSON.stringify({
    workflowStage: state.workflowStage,
    currentPhase: state.currentPhase,
    lastHandoff: state.lastHandoff,
    lastVerifyStatus: (state as unknown as Record<string, unknown>)['lastVerifyStatus'],
  });
}

async function handleLessonsAdd(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const lesson = typeof args['lesson'] === 'string' ? args['lesson'] : '';
  if (deps._appendLesson) {
    await deps._appendLesson(lesson);
    return JSON.stringify({ ok: true, lesson });
  }
  // Real fallback
  try {
    const { appendLesson } = await import('../cli/commands/lessons.js');
    await appendLesson(lesson);
    return JSON.stringify({ ok: true, lesson });
  } catch {
    return JSON.stringify({ ok: false, error: 'appendLesson not available', lesson });
  }
}

async function handleAdversarialScore(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  const summaryOnly = args['summaryOnly'] === true;
  if (deps._adversarialScore) {
    const result = await deps._adversarialScore({ cwd, summaryOnly });
    return JSON.stringify(result ?? { ok: true });
  }
  try {
    const { generateAdversarialScore } = await import('./adversarial-scorer-dim.js');
    const { computeHarshScore } = await import('./harsh-scorer.js');
    const selfResult = await computeHarshScore({ cwd });
    const result = await generateAdversarialScore(selfResult, { cwd, summaryOnly });
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      error: `Adversarial scoring failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

async function handleSimpleInjectable(
  name: string,
  args: Record<string, unknown>,
  deps: McpServerDeps,
  injected?: (opts: { cwd: string; idea?: string }) => Promise<unknown>,
): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  const idea = typeof args['idea'] === 'string' ? args['idea'] : undefined;
  if (injected) {
    const result = await injected({ cwd, idea });
    return JSON.stringify(result ?? { ok: true });
  }
  return JSON.stringify({ ok: true, message: `${name} not fully wired in this mode` });
}


export {
  McpServerDeps,
  handleAssess,
  handleStateRead,
  handleWorkflow,
  handleLessonsAdd,
  handleAdversarialScore,
  handleSimpleInjectable,
};
export type { ToolName };
