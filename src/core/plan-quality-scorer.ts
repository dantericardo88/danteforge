// Plan Quality Scorer — measures rigor, traceability, and completeness of plans.
// Pure functions; no filesystem I/O — all inputs are strings for easy testing.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanQualityResult {
  /** 0-10: what % of spec keywords appear in the plan */
  specCoverage: number;
  /** 0-10: tasks use verb+noun+criteria pattern vs vague statements */
  taskGranularity: number;
  /** 0-10: tasks are numbered/ordered and reference dependencies */
  dependencyOrdering: number;
  /** 0-10: plan includes time or complexity estimates */
  estimationPresent: number;
  /** 0-10: tasks have explicit "Done when:" / "AC:" / acceptance criteria */
  acceptanceCriteria: number;
  /** weighted average of all 5 dimensions */
  overallScore: number;
  /** human-readable improvement suggestions */
  suggestions: string[];
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
}

export interface DependencyGraph {
  tasks: string[];
  edges: TaskDependency[];
  /** true if no circular dependencies found */
  isAcyclic: boolean;
  /** tasks with no dependencies (can start first) */
  roots: string[];
  /** tasks that no other task depends on (can be done last) */
  leaves: string[];
}

export interface TraceabilityRow {
  reqId: string;
  requirementText: string;
  coveringTasks: string[];
  covered: boolean;
}

