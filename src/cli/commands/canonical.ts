// canonical.ts — Five canonical process dispatchers with --level light|standard|deep
//
// Phase 1 of COMMAND-SURFACE-REDESIGN.md:
//   plan, build, measure, compete, harvest
//   each supporting --level light | standard | deep
//
// All existing commands remain untouched. These dispatchers route to them.

import { logger } from '../../core/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CanonicalLevel = 'light' | 'standard' | 'deep';

function resolveLevel(raw?: string, fallback: CanonicalLevel = 'standard'): CanonicalLevel {
  const normalized = raw?.toLowerCase();
  if (normalized === 'light' || normalized === 'standard' || normalized === 'deep') return normalized;
  if (raw) logger.warn(`Unknown --level "${raw}" — defaulting to "${fallback}"`);
  return fallback;
}

// ── 1. plan ────────────────────────────────────────────────────────────────────
//
//   light    → review (repo grounding) + specify
//   standard → constitution + specify + clarify + plan
//   deep     → standard + tech-decide + tasks + critique

export interface CanonicalPlanOptions {
  level?: string;
  prompt?: boolean;
  light?: boolean;
}

export async function canonicalPlan(goal?: string, options: CanonicalPlanOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[plan --level ${level}]${goal ? ` goal: "${goal}"` : ''}`);

  if (level === 'light') {
    if (goal) {
      const { specify } = await import('./specify.js');
      await specify(goal, { prompt: options.prompt, light: true });
    } else {
      const { review } = await import('./review.js');
      await review({ prompt: options.prompt });
    }
    return;
  }

  // standard and deep both start with constitution + specify + clarify + plan
  const { constitution } = await import('./constitution.js');
  await constitution();

  if (goal) {
    const { specify } = await import('./specify.js');
    await specify(goal, { prompt: options.prompt, light: level === 'standard' });
  }

  const { clarify } = await import('./clarify.js');
  await clarify({ prompt: options.prompt, light: true });

  const { plan } = await import('./plan.js');
  await plan({ prompt: options.prompt, light: level === 'standard' });

  if (level === 'deep') {
    const { techDecide } = await import('./tech-decide.js');
    await techDecide({ prompt: options.prompt });

    const { tasks } = await import('./tasks.js');
    await tasks({ prompt: options.prompt });
  }
}

// ── 2. build ───────────────────────────────────────────────────────────────────
//
//   light    → single forge wave
//   standard → magic-style balanced execution
//   deep     → inferno-style with OSS harvest

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
}

export async function canonicalBuild(goal?: string, options: CanonicalBuildOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[build --level ${level}]${goal ? ` goal: "${goal}"` : ''}`);

  switch (level) {
    case 'light': {
      const { forge } = await import('./forge.js');
      await forge('1', {
        prompt: options.prompt,
        profile: options.profile ?? 'balanced',
        light: true,
        worktree: options.worktree,
      });
      break;
    }
    case 'standard': {
      const { magic } = await import('./magic.js');
      await magic(goal, {
        level: 'magic',
        profile: options.profile ?? 'balanced',
        prompt: options.prompt,
        worktree: options.worktree,
        isolation: options.isolation,
        yes: options.yes,
      });
      break;
    }
    case 'deep': {
      const { inferno } = await import('./inferno.js');
      await inferno(goal, {
        profile: options.profile ?? 'balanced',
        prompt: options.prompt,
        worktree: options.worktree,
        isolation: options.isolation,
        maxRepos: options.maxRepos ?? 12,
        withDesign: options.withDesign,
        designPrompt: options.designPrompt,
        yes: options.yes,
      });
      break;
    }
  }
}

// ── 3. measure ─────────────────────────────────────────────────────────────────
//
//   light    → quick score (fast daily honesty check)
//   standard → score --full + maturity + proof delta
//   deep     → verify + score --full --strict --adversary + convergence proof

export interface CanonicalMeasureOptions {
  level?: string;
  full?: boolean;
  strict?: boolean;
  adversary?: boolean;
  json?: boolean;
}

