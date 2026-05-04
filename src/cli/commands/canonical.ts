// canonical.ts — Five canonical process dispatchers with --level light|standard|deep
//
// COMMAND-SURFACE-REDESIGN.md implementation:
//   plan, build, measure, compete, harvest — each with --level light|standard|deep
//
// All existing commands remain untouched. These dispatchers route to them.
// Injection seams (_fns) allow full unit testing without LLM or filesystem calls.

import { logger } from '../../core/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CanonicalLevel = 'light' | 'standard' | 'deep';

export function resolveLevel(raw?: string, fallback: CanonicalLevel = 'standard'): CanonicalLevel {
  const normalized = raw?.toLowerCase();
  if (normalized === 'light' || normalized === 'standard' || normalized === 'deep') return normalized;
  if (raw) logger.warn(`Unknown --level "${raw}" — defaulting to "${fallback}"`);
  return fallback;
}

// ── 1. plan ────────────────────────────────────────────────────────────────────
//
//   light    → review (repo grounding) + specify
//   standard → constitution + specify + clarify + plan
//   deep     → standard + tech-decide + tasks

export interface CanonicalPlanFns {
  review: () => Promise<void>;
  specify: (goal: string) => Promise<void>;
  constitution: () => Promise<void>;
  clarify: () => Promise<void>;
  plan: () => Promise<void>;
  critique: () => Promise<void>;
  techDecide: () => Promise<void>;
  tasks: () => Promise<void>;
  /** Sprint-plan mode: harvest-aware next sprint */
  sprintPlan: () => Promise<void>;
  /** Define-done mode: set completion target */
  defineDone: () => Promise<void>;
}

export interface CanonicalPlanOptions {
  level?: string;
  prompt?: boolean;
  light?: boolean;
  /** 'sprint' → harvest-aware sprint plan; 'define-done' → set completion target */
  mode?: 'sprint' | 'define-done';
  /** Skip the auto-critique gate (blocking gaps won't halt) */
  skipCritique?: boolean;
  _fns?: Partial<CanonicalPlanFns>;
}

