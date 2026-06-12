// frontier-plan.ts — the per-dim BUILD PLAN engine (council lever 2, CH-014).
//
// The court-rejection pattern's root: push attempts were single cold 30-minute builds aimed at
// multi-week frontier bars, with a 2-judge court convened on every partial attempt (0/5 rejected,
// correctly). This engine changes the unit of work: the frozen bar (category_delta, verbatim —
// the anti-laundering gate guards it) is decomposed ONCE into checklist items sized to a build
// attempt, each carrying its OWN deterministic capability_test. Item completion is decided by
// RUNNING that test — never by builder assertion. Done/undone state IS the cross-attempt memory.
// The expensive frontier court convenes only when the checklist is exhausted. A different council
// member audits the decomposition once (anti-easy-exam, mirroring seedLeaderTargetFromLadder's
// philosophy: the bar is researched/judged, never self-set). A re-frozen spec (changed barHash)
// invalidates the plan — goalposts and plans move together or not at all.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { TODO_RE, type FrontierSpec } from './frontier-spec.js';

export interface PlanItem {
  id: string;
  title: string;
  /** The concrete build instruction (what to implement), derived from the bar. */
  what: string;
  /** Deterministic completion gate — exit 0 means DONE. Never builder-asserted. */
  capability_test: { command: string; description?: string };
  status: 'todo' | 'done';
  completedAt?: string;
  attempts: number;
}

export interface FrontierPlan {
  dimId: string;
  /** The frozen bar, verbatim. */
  bar: string;
  /** The spec's frozen_hash at decomposition time — a re-freeze invalidates the plan. */
  barHash: string;
  items: PlanItem[];
  decompositionAudit?: { judgeId: string; verdict: 'PASS' | 'FAIL'; reason: string; at: string };
  createdAt: string;
}

const PLAN_DIR = path.join('.danteforge', 'frontier-plans');

function planPath(cwd: string, dimId: string): string {
  return path.join(cwd, PLAN_DIR, `${dimId.replace(/[^\w-]/g, '_')}.json`);
}

export async function loadFrontierPlan(cwd: string, dimId: string): Promise<FrontierPlan | null> {
  try {
    const p = JSON.parse(await fs.readFile(planPath(cwd, dimId), 'utf8')) as FrontierPlan;
    return p?.dimId === dimId && Array.isArray(p.items) ? p : null;
  } catch {
    return null;
  }
}

export async function saveFrontierPlan(cwd: string, plan: FrontierPlan): Promise<void> {
  const p = planPath(cwd, plan.dimId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(plan, null, 2), 'utf8');
}

export function planComplete(plan: FrontierPlan): boolean {
  return plan.items.length > 0 && plan.items.every(i => i.status === 'done');
}

export function nextItems(plan: FrontierPlan, n = 2): PlanItem[] {
  return plan.items.filter(i => i.status === 'todo').slice(0, n);
}

/**
 * Lenient extraction of plan items from an LLM decomposition response. Valid plans have 2–10
 * items, each with a real title, a concrete `what`, and a non-empty deterministic test command.
 * Anything else returns [] — a malformed decomposition falls back to the legacy single-build
 * path rather than installing a half-plan. Exported for the pin.
 */
export function parsePlanItems(text: string): PlanItem[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 10) return [];
  const items: PlanItem[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i] as Record<string, unknown>;
    const title = typeof r['title'] === 'string' ? r['title'].trim() : '';
    const what = typeof r['what'] === 'string' ? r['what'].trim() : '';
    const cmd = typeof (r['capability_test'] as Record<string, unknown> | undefined)?.['command'] === 'string'
      ? String((r['capability_test'] as Record<string, unknown>)['command']).trim() : '';
    if (title.length < 8 || what.length < 24 || cmd.length < 8 || TODO_RE.test(cmd) || TODO_RE.test(what)) return [];
    items.push({
      id: `it-${String(i + 1).padStart(2, '0')}`,
      title, what,
      capability_test: { command: cmd, description: typeof (r['capability_test'] as Record<string, unknown>)['description'] === 'string' ? String((r['capability_test'] as Record<string, unknown>)['description']) : undefined },
      status: 'todo', attempts: 0,
    });
  }
  return items;
}

export type RunItemTest = (command: string, cwd: string) => Promise<number>;