export async function canonicalMeasure(options: CanonicalMeasureOptions = {}): Promise<void> {
  const level = resolveLevel(options.level, 'light');
  logger.info(`[measure --level ${level}]`);

  if (level === 'light') {
    const { score } = await import('./score.js');
    await score({ full: options.full, strict: options.strict });
    return;
  }

  if (level === 'standard') {
    const { score } = await import('./score.js');
    await score({ full: true, strict: options.strict });
    const { maturity } = await import('./maturity.js');
    await maturity({ json: options.json });
    try {
      const { proof } = await import('./proof.js');
      await proof({ pipeline: true });
    } catch { /* best-effort */ }
    return;
  }

  // deep: verify + adversarial score + convergence proof
  try {
    const { verify } = await import('./verify.js');
    await verify();
  } catch { /* continue even if verify fails */ }

  const { score } = await import('./score.js');
  await score({ full: true, strict: true, adversary: options.adversary ?? true });

  try {
    const { proof } = await import('./proof.js');
    await proof({ pipeline: true, convergence: true });
  } catch { /* best-effort */ }
}

// ── 4. compete ─────────────────────────────────────────────────────────────────
//
//   light    → harsh self-assessment + current gap table
//   standard → assess + universe refresh + ranked gap map
//   deep     → full Competitive Harvest Loop (auto sprint cycle)

export interface CanonicalCompeteOptions {
  level?: string;
  json?: boolean;
  refresh?: boolean;
  yes?: boolean;
}

export async function canonicalCompete(options: CanonicalCompeteOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[compete --level ${level}]`);

  if (level === 'light') {
    const { assess } = await import('./assess.js');
    await assess({ harsh: true, json: options.json });
    return;
  }

  if (level === 'standard') {
    const { assess } = await import('./assess.js');
    await assess({ harsh: true, json: options.json });
    const { universe } = await import('./universe.js');
    await universe({ refresh: options.refresh ?? true, json: options.json });
    return;
  }

  // deep: full CHL auto loop
  const { compete } = await import('./compete.js');
  await compete({ auto: true, yes: options.yes });
}

// ── 5. harvest ─────────────────────────────────────────────────────────────────
//
//   light    → focused harvest-pattern or harvest --lite
//   standard → bounded OSS or local-harvest pass
//   deep     → OSS + local-harvest + universe refresh

export interface CanonicalHarvestOptions {
  level?: string;
  source?: string;
  maxRepos?: number;
  prompt?: boolean;
  refresh?: boolean;
  depth?: string;
}

export async function canonicalHarvest(goal?: string, options: CanonicalHarvestOptions = {}): Promise<void> {
  const level = resolveLevel(options.level);
  logger.info(`[harvest --level ${level}]${goal ? ` goal: "${goal}"` : ''}`);

  if (level === 'light') {
    if (goal) {
      const { harvestPattern } = await import('./harvest-pattern.js');
      await harvestPattern({ pattern: goal, maxRepos: options.maxRepos ?? 5 });
    } else {
      const { harvest } = await import('./harvest.js');
      await harvest('', { lite: true, prompt: options.prompt });
    }
    return;
  }

  if (level === 'standard') {
    const source = options.source ?? 'oss';
    if (source === 'local') {
      const { localHarvest } = await import('./local-harvest.js');
      await localHarvest([], { depth: options.depth ?? 'medium', prompt: options.prompt });
    } else {
      const { ossResearcher } = await import('./oss.js');
      await ossResearcher({ maxRepos: String(options.maxRepos ?? 8), prompt: options.prompt });
    }
    return;
  }

  // deep: OSS + optionally local + universe refresh
  const { ossResearcher } = await import('./oss.js');
  await ossResearcher({ maxRepos: String(options.maxRepos ?? 12), prompt: options.prompt });

  const source = options.source ?? 'oss';
  if (source === 'local' || source === 'mixed') {
    const { localHarvest } = await import('./local-harvest.js');
    await localHarvest([], { depth: options.depth ?? 'full', prompt: options.prompt });
  }

  try {
    const { universe } = await import('./universe.js');
    await universe({ refresh: true });
  } catch { /* best-effort */ }
}