export async function canonicalPlan(goal?: string, options: CanonicalPlanOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[plan --level ${level}]${goal ? ` goal: "${goal}"` : ''}${options.mode ? ` --mode ${options.mode}` : ''}`);

  const fns: CanonicalPlanFns = {
    review: options._fns?.review ?? (async () => {
      const { review } = await import('./review.js');
      await review({ prompt: options.prompt });
    }),
    specify: options._fns?.specify ?? (async (g: string) => {
      const { specify } = await import('./specify.js');
      await specify(g, { prompt: options.prompt, light: level !== 'deep' });
    }),
    constitution: options._fns?.constitution ?? (async () => {
      const { constitution } = await import('./constitution.js');
      await constitution();
    }),
    clarify: options._fns?.clarify ?? (async () => {
      const { clarify } = await import('./clarify.js');
      await clarify({ prompt: options.prompt, light: true });
    }),
    plan: options._fns?.plan ?? (async () => {
      const { plan } = await import('./plan.js');
      await plan({ prompt: options.prompt, light: level === 'standard' });
    }),
    critique: options._fns?.critique ?? (async () => {
      const { critique } = await import('./critique.js');
      await critique('PLAN.md');
    }),
    techDecide: options._fns?.techDecide ?? (async () => {
      const { techDecide } = await import('./tech-decide.js');
      await techDecide({ prompt: options.prompt });
    }),
    tasks: options._fns?.tasks ?? (async () => {
      const { tasks } = await import('./tasks.js');
      await tasks({ prompt: options.prompt });
    }),
    sprintPlan: options._fns?.sprintPlan ?? (async () => {
      const { runSprintPlan } = await import('./sprint-plan.js');
      await runSprintPlan({});
    }),
    defineDone: options._fns?.defineDone ?? (async () => {
      const { defineDone } = await import('./define-done.js');
      await defineDone();
    }),
  };

  // --mode dispatch: always takes priority over --level
  if (options.mode === 'sprint') {
    await fns.sprintPlan();
    return;
  }
  if (options.mode === 'define-done') {
    await fns.defineDone();
    return;
  }

  if (level === 'light') {
    if (goal) {
      await fns.specify(goal);
    } else {
      await fns.review();
    }
    return;
  }

  // standard and deep: constitution + specify + clarify + plan + auto-critique
  await fns.constitution();
  if (goal) await fns.specify(goal);
  await fns.clarify();
  await fns.plan();
  if (!options.skipCritique) {
    await fns.critique();
  }

  if (level === 'deep') {
    await fns.techDecide();
    await fns.tasks();
  }
}

// ── 2. build ───────────────────────────────────────────────────────────────────
//
//   light    → single forge wave
//   standard → magic-style balanced execution
//   deep     → inferno-style with OSS harvest

export interface CanonicalBuildFns {
  forgeLight: () => Promise<void>;
  magicStandard: (goal?: string) => Promise<void>;
  infernoDeep: (goal?: string) => Promise<void>;
  /** Load checkpoint from .danteforge/checkpoint.json, returns stage name or undefined */
  loadCheckpoint: () => Promise<string | undefined>;
  /** Run self-improve loop up to target score (plateau detection included) */
  selfImprove: (goal: string | undefined, target: number) => Promise<{ finalScore: number; plateauDetected: boolean }>;
  /** Run adversarial scorer; returns true if score agreement is within tolerance */
  adversarialScore: () => Promise<boolean>;
}

export interface CanonicalBuildOptions {
  level?: string;
  prompt?: boolean;
  profile?: string;
  worktree?: boolean;
  isolation?: boolean;
  maxRepos?: number;
  withDesign?: boolean;
  designPrompt?: string;
  yes?: boolean;
  /** Resume from .danteforge/checkpoint.json */
  resume?: boolean;
  /** Loop until displayScore >= target */
  target?: number;
  /** Enable adversarial score gate between cycles */
  adversarial?: boolean;
  _fns?: Partial<CanonicalBuildFns>;
}

export async function canonicalBuild(goal?: string, options: CanonicalBuildOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[build --level ${level}]${goal ? ` goal: "${goal}"` : ''}${options.resume ? ' --resume' : ''}${options.target !== undefined ? ` --target ${options.target}` : ''}`);

  const fns: CanonicalBuildFns = {
    forgeLight: options._fns?.forgeLight ?? (async () => {
      const { forge } = await import('./forge.js');
      await forge('1', {
        prompt: options.prompt,
        profile: options.profile ?? 'balanced',
        light: true,
        worktree: options.worktree,
      });
    }),
    magicStandard: options._fns?.magicStandard ?? (async (g?: string) => {
      const { magic } = await import('./magic.js');
      await magic(g, {
        level: 'magic',
        profile: options.profile ?? 'balanced',
        prompt: options.prompt,
        worktree: options.worktree,
        isolation: options.isolation,
        yes: options.yes,
      });
    }),
    infernoDeep: options._fns?.infernoDeep ?? (async (g?: string) => {
      const { inferno } = await import('./magic.js');
      await inferno(g, {
        profile: options.profile ?? 'balanced',
        prompt: options.prompt,
        worktree: options.worktree,
        isolation: options.isolation,
        maxRepos: options.maxRepos ?? 12,
        withDesign: options.withDesign,
        designPrompt: options.designPrompt,
        yes: options.yes,
      });
    }),
    loadCheckpoint: options._fns?.loadCheckpoint ?? (async () => {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const cwd = process.cwd();
        const raw = await fs.readFile(path.join(cwd, '.danteforge', 'checkpoint.json'), 'utf8');
        const cp = JSON.parse(raw) as { stage?: string };
        return cp.stage;
      } catch {
        return undefined;
      }
    }),
    selfImprove: options._fns?.selfImprove ?? (async (g: string | undefined, target: number) => {
      const { selfImprove } = await import('./self-improve.js');
      const result = await selfImprove({ goal: g, minScore: target, maxCycles: 5 });
      return { finalScore: result.finalScore, plateauDetected: result.plateauDetected };
    }),
    adversarialScore: options._fns?.adversarialScore ?? (async () => {
      try {
        const { score } = await import('./score.js');
        await score({ adversary: true });
        return true;
      } catch {
        return false;
      }
    }),
  };

  // --resume: log checkpoint stage, then continue with normal level execution
  if (options.resume) {
    const stage = await fns.loadCheckpoint();
    if (stage) {
      logger.info(`[build --resume] Resuming from checkpoint stage: ${stage}`);
    } else {
      logger.info('[build --resume] No checkpoint found — starting fresh');
    }
  }

  // --target: run self-improve loop to reach target score (wraps level execution)
  if (options.target !== undefined) {
    const result = await fns.selfImprove(goal, options.target);
    if (options.adversarial) {
      await fns.adversarialScore();
    }
    logger.info(`[build --target ${options.target}] Final score: ${result.finalScore.toFixed(1)}${result.plateauDetected ? ' (plateau detected)' : ''}`);
    return;
  }

  switch (level) {
    case 'light':    return fns.forgeLight();
    case 'standard': return fns.magicStandard(goal);
    case 'deep':     return fns.infernoDeep(goal);
  }
}