export interface TraceabilityReport {
  rows: TraceabilityRow[];
  coveragePercent: number;
  uncoveredCount: number;
  totalRequirements: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Extract meaningful keywords from spec text (nouns, verbs, technical terms). */
function extractSpecKeywords(specText: string): string[] {
  // Split on whitespace and punctuation, keep words 4+ chars
  const words = specText
    .toLowerCase()
    .replace(/[`'"(){}\[\]<>#*_~|\\]/g, ' ')
    .split(/[\s,;:.!?/\-]+/)
    .filter(w => w.length >= 4)
    .filter(w => !STOP_WORDS.has(w));

  // Deduplicate
  return [...new Set(words)];
}

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'will', 'have', 'been', 'when', 'where',
  'what', 'which', 'each', 'also', 'into', 'then', 'than', 'their', 'they',
  'should', 'would', 'could', 'must', 'need', 'make', 'take', 'some', 'more',
  'most', 'only', 'just', 'very', 'over', 'your', 'about', 'after', 'before',
  'other', 'such', 'used', 'using', 'user', 'users', 'code', 'data', 'file',
  'here', 'there', 'these', 'those', 'does', 'done', 'below', 'above',
]);

/** Count how many tasks match the "verb + noun (+ criteria)" pattern. */
const ACTION_VERBS = /\b(implement|create|build|add|write|configure|test|validate|refactor|extract|expose|wire|register|integrate|generate|parse|define|update|migrate|remove|fix|design|deploy|connect|enable|disable|document|scaffold|verify|ensure|support|handle|return|emit|log|read|save|load|fetch|send|receive|compute|calculate|render|display|format|convert|export|import|check|detect|enforce|inject|seed|mock|stub|wrap|hook|patch|extend|split|merge|sync)\b/i;

/** Patterns that indicate acceptance criteria. */
const AC_PATTERNS = [
  /done when[\s:]/i,
  /\bac[\s:]/i,
  /acceptance criteria/i,
  /verify[\s:]/i,
  /verif(?:y|ied) by/i,
  /assertion[\s:]/i,
  /expected output/i,
  /passes? (?:when|if)/i,
  /observable behavior/i,
  /green when/i,
  /exit code/i,
  /should (?:return|output|produce|emit|log)/i,
];

/** Patterns that indicate dependency declarations. */
const DEP_PATTERNS = [
  /depends? on (?:task|step)?\s*#?\d+/i,
  /after (?:task|step)?\s*#?\d+/i,
  /requires? (?:task|step)?\s*#?\d+/i,
  /blocked by/i,
  /prerequisite/i,
  /following (?:completion|task)/i,
  /\(after \w/i,
];

/** Patterns that indicate time or complexity estimates. */
const ESTIMATE_PATTERNS = [
  /\b[SMLX]L?\b/,    // S, M, L, XL
  /\b\d+[hH]\b/,     // 2h, 4H
  /\b\d+ ?(?:hours?|days?|mins?|minutes?)\b/i,
  /effort[\s:]+\w/i,
  /complexity[\s:]+\w/i,
  /~\d+/,            // ~2 days
  /estimate[\s:]+/i,
  /story points?/i,
  /\bsmall\b|\bmedium\b|\blarge\b/i,
  /\bsimple\b|\bcomplex\b/i,
];

/** Split plan text into individual task lines (numbered or bulleted). */
function extractTaskLines(planText: string): string[] {
  return planText
    .split('\n')
    .filter(line => /^\s*(?:\d+[.)]\s+|\*\s+|-\s+|\[[ x]\]\s+)/.test(line))
    .map(line => line.trim());
}

// ── Scoring dimensions ────────────────────────────────────────────────────────

function scoreSpecCoverage(planText: string, specText: string): number {
  if (!specText.trim()) return 5; // no spec to validate against — neutral
  const keywords = extractSpecKeywords(specText);
  if (keywords.length === 0) return 5;

  const planLower = planText.toLowerCase();
  const found = keywords.filter(kw => planLower.includes(kw));
  const ratio = found.length / keywords.length;

  // Scale: 0% → 0, 50% → 5, 80%+ → 10
  return Math.min(10, Math.round(ratio * 12));
}

function scoreTaskGranularity(planText: string): number {
  const lines = extractTaskLines(planText);
  if (lines.length === 0) return 2; // no structured tasks at all

  let verbCount = 0;
  let specificCount = 0;

  for (const line of lines) {
    if (ACTION_VERBS.test(line)) verbCount++;
    // "specific" = has verb + mentions a file/path/function/module name
    if (ACTION_VERBS.test(line) && /[a-z]+\.[a-z]{2,4}|src\/|lib\/|tests?\//i.test(line)) {
      specificCount++;
    }
  }

  const verbRatio = verbCount / lines.length;
  const specificRatio = specificCount / lines.length;

  return Math.min(10, Math.round((verbRatio * 5) + (specificRatio * 5)));
}

function scoreDependencyOrdering(planText: string): number {
  let score = 0;

  // Tasks are numbered
  const numberedTasks = (planText.match(/^\s*\d+[.)]/mg) ?? []).length;
  if (numberedTasks >= 3) score += 3;
  else if (numberedTasks >= 1) score += 1;

  // Phases are present
  if (/phase \d+|wave \d+|step \d+/i.test(planText)) score += 2;

  // Explicit dependency references
  const depMatches = DEP_PATTERNS.filter(p => p.test(planText)).length;
  score += Math.min(5, depMatches * 2);

  // Sequential ordering words
  if (/\b(?:first|then|next|finally|after completing|before starting)\b/i.test(planText)) score += 1;

  return Math.min(10, score);
}

function scoreEstimationPresent(planText: string): number {
  const matchCount = ESTIMATE_PATTERNS.filter(p => p.test(planText)).length;
  if (matchCount === 0) return 0;
  if (matchCount === 1) return 3;
  if (matchCount === 2) return 5;
  if (matchCount === 3) return 7;
  return Math.min(10, matchCount * 2);
}

function scoreAcceptanceCriteria(planText: string): number {
  const lines = extractTaskLines(planText);
  if (lines.length === 0) return 2;

  // Check globally in the plan text
  const globalMatches = AC_PATTERNS.filter(p => p.test(planText)).length;
  const perTaskMatches = lines.filter(line => AC_PATTERNS.some(p => p.test(line))).length;

  const taskRatio = perTaskMatches / lines.length;

  // Combine: global signals + per-task density
  const base = Math.round(taskRatio * 7);
  const bonus = Math.min(3, globalMatches);
  return Math.min(10, base + bonus);
}

// ── Suggestions generator ─────────────────────────────────────────────────────

function buildSuggestions(result: Omit<PlanQualityResult, 'suggestions' | 'overallScore'>): string[] {
  const s: string[] = [];

  if (result.specCoverage < 6) {
    s.push('spec_coverage: Many spec requirements are not reflected in plan tasks. Cross-check each spec requirement has at least one corresponding task.');
  }
  if (result.taskGranularity < 6) {
    s.push('task_granularity: Tasks are too vague. Prefix each task with an action verb (Implement, Create, Configure) and reference specific file paths.');
  }
  if (result.dependencyOrdering < 5) {
    s.push('dependency_ordering: Plan lacks explicit ordering. Number tasks sequentially and add "Depends on task N" annotations where ordering matters.');
  }
  if (result.estimationPresent < 4) {
    s.push('estimation_present: No effort estimates found. Tag each task with S/M/L/XL or hours (e.g., "- effort: M").');
  }
  if (result.acceptanceCriteria < 5) {
    s.push('acceptance_criteria: Tasks lack "Done when:" or "AC:" clauses. Add observable, verifiable acceptance criteria to each task.');
  }

  return s;
}

// ── Main scorer ───────────────────────────────────────────────────────────────

/**
 * Score a plan against a spec.
 *
 * Pure function — no I/O. Both inputs are strings.
 * Evaluates five quality dimensions and returns a weighted composite score:
 * - **specCoverage** (30 %) — how many spec keywords appear in plan tasks
 * - **taskGranularity** (25 %) — tasks use action-verb + file/path pattern
 * - **dependencyOrdering** (20 %) — numbered tasks + explicit dependency refs
 * - **estimationPresent** (10 %) — S/M/L/XL or hours annotations present
 * - **acceptanceCriteria** (15 %) — "Done when:" / "AC:" clauses present
 *
 * @param planText - Raw plan/tasks markdown to evaluate.
 * @param specText - Optional original spec markdown. When provided,
 *   `specCoverage` measures how well the plan maps spec requirements to tasks.
 *   Pass an empty string (default) to skip coverage scoring (neutral score 5).
 * @returns A `PlanQualityResult` with per-dimension scores (0–10),
 *   a weighted `overallScore`, and human-readable `suggestions`.
 *
 * @example
 * const result = scorePlan(planText, specText);
 * if (result.overallScore < 6) {
 *   for (const s of result.suggestions) console.warn(s);
 * }
 */
export function scorePlan(planText: string, specText: string = ''): PlanQualityResult {
  const specCoverage = scoreSpecCoverage(planText, specText);
  const taskGranularity = scoreTaskGranularity(planText);
  const dependencyOrdering = scoreDependencyOrdering(planText);
  const estimationPresent = scoreEstimationPresent(planText);
  const acceptanceCriteria = scoreAcceptanceCriteria(planText);

  // Weights: spec coverage + task granularity are most important
  const overallScore = Math.round(
    (specCoverage * 0.30 +
     taskGranularity * 0.25 +
     dependencyOrdering * 0.20 +
     estimationPresent * 0.10 +
     acceptanceCriteria * 0.15) * 10,
  ) / 10;

  const partial = { specCoverage, taskGranularity, dependencyOrdering, estimationPresent, acceptanceCriteria };
  const suggestions = buildSuggestions(partial);

  return { ...partial, overallScore, suggestions };
}

// ── Dependency graph builder ──────────────────────────────────────────────────

/**
 * Detect task dependency declarations from a TASKS.md text and build a
 * directed acyclic graph (DAG) of task relationships.
 *
 * Recognises natural-language dependency phrases such as:
 * - "depends on task 3" / "depends on step 3"
 * - "after task 2" / "requires task 1"
 * - "blocked by task 4" / "(after #2)"
 *
 * @param tasksText - Raw TASKS.md or numbered task list text.
 * @returns A `DependencyGraph` describing:
 *   - `tasks` — ordered list of task IDs found
 *   - `edges` — per-task dependency arrays
 *   - `isAcyclic` — false when a circular dependency is detected
 *   - `roots` — tasks with no dependencies (safe starting points)
 *   - `leaves` — tasks no other task depends on (terminal tasks)
 *
 * @example
 * const graph = buildDependencyGraph(tasksText);
 * if (!graph.isAcyclic) throw new Error('Circular dependency detected');
 * console.log('Start with tasks:', graph.roots);
 */
export function buildDependencyGraph(tasksText: string): DependencyGraph {
  const lines = tasksText.split('\n');
  const taskIds: string[] = [];
  const edgeMap = new Map<string, Set<string>>();

  // Collect all task IDs (numbered tasks)
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)[.)]/);
    if (match) {
      const id = match[1];
      taskIds.push(id);
      if (!edgeMap.has(id)) edgeMap.set(id, new Set());
    }
  }

  // Parse dependency references
  const DEP_CAPTURE = [
    /depends? on (?:task|step)?\s*#?(\d+)/gi,
    /after (?:task|step)?\s*#?(\d+)/gi,
    /requires? (?:task|step)?\s*#?(\d+)/gi,
    /blocked by (?:task|step)?\s*#?(\d+)/gi,
    /\(after #?(\d+)\)/gi,
  ];

  // Process line by line to associate deps with their task
  let currentTaskId: string | null = null;
  for (const line of lines) {
    const taskMatch = line.match(/^\s*(\d+)[.)]/)
    if (taskMatch) {
      currentTaskId = taskMatch[1];
    }

    if (currentTaskId) {
      const deps = edgeMap.get(currentTaskId) ?? new Set<string>();
      for (const pattern of DEP_CAPTURE) {
        pattern.lastIndex = 0; // reset regex state
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(line)) !== null) {
          const depId = m[1];
          if (depId !== currentTaskId && taskIds.includes(depId)) {
            deps.add(depId);
          }
        }
      }
      edgeMap.set(currentTaskId, deps);
    }
  }

  const edges: TaskDependency[] = taskIds.map(id => ({
    taskId: id,
    dependsOn: [...(edgeMap.get(id) ?? [])],
  }));

  // Detect cycles via DFS
  const isAcyclic = !hasCycle(taskIds, edgeMap);

  // Roots: tasks with no dependencies
  const roots = taskIds.filter(id => (edgeMap.get(id)?.size ?? 0) === 0);

  // Leaves: tasks that no other task depends on
  const allDeps = new Set(edges.flatMap(e => e.dependsOn));
  const leaves = taskIds.filter(id => !allDeps.has(id));

  return { tasks: taskIds, edges, isAcyclic, roots, leaves };
}

function hasCycle(tasks: string[], edgeMap: Map<string, Set<string>>): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const dep of edgeMap.get(node) ?? []) {
      if (dfs(dep)) return true;
    }
    inStack.delete(node);
    return false;
  }

  for (const t of tasks) {
    if (dfs(t)) return true;
  }
  return false;
}

// ── Spec-to-plan traceability ─────────────────────────────────────────────────

/**
 * Extract individual requirements from spec text.
 *
 * Recognises three requirement formats:
 * 1. `REQ-NNN: <text>` — explicit requirement IDs
 * 2. `N. <text>` or `N) <text>` — numbered items
 * 3. `- <text>` or `* <text>` — bulleted items with 15+ characters
 *
 * @param specText - Raw spec markdown content.
 * @returns Array of `{ id, text }` objects. IDs are normalised to `REQ-N` form.
 *
 * @example
 * const reqs = extractRequirements(specText);
 * console.log(reqs[0]); // { id: 'REQ-1', text: 'The system must ...' }
 */
export function extractRequirements(specText: string): Array<{ id: string; text: string }> {
  const reqs: Array<{ id: string; text: string }> = [];
  const lines = specText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // REQ-NNN pattern
    const reqIdMatch = trimmed.match(/^(REQ-\d+)[:\s](.+)/i);
    if (reqIdMatch) {
      reqs.push({ id: reqIdMatch[1].toUpperCase(), text: reqIdMatch[2].trim() });
      continue;
    }

    // Numbered item
    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (numMatch) {
      reqs.push({ id: `REQ-${numMatch[1]}`, text: numMatch[2].trim() });
      continue;
    }

    // Bulleted item with enough content
    const bulletMatch = trimmed.match(/^[-*]\s+(.{15,})/);
    if (bulletMatch) {
      reqs.push({ id: `REQ-${reqs.length + 1}`, text: bulletMatch[1].trim() });
    }
  }

  return reqs;
}

/**
 * Build a traceability report: for each spec requirement, find which plan
 * tasks cover it using keyword overlap matching.
 *
 * A task "covers" a requirement when at least 2 of the requirement's
 * significant keywords appear in the task line, or when ≥ 30 % of
 * keywords match.
 *
 * @param specText - Raw spec markdown to extract requirements from.
 * @param planText - Plan or TASKS.md markdown to search for coverage.
 * @returns A `TraceabilityReport` with:
 *   - `rows` — per-requirement coverage status
 *   - `coveragePercent` — 0–100 percentage of requirements covered
 *   - `uncoveredCount` — number of uncovered requirements
 *   - `totalRequirements` — total requirements extracted from spec
 *
 * @example
 * const report = buildTraceabilityReport(spec, plan);
 * if (report.uncoveredCount > 0) {
 *   console.warn(`${report.uncoveredCount} requirements have no covering task`);
 * }
 */
export function buildTraceabilityReport(
  specText: string,
  planText: string,
): TraceabilityReport {
  const requirements = extractRequirements(specText);
  const planLines = planText.split('\n');
  const taskLines = planLines.filter(l => /^\s*(?:\d+[.)]\s+|\*\s+|-\s+)/.test(l));

  const rows: TraceabilityRow[] = requirements.map(req => {
    const reqWords = req.text
      .toLowerCase()
      .split(/[\s,;:.!?()\[\]{}"']+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w));

    const coveringTasks: string[] = [];
    for (const taskLine of taskLines) {
      const taskLower = taskLine.toLowerCase();
      const matchCount = reqWords.filter(w => taskLower.includes(w)).length;
      // At least 2 keywords match, or 30% overlap
      if (matchCount >= 2 || (reqWords.length > 0 && matchCount / reqWords.length >= 0.3)) {
        coveringTasks.push(taskLine.trim().slice(0, 80));
      }
    }

    return {
      reqId: req.id,
      requirementText: req.text.slice(0, 100),
      coveringTasks,
      covered: coveringTasks.length > 0,
    };
  });

  const coveredCount = rows.filter(r => r.covered).length;
  const coveragePercent =
    rows.length > 0 ? Math.round((coveredCount / rows.length) * 100) : 100;

  return {
    rows,
    coveragePercent,
    uncoveredCount: rows.length - coveredCount,
    totalRequirements: rows.length,
  };
}
