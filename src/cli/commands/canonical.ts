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
  techDecide: () => Promise<void>;
  tasks: () => Promise<void>;
}

export interface CanonicalPlanOptions {
  level?: string;
  prompt?: boolean;
  light?: boolean;
  _fns?: Partial<CanonicalPlanFns>;
}

export async function canonicalPlan(goal?: string, options: CanonicalPlanOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[plan --level ${level}]${goal ? ` goal: "${goal}"` : ''}`);

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
    techDecide: options._fns?.techDecide ?? (async () => {
      const { techDecide } = await import('./tech-decide.js');
      await techDecide({ prompt: options.prompt });
    }),
    tasks: options._fns?.tasks ?? (async () => {
      const { tasks } = await import('./tasks.js');
      await tasks({ prompt: options.prompt });
    }),
  };

  if (level === 'light') {
    if (goal) {
      await fns.specify(goal);
    } else {
      await fns.review();
    }
    return;
  }

  // standard and deep: constitution + specify + clarify + plan
  await fns.constitution();
  if (goal) await fns.specify(goal);
  await fns.clarify();
  await fns.plan();

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
  _fns?: Partial<CanonicalBuildFns>;
}

export async function canonicalBuild(goal?: string, options: CanonicalBuildOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[build --level ${level}]${goal ? ` goal: "${goal}"` : ''}`);

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
      const { inferno } = await import('./inferno.js');
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
  };

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
}

export interface CanonicalCompeteOptions {
  level?: string;
  json?: boolean;
  refresh?: boolean;
  yes?: boolean;
  _fns?: Partial<CanonicalCompeteFns>;
}

export async function canonicalCompete(options: CanonicalCompeteOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[compete --level ${level}]`);

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
  };

  if (level === 'light') {
    await fns.assess();
    return;
  }
  if (level === 'standard') {
    await fns.assess();
    await fns.universe();
    return;
  }
  // deep: full CHL auto loop
  await fns.compete();
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
  };

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