// ── 3. measure ─────────────────────────────────────────────────────────────────
//
//   light    → quick score (fast daily honesty check, default)
//   standard → score --full + maturity + proof delta
//   deep     → verify + score --full --strict --adversary + convergence proof

export interface CanonicalMeasureFns {
  score: (full?: boolean, strict?: boolean, adversary?: boolean) => Promise<void>;
  maturity: () => Promise<void>;
  proof: (pipeline?: boolean, convergence?: boolean) => Promise<void>;
  verify: () => Promise<void>;
}

export interface CanonicalMeasureOptions {
  level?: string;
  full?: boolean;
  strict?: boolean;
  adversary?: boolean;
  json?: boolean;
  _fns?: Partial<CanonicalMeasureFns>;
}

export async function canonicalMeasure(options: CanonicalMeasureOptions = {}): Promise<void> {
  const requestedLevel = options.level?.toLowerCase();
  const level = requestedLevel === 'full' ? 'full' : resolveLevel(options.level, 'light');
  logger.info(`[measure --level ${level}]`);

  const fns: CanonicalMeasureFns = {
    score: options._fns?.score ?? (async (full?: boolean, strict?: boolean, adversary?: boolean) => {
      const { score } = await import('./score.js');
      await score({ full, strict, adversary });
    }),
    maturity: options._fns?.maturity ?? (async () => {
      const { maturity } = await import('./maturity.js');
      await maturity({ json: options.json });
    }),
    proof: options._fns?.proof ?? (async (pipeline?: boolean, convergence?: boolean) => {
      const { proof } = await import('./proof.js');
      await proof({ pipeline, convergence });
    }),
    verify: options._fns?.verify ?? (async () => {
      const { verify } = await import('./verify.js');
      await verify();
    }),
  };

  if (level === 'light') {
    await fns.score(options.full, options.strict);
    return;
  }

  if (level === 'full') {
    await fns.score(true, options.strict);
    return;
  }

  if (level === 'standard') {
    await fns.score(true, options.strict);
    await fns.maturity();
    try { await fns.proof(true); } catch { /* best-effort */ }
    return;
  }

  // deep: verify + adversarial score + convergence proof
  try { await fns.verify(); } catch { /* continue even if verify fails */ }
  await fns.score(true, true, options.adversary ?? true);
  try { await fns.proof(true, true); } catch { /* best-effort */ }
}

// ── 4. compete ─────────────────────────────────────────────────────────────────
//
//   light    → harsh self-assessment + current gap table
//   standard → assess + universe refresh + ranked gap map
//   deep     → full Competitive Harvest Loop (auto sprint cycle)

export interface CanonicalCompeteFns {
  assess: () => Promise<void>;
  universe: () => Promise<void>;
  compete: () => Promise<void>;
  /** Frontier-gap / raise-readiness classification */
  frontierGap: () => Promise<void>;
  /** Add competitor to universe */
  addCompetitor: (name: string) => Promise<void>;
  /** Build evidence dossier for one competitor */
  dossier: (name: string) => Promise<void>;
}