async function defaultRunItemTest(command: string, cwd: string): Promise<number> {
  return await new Promise((resolve) => {
    execFile(command, { cwd, shell: true, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

/**
 * Refresh item statuses by RUNNING each open item's capability_test (exit 0 → done). This is the
 * ONLY way an item completes — never builder assertion. Returns the ids that flipped this pass.
 */
export async function refreshPlanItems(
  cwd: string,
  plan: FrontierPlan,
  runTest: RunItemTest = defaultRunItemTest,
): Promise<{ flipped: string[] }> {
  const flipped: string[] = [];
  for (const item of plan.items) {
    if (item.status === 'done') continue;
    const exit = await runTest(item.capability_test.command, cwd);
    if (exit === 0) {
      item.status = 'done';
      item.completedAt = new Date().toISOString();
      flipped.push(item.id);
    }
  }
  if (flipped.length > 0) await saveFrontierPlan(cwd, plan);
  return { flipped };
}

export function buildDecompositionPrompt(dimId: string, bar: string): string {
  return [
    `You are decomposing a FROZEN competitive frontier bar into a build checklist. Repo: the current working directory (an agentic dev CLI).`,
    ``,
    `DIMENSION: ${dimId}`,
    `THE BAR (verbatim, competitor-grounded — you may NOT soften, narrow, or reinterpret it):`,
    bar,
    ``,
    `Produce 3-8 checklist items that, COMPLETED TOGETHER, genuinely deliver the bar. Each item must be:`,
    `- sized to roughly one 30-minute focused build by a capable coding agent;`,
    `- concrete (names the module/behavior to build, not "improve X");`,
    `- gated by a DETERMINISTIC shell capability_test that exits 0 only when the item is genuinely done`,
    `  (a test file run, a CLI invocation checking real output — something a builder cannot satisfy by assertion).`,
    `  The test may be RED today (the item is not built yet) — that is expected and correct.`,
    ``,
    `Respond with ONLY a JSON array: [{"title": "...", "what": "...", "capability_test": {"command": "...", "description": "..."}}]`,
  ].join('\n');
}

export function buildPlanAuditPrompt(plan: FrontierPlan): string {
  return [
    `You are an INDEPENDENT auditor. A build plan was decomposed from a frozen competitive bar. Your job:`,
    `verify the checklist GENUINELY covers the bar — the classic failure is a plan that quietly narrows the`,
    `bar into an easy exam its own tests can pass.`,
    ``,
    `THE BAR (verbatim): ${plan.bar}`,
    ``,
    `THE PLAN:`,
    ...plan.items.map(i => `- ${i.id} ${i.title}: ${i.what} [gate: ${i.capability_test.command}]`),
    ``,
    `FAIL the plan if: any major capability in the bar has no item; any item's gate can pass without the`,
    `capability existing (vacuous test); or the items collectively deliver something narrower than the bar.`,
    `Respond with exactly one line: VERDICT: PASS — <reason>  or  VERDICT: FAIL — <reason>`,
  ].join('\n');
}

/** Parse the auditor's one-line verdict (lenient; absent/garbled → FAIL closed). Exported for the pin. */
export function parseAuditVerdict(text: string): { verdict: 'PASS' | 'FAIL'; reason: string } {
  const m = /VERDICT:\s*(PASS|FAIL)\s*[—-]?\s*(.*)/i.exec(text);
  if (!m) return { verdict: 'FAIL', reason: 'auditor returned no parseable verdict — failing closed' };
  return { verdict: m[1]!.toUpperCase() as 'PASS' | 'FAIL', reason: (m[2] ?? '').trim().slice(0, 300) };
}

export type RunMember = (memberId: string, prompt: string) => Promise<string>;

/**
 * Decompose the dim's frozen bar into a plan and have a DIFFERENT member audit it once.
 * Returns null (and installs nothing) when: no usable bar, malformed decomposition, or audit FAIL
 * — the caller falls back to the legacy single-build path; a bad plan is worse than no plan.
 */
export async function decomposeFrontierPlan(
  cwd: string,
  dimId: string,
  spec: FrontierSpec,
  members: string[],
  runMember: RunMember,
): Promise<FrontierPlan | null> {
  const lt = spec.leader_target;
  const bar = lt.category_delta && !TODO_RE.test(lt.category_delta) ? lt.category_delta
    : lt.observed_capability && !TODO_RE.test(lt.observed_capability) ? lt.observed_capability : '';
  if (!bar || members.length === 0) return null;

  const decomposer = members[0]!;
  const auditor = members.length > 1 ? members[1]! : members[0]!;

  const items = parsePlanItems(await runMember(decomposer, buildDecompositionPrompt(dimId, bar)).catch(() => ''));
  if (items.length === 0) return null;

  const plan: FrontierPlan = {
    dimId, bar, barHash: spec.frozen_hash ?? '', items, createdAt: new Date().toISOString(),
  };
  const audit = parseAuditVerdict(await runMember(auditor, buildPlanAuditPrompt(plan)).catch(() => ''));
  plan.decompositionAudit = { judgeId: auditor, verdict: audit.verdict, reason: audit.reason, at: new Date().toISOString() };
  if (audit.verdict !== 'PASS') return null;

  await saveFrontierPlan(cwd, plan);
  return plan;
}