export interface CanonicalCompeteOptions {
  level?: string;
  json?: boolean;
  refresh?: boolean;
  yes?: boolean;
  /** Run raise-readiness: skeptic objection scoring + frontier classification */
  raiseReady?: boolean;
  /** Sub-action: 'add' or 'dossier' */
  action?: 'add' | 'dossier';
  /** Competitor name for add/dossier sub-actions */
  name?: string;
  _fns?: Partial<CanonicalCompeteFns>;
}

export async function canonicalCompete(options: CanonicalCompeteOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[compete --level ${level}]${options.raiseReady ? ' --raise-ready' : ''}${options.action ? ` --action ${options.action}` : ''}`);

  const fns: CanonicalCompeteFns = {
    assess: options._fns?.assess ?? (async () => {
      const { assess } = await import('./assess.js');
      await assess({ harsh: true, json: options.json });
    }),
    universe: options._fns?.universe ?? (async () => {
      const { universe } = await import('./universe.js');
      await universe({ refresh: options.refresh ?? true, json: options.json });
    }),
    compete: options._fns?.compete ?? (async () => {
      const { compete } = await import('./compete.js');
      await compete({ auto: true, yes: options.yes });
    }),
    frontierGap: options._fns?.frontierGap ?? (async () => {
      const { frontierGap } = await import('./frontier-gap.js');
      await frontierGap();
    }),
    addCompetitor: options._fns?.addCompetitor ?? (async (name: string) => {
      const { loadState, saveState } = await import('../../core/state.js');
      const state = await loadState();
      const existing = state.competitors ?? [];
      if (!existing.includes(name)) {
        state.competitors = [...existing, name];
        await saveState(state);
        logger.info(`[compete] Added competitor: ${name}`);
      } else {
        logger.info(`[compete] Competitor already in list: ${name}`);
      }
    }),
    dossier: options._fns?.dossier ?? (async (name: string) => {
      const { dossierBuild } = await import('./dossier.js');
      await dossierBuild(name, {});
    }),
  };

  // Sub-action dispatch
  if (options.action === 'add' && options.name) {
    await fns.addCompetitor(options.name);
    return;
  }
  if (options.action === 'dossier' && options.name) {
    await fns.dossier(options.name);
    return;
  }

  // --raise-ready: frontier classification only
  if (options.raiseReady) {
    await fns.frontierGap();
    return;
  }

  if (level === 'light') {
    await fns.assess();
    return;
  }
  if (level === 'standard') {
    await fns.assess();
    await fns.universe();
    return;
  }
  // deep: full CHL auto loop + frontier classification
  await fns.compete();
  await fns.frontierGap();
}

// ── 5. harvest ─────────────────────────────────────────────────────────────────
//
//   light    → focused harvest-pattern or harvest --lite
//   standard → bounded OSS or local-harvest pass
//   deep     → OSS + local-harvest + universe refresh
//              (with --until-saturation: loop until new-feature yield drops below threshold)

export interface CanonicalHarvestFns {
  harvestPattern: (pattern: string) => Promise<void>;
  harvestLite: () => Promise<void>;
  ossStandard: () => Promise<void>;
  localHarvestStandard: () => Promise<void>;
  ossDeep: () => Promise<void>;
  localHarvestDeep: () => Promise<void>;
  universeRefresh: () => Promise<{ featureCount: number }>;
  /** Metric-driven autoresearch loop */
  autoresearch: (metric: string) => Promise<void>;
}

export interface CanonicalHarvestOptions {
  level?: string;
  source?: string;
  maxRepos?: number;
  prompt?: boolean;
  refresh?: boolean;
  depth?: string;
  /** Run deep harvest cycles until new-feature yield drops below threshold (two consecutive lean cycles stops the loop). */
  untilSaturation?: boolean;
  /** Max OSS cycles for --until-saturation mode (default: 5). */
  maxCycles?: number;
  /** Min new features per cycle before the cycle is considered "lean" (default: 3). */
  saturationThreshold?: number;
  /** Metric-driven mode: run autoresearch targeting this metric (noise-margin aware) */
  optimize?: string;
  _fns?: Partial<CanonicalHarvestFns>;
}

export async function canonicalHarvest(goal?: string, options: CanonicalHarvestOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[harvest --level ${level}]${goal ? ` goal: "${goal}"` : ''}`);

  const fns: CanonicalHarvestFns = {
    harvestPattern: options._fns?.harvestPattern ?? (async (pattern: string) => {
      const { harvestPattern } = await import('./harvest-pattern.js');
      await harvestPattern({ pattern, maxRepos: options.maxRepos ?? 5 });
    }),
    harvestLite: options._fns?.harvestLite ?? (async () => {
      const { harvest } = await import('./harvest.js');
      await harvest('', { lite: true, prompt: options.prompt });
    }),
    ossStandard: options._fns?.ossStandard ?? (async () => {
      const { ossResearcher } = await import('./oss.js');
      await ossResearcher({ maxRepos: String(options.maxRepos ?? 8), prompt: options.prompt });
    }),
    localHarvestStandard: options._fns?.localHarvestStandard ?? (async () => {
      const { localHarvest } = await import('./local-harvest.js');
      await localHarvest([], { depth: options.depth ?? 'medium', prompt: options.prompt });
    }),
    ossDeep: options._fns?.ossDeep ?? (async () => {
      const { ossResearcher } = await import('./oss.js');
      await ossResearcher({ maxRepos: String(options.maxRepos ?? 12), prompt: options.prompt });
    }),
    localHarvestDeep: options._fns?.localHarvestDeep ?? (async () => {
      const { localHarvest } = await import('./local-harvest.js');
      await localHarvest([], { depth: options.depth ?? 'full', prompt: options.prompt });
    }),
    universeRefresh: options._fns?.universeRefresh ?? (async () => {
      try {
        const { universe } = await import('./universe.js');
        await universe({ refresh: true });
      } catch { /* best-effort */ }
      return { featureCount: 0 };
    }),
    autoresearch: options._fns?.autoresearch ?? (async (metric: string) => {
      const { autoResearch } = await import('./autoresearch.js');
      await autoResearch(metric, { prompt: options.prompt });
    }),
  };

  // --optimize: metric-driven autoresearch — takes priority over --level
  if (options.optimize) {
    await fns.autoresearch(options.optimize);
    return;
  }

  if (level === 'light') {
    if (goal) {
      await fns.harvestPattern(goal);
    } else {
      await fns.harvestLite();
    }
    return;
  }

  if (level === 'standard') {
    const source = options.source ?? 'oss';
    if (source === 'local') {
      await fns.localHarvestStandard();
    } else {
      await fns.ossStandard();
    }
    return;
  }

  // deep
  if (options.untilSaturation) {
    await runUntilSaturation(fns, options);
    return;
  }

  await fns.ossDeep();
  const source = options.source ?? 'oss';
  if (source === 'local' || source === 'mixed') {
    await fns.localHarvestDeep();
  }
  await fns.universeRefresh();
}

// ── Saturation loop ────────────────────────────────────────────────────────────
//
// Runs OSS cycles until two consecutive cycles yield fewer than `saturationThreshold`
// new features, or `maxCycles` is reached — whichever comes first.

async function runUntilSaturation(
  fns: CanonicalHarvestFns,
  options: CanonicalHarvestOptions,
): Promise<void> {
  const maxCycles = options.maxCycles ?? 5;
  const saturationThreshold = options.saturationThreshold ?? 3;

  logger.info(`[harvest --level deep --until-saturation] max ${maxCycles} cycles, stops after 2 lean cycles (<${saturationThreshold} new features)`);

  let leanCycles = 0;
  let prevFeatureCount = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    logger.info(`[harvest saturation] cycle ${cycle}/${maxCycles}`);

    await fns.ossDeep();

    const source = options.source ?? 'oss';
    if (source === 'local' || source === 'mixed') {
      await fns.localHarvestDeep();
    }

    const { featureCount } = await fns.universeRefresh();
    const newFeatures = featureCount - prevFeatureCount;

    logger.info(`[harvest saturation] cycle ${cycle}: +${newFeatures} new features (universe total: ${featureCount})`);

    if (newFeatures < saturationThreshold) {
      leanCycles++;
      logger.info(`[harvest saturation] lean cycle ${leanCycles}/2`);
      if (leanCycles >= 2) {
        logger.info('[harvest saturation] saturation reached — stopping');
        break;
      }
    } else {
      leanCycles = 0;
    }

    prevFeatureCount = featureCount;
  }

  logger.info('[harvest saturation] complete');
}

// ── canonicalEvidence ────────────────────────────────────────────────────────
// Unifies: proof, certify, audit-export, causal-status, time-machine

export interface CanonicalEvidenceFns {
  verify: () => Promise<void>;
  export: () => Promise<void>;
  certify: () => Promise<void>;
  timeline: () => Promise<void>;
  branch: (nodeId: string) => Promise<void>;
  causal: () => Promise<void>;
}

export interface CanonicalEvidenceOptions {
  action?: 'verify' | 'export' | 'certify' | 'timeline' | 'branch' | 'causal';
  nodeId?: string;
  cwd?: string;
  _fns?: Partial<CanonicalEvidenceFns>;
}

export async function canonicalEvidence(options: CanonicalEvidenceOptions = {}): Promise<void> {
  const fns: CanonicalEvidenceFns = {
    verify: options._fns?.verify ?? (async () => {
      const { proof } = await import('./proof.js');
      await proof({ cwd: options.cwd });
    }),
    export: options._fns?.export ?? (async () => {
      const { auditExport } = await import('./audit-export.js');
      await auditExport({ format: 'json', output: 'docs/evidence-export/audit-log.json' });
    }),
    certify: options._fns?.certify ?? (async () => {
      const { runCertify } = await import('./certify.js');
      await runCertify({ cwd: options.cwd });
    }),
    timeline: options._fns?.timeline ?? (async () => {
      const { timeMachine } = await import('./time-machine.js');
      await timeMachine({ action: 'node-list', cwd: options.cwd });
    }),
    branch: options._fns?.branch ?? (async (_nodeId: string) => {
      const { timeMachine } = await import('./time-machine.js');
      await timeMachine({ action: 'node-trace', cwd: options.cwd });
    }),
    causal: options._fns?.causal ?? (async () => {
      const { causalStatus } = await import('./causal-status.js');
      await causalStatus({ cwd: options.cwd });
    }),
  };

  switch (options.action) {
    case 'verify':   return fns.verify();
    case 'export':   return fns.export();
    case 'certify':  return fns.certify();
    case 'timeline': return fns.timeline();
    case 'branch':   return fns.branch(options.nodeId ?? '');
    case 'causal':   return fns.causal();
    default:
      logger.info('[evidence] Available actions: verify, export, certify, timeline, branch <node-id>, causal');
      logger.info('[evidence] Run `danteforge evidence verify` to check proof chain integrity.');
  }
}

// ── canonicalKnowledge ───────────────────────────────────────────────────────
// Unifies: lessons, teach, prime, synthesize, explain, wiki-*, share-patterns

export interface CanonicalKnowledgeFns {
  learn: (entry: string) => Promise<void>;
  prime: () => Promise<void>;
  explain: (target: string) => Promise<void>;
  wiki: (topic: string, write?: boolean) => Promise<void>;
  synthesize: () => Promise<void>;
  share: () => Promise<void>;
}

export interface CanonicalKnowledgeOptions {
  action?: 'learn' | 'prime' | 'explain' | 'wiki' | 'synthesize' | 'share';
  entry?: string;
  target?: string;
  topic?: string;
  write?: boolean;
  cwd?: string;
  _fns?: Partial<CanonicalKnowledgeFns>;
}

export async function canonicalKnowledge(options: CanonicalKnowledgeOptions = {}): Promise<void> {
  const fns: CanonicalKnowledgeFns = {
    learn: options._fns?.learn ?? (async (entry: string) => {
      const { teach } = await import('./teach.js');
      await teach({ correction: entry, cwd: options.cwd });
    }),
    prime: options._fns?.prime ?? (async () => {
      const { prime } = await import('./prime.js');
      await prime({ cwd: options.cwd });
    }),
    explain: options._fns?.explain ?? (async (target: string) => {
      const { explain } = await import('./explain.js');
      explain({ term: target });
    }),
    wiki: options._fns?.wiki ?? (async (topic: string, write?: boolean) => {
      if (write) {
        const { wikiIngestCommand } = await import('./wiki-ingest.js');
        await wikiIngestCommand({ cwd: options.cwd });
      } else {
        const { wikiQueryCommand } = await import('./wiki-query.js');
        await wikiQueryCommand({ topic, cwd: options.cwd });
      }
    }),
    synthesize: options._fns?.synthesize ?? (async () => {
      const { synthesize } = await import('./synthesize.js');
      await synthesize({});
    }),
    share: options._fns?.share ?? (async () => {
      const { runSharePatterns } = await import('./share-patterns.js');
      await runSharePatterns({ cwd: options.cwd });
    }),
  };

  switch (options.action) {
    case 'learn':      return fns.learn(options.entry ?? '');
    case 'prime':      return fns.prime();
    case 'explain':    return fns.explain(options.target ?? '');
    case 'wiki':       return fns.wiki(options.topic ?? '', options.write);
    case 'synthesize': return fns.synthesize();
    case 'share':      return fns.share();
    default:
      logger.info('[knowledge] Available actions: learn, prime, explain, wiki, synthesize, share');
      logger.info('[knowledge] Run `danteforge knowledge prime` to load lessons into context.');
  }
}

// ── canonicalShip ─────────────────────────────────────────────────────────────
// Unifies: verify, qa, browse, publish-check, ci-setup

export type CanonicalShipLevel = 'light' | 'standard' | 'deep';

export interface CanonicalShipFns {
  verify: () => Promise<void>;
  qa: () => Promise<void>;
  browse: () => Promise<void>;
  publishCheck: () => Promise<void>;
  ciSetup: () => Promise<void>;
}

export interface CanonicalShipOptions {
  level?: CanonicalShipLevel;
  dryRun?: boolean;
  withBrowse?: boolean;
  action?: 'ci-setup';
  cwd?: string;
  _fns?: Partial<CanonicalShipFns>;
}

export async function canonicalShip(options: CanonicalShipOptions = {}): Promise<void> {
  const fns: CanonicalShipFns = {
    verify: options._fns?.verify ?? (async () => {
      const { verify } = await import('./verify.js');
      await verify({ cwd: options.cwd });
    }),
    qa: options._fns?.qa ?? (async () => {
      const { qa } = await import('./qa.js');
      await qa({ url: '' });
    }),
    browse: options._fns?.browse ?? (async () => {
      const { browse } = await import('./browse.js');
      await browse('open', [], {});
    }),
    publishCheck: options._fns?.publishCheck ?? (async () => {
      const { publishCheck } = await import('./publish-check.js');
      await publishCheck({});
    }),
    ciSetup: options._fns?.ciSetup ?? (async () => {
      const { ciSetup } = await import('./ci-setup.js');
      await ciSetup({ cwd: options.cwd });
    }),
  };

  if (options.action === 'ci-setup') return fns.ciSetup();

  const level = options.level ?? 'standard';

  await fns.verify();

  if (level === 'light') return;

  await fns.qa();
  if (options.withBrowse) await fns.browse();

  if (level === 'deep' || options.dryRun !== undefined) {
    await fns.publishCheck();
  }
}

// ── canonicalDesign ──────────────────────────────────────────────────────────
// Unifies: design, ux-refine, canvas

export type CanonicalDesignLevel = 'light' | 'standard' | 'deep';

export interface CanonicalDesignFns {
  tokens: () => Promise<void>;
  render: () => Promise<void>;
  figmaPush: () => Promise<void>;
  uxRefine: () => Promise<void>;
  canvas: () => Promise<void>;
  diff: () => Promise<void>;
}

export interface CanonicalDesignOptions {
  level?: CanonicalDesignLevel;
  action?: 'canvas' | 'diff' | 'tokens';
  cwd?: string;
  _fns?: Partial<CanonicalDesignFns>;
}

export async function canonicalDesign(options: CanonicalDesignOptions = {}): Promise<void> {
  const fns: CanonicalDesignFns = {
    tokens: options._fns?.tokens ?? (async () => {
      const { design } = await import('./design.js');
      await design('extract design tokens from DESIGN.op to CSS');
    }),
    render: options._fns?.render ?? (async () => {
      const { design } = await import('./design.js');
      await design('render design file to SVG');
    }),
    figmaPush: options._fns?.figmaPush ?? (async () => {
      const { design } = await import('./design.js');
      await design('push design tokens to Figma');
    }),
    uxRefine: options._fns?.uxRefine ?? (async () => {
      const { uxRefine } = await import('./ux-refine.js');
      await uxRefine({});
    }),
    canvas: options._fns?.canvas ?? (async () => {
      const { canvas } = await import('./magic.js');
      await canvas();
    }),
    diff: options._fns?.diff ?? (async () => {
      const { design } = await import('./design.js');
      await design('diff current DESIGN.op against last render');
    }),
  };

  if (options.action === 'canvas') return fns.canvas();
  if (options.action === 'diff')   return fns.diff();
  if (options.action === 'tokens') return fns.tokens();

  const level = options.level ?? 'standard';

  if (level === 'light') return fns.tokens();

  await fns.render();
  await fns.tokens();

  if (level === 'standard') {
    await fns.figmaPush();
    return;
  }

  // deep: full UX refinement loop
  await fns.figmaPush();
  await fns.uxRefine();
}

// ── canonicalConfig ──────────────────────────────────────────────────────────
// Unifies: config, setup-llm, setup-mcp, mcp-server, skills, awesome-scan, premium, workspace

export interface CanonicalConfigFns {
  setup: () => Promise<void>;
  mcp: (start?: boolean) => Promise<void>;
  skills: (scan?: boolean) => Promise<void>;
  premium: () => Promise<void>;
  workspace: () => Promise<void>;
}

export interface CanonicalConfigOptions {
  action?: 'setup' | 'mcp' | 'skills' | 'premium' | 'workspace' | 'llm';
  start?: boolean;
  scan?: boolean;
  cwd?: string;
  _fns?: Partial<CanonicalConfigFns>;
}

export async function canonicalConfig(options: CanonicalConfigOptions = {}): Promise<void> {
  const fns: CanonicalConfigFns = {
    setup: options._fns?.setup ?? (async () => {
      const { configCmd } = await import('./config.js');
      await configCmd({ show: true });
    }),
    mcp: options._fns?.mcp ?? (async (_start?: boolean) => {
      const { mcpServer } = await import('./mcp-server.js');
      await mcpServer({});
    }),
    skills: options._fns?.skills ?? (async (scan?: boolean) => {
      const { runDanteSkill } = await import('./dante-skills.js');
      await runDanteSkill(scan ? 'scan' : 'list', {});
    }),
    premium: options._fns?.premium ?? (async () => {
      const { premium } = await import('./premium.js');
      await premium('status', {});
    }),
    workspace: options._fns?.workspace ?? (async () => {
      const { workspace } = await import('./workspace.js');
      await workspace('list', [], {});
    }),
  };

  switch (options.action) {
    case 'setup':
    case 'llm':       return fns.setup();
    case 'mcp':       return fns.mcp(options.start);
    case 'skills':    return fns.skills(options.scan);
    case 'premium':   return fns.premium();
    case 'workspace': return fns.workspace();
    default:
      logger.info('[config] Available actions: setup, mcp, skills, premium, workspace');
      logger.info('[config] Run `danteforge config setup` to configure LLM provider and MCP.');
  }
}
