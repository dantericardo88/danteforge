export type MagicLevel = 'spark' | 'ember' | 'canvas' | 'magic' | 'blaze' | 'nova' | 'inferno';

export type HarvestDepth = 'shallow' | 'medium' | 'full';

export type RoutingAggressiveness = 'conservative' | 'balanced' | 'aggressive';

export interface MagicPresetMetadata {
  level: MagicLevel;
  intensity: string;
  tokenLevel: string;
  combines: string;
  primaryUseCase: string;
  defaultProfile: 'budget';
  routingAggressiveness: RoutingAggressiveness;
  maxBudgetUsd: number;
  autoforgeWaves: number; // How many waves per autoforge step (used in convergence cycles)
  convergenceCycles: number;
  targetMaturityLevel: 1 | 2 | 3 | 4 | 5 | 6;
}

export const DEFAULT_MAGIC_LEVEL: MagicLevel = 'magic';

export const MAGIC_PRESETS: Record<MagicLevel, MagicPresetMetadata> = {
  spark: {
    level: 'spark',
    intensity: 'Planning',
    tokenLevel: 'Zero',
    combines: 'review + constitution + specify + clarify + tech-decide + plan + tasks',
    primaryUseCase: 'Every new idea or project start',
    defaultProfile: 'budget',
    routingAggressiveness: 'aggressive',
    maxBudgetUsd: 0.05,
    autoforgeWaves: 3, // Light planning pass
    convergenceCycles: 0,
    targetMaturityLevel: 1, // Sketch: proves the idea works
  },
  ember: {
    level: 'ember',
    intensity: 'Light',
    tokenLevel: 'Very Low',
    combines: 'Budget magic + light checkpoints + basic loop detect',
    primaryUseCase: 'Quick features, prototyping, token-conscious work',
    defaultProfile: 'budget',
    routingAggressiveness: 'aggressive',
    maxBudgetUsd: 0.15,
    autoforgeWaves: 5, // Light execution
    convergenceCycles: 1,
    targetMaturityLevel: 2, // Prototype: investor-ready
  },
  canvas: {
    level: 'canvas',
    intensity: 'Design-First',
    tokenLevel: 'Low-Medium',
    combines: 'Design generation + autoforge + UX token extraction + verify',
    primaryUseCase: 'Frontend-heavy features where visual design drives implementation',
    defaultProfile: 'budget',
    routingAggressiveness: 'balanced',
    maxBudgetUsd: 0.75,
    autoforgeWaves: 6, // Design-driven implementation
    convergenceCycles: 2,
    targetMaturityLevel: 3, // Alpha: internal team use
  },
  magic: {
    level: 'magic',
    intensity: 'Balanced (Default)',
    tokenLevel: 'Low-Medium',
    combines: 'Balanced party lanes + autoforge reliability + verify + lessons',
    primaryUseCase: 'Daily main command - 80% of all work',
    defaultProfile: 'budget',
    routingAggressiveness: 'balanced',
    maxBudgetUsd: 0.50,
    autoforgeWaves: 8, // Balanced execution
    convergenceCycles: 2,
    targetMaturityLevel: 4, // Beta: paid beta customers
  },
  blaze: {
    level: 'blaze',
    intensity: 'High',
    tokenLevel: 'High',
    combines: 'Full party + strong autoforge + synthesize + retro + self-improve',
    primaryUseCase: 'Big features needing real power',
    defaultProfile: 'budget',
    routingAggressiveness: 'balanced',
    maxBudgetUsd: 1.50,
    autoforgeWaves: 10, // Full power
    convergenceCycles: 2,
    targetMaturityLevel: 5, // Customer-Ready: production launch
  },
  nova: {
    level: 'nova',
    intensity: 'Very High',
    tokenLevel: 'High-Max',
    combines: 'Planning prefix + blaze execution + inferno polish (no OSS)',
    primaryUseCase: 'Feature sprints that need planning + deep execution without OSS overhead',
    defaultProfile: 'budget',
    routingAggressiveness: 'balanced',
    maxBudgetUsd: 3.00,
    autoforgeWaves: 10, // Full nova power
    convergenceCycles: 3,
    targetMaturityLevel: 6, // Enterprise-Grade: Fortune 500
  },
  inferno: {
    level: 'inferno',
    intensity: 'Maximum',
    tokenLevel: 'Maximum',
    combines: 'Full party + max autoforge + deep OSS mining + evolution',
    primaryUseCase: 'First big attack on new matrix dimension',
    defaultProfile: 'budget',
    routingAggressiveness: 'conservative',
    maxBudgetUsd: 5.00,
    autoforgeWaves: 15, // Maximum firepower
    convergenceCycles: 3,
    targetMaturityLevel: 6, // Enterprise-Grade: Fortune 500
  },
};

export const MAGIC_USAGE_RULES = [
  'Use /canvas for frontend-heavy features where visual design should drive implementation.',
  'Use /inferno for the first big attack on a new matrix dimension with fresh OSS discovery.',
  'Use /nova for planned feature sprints that need deep execution but not OSS discovery.',
  'Use /magic for all follow-up PRD gap closing.',
].join('\n');

export type MagicExecutionStep =
  | { kind: 'review' }
  | { kind: 'constitution' }
  | { kind: 'specify' }
  | { kind: 'clarify' }
  | { kind: 'tech-decide' }
  | { kind: 'plan' }
  | { kind: 'tasks' }
  | { kind: 'design'; designPrompt?: string }
  | { kind: 'autoforge'; maxWaves: number; profile: string; parallel: boolean; worktree: boolean }
  | { kind: 'ux-refine'; openpencil: boolean }
  | { kind: 'party'; worktree: boolean; isolation: boolean }
  | { kind: 'verify' }
  | { kind: 'synthesize' }
  | { kind: 'retro' }
  | { kind: 'lessons-compact' }
  | { kind: 'oss'; maxRepos: number }
  | { kind: 'local-harvest'; sources: string[]; depth: HarvestDepth; configPath?: string };

export interface MagicExecutionPlan {
  level: MagicLevel;
  goal: string;
  preset: MagicPresetMetadata;
  steps: MagicExecutionStep[];
}

export interface BuildMagicExecutionPlanOptions {
  profile?: string;
  maxRepos?: number;
  worktree?: boolean;
  isolation?: boolean;
  localSources?: string[];
  localDepth?: HarvestDepth;
  localSourcesConfig?: string;
  skipTechDecide?: boolean;
  withTechDecide?: boolean;
  withDesign?: boolean;
  designPrompt?: string;
}

export function normalizeMagicLevel(value?: string): MagicLevel {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_MAGIC_LEVEL;
  if (normalized in MAGIC_PRESETS) {
    return normalized as MagicLevel;
  }
  throw new Error(`Unknown magic level: ${value}. Valid levels: ${Object.keys(MAGIC_PRESETS).join(', ')}`);
}

export function buildMagicExecutionPlan(
  level: MagicLevel,
  goal?: string,
  options: BuildMagicExecutionPlanOptions = {},
): MagicExecutionPlan {
  const preset = MAGIC_PRESETS[level];
  const resolvedGoal = goal?.trim() || 'Advance the current project';
  const profile = options.profile ?? preset.defaultProfile;
  const worktree = options.worktree ?? false;
  const isolation = options.isolation ?? (level === 'blaze' || level === 'nova' || level === 'inferno');
  const maxRepos = options.maxRepos ?? (level === 'inferno' ? 12 : 8);

  const steps = buildMagicSteps(level, profile, worktree, isolation, maxRepos, options);
  return {
    level,
    goal: resolvedGoal,
    preset,
    steps,
  };
}

function buildBlazeSteps(
  profile: string, worktree: boolean, isolation: boolean,
  designStep: MagicExecutionStep, uxRefineStep: MagicExecutionStep,
  withDesign?: boolean,
): MagicExecutionStep[] {
  const steps: MagicExecutionStep[] = [];
  if (withDesign) steps.push(designStep);
  steps.push({ kind: 'autoforge', maxWaves: 10, profile, parallel: true, worktree });
  if (withDesign) steps.push(uxRefineStep);
  steps.push({ kind: 'party', worktree, isolation }, { kind: 'verify' }, { kind: 'synthesize' }, { kind: 'retro' }, { kind: 'lessons-compact' });
  return steps;
}

function buildNovaSteps(
  profile: string, worktree: boolean, isolation: boolean,
  designStep: MagicExecutionStep, uxRefineStep: MagicExecutionStep,
  withTechDecide?: boolean, withDesign?: boolean,
): MagicExecutionStep[] {
  const steps: MagicExecutionStep[] = [{ kind: 'constitution' }, { kind: 'plan' }, { kind: 'tasks' }];
  if (withTechDecide) steps.push({ kind: 'tech-decide' });
  if (withDesign) steps.push(designStep);
  steps.push({ kind: 'autoforge', maxWaves: 10, profile, parallel: true, worktree });
  if (withDesign) steps.push(uxRefineStep);
  steps.push({ kind: 'party', worktree, isolation }, { kind: 'verify' }, { kind: 'synthesize' }, { kind: 'retro' }, { kind: 'lessons-compact' });
  return steps;
}

function buildInfernoSteps(
  profile: string, worktree: boolean, maxRepos: number,
  designStep: MagicExecutionStep, uxRefineStep: MagicExecutionStep,
  options: BuildMagicExecutionPlanOptions,
): MagicExecutionStep[] {
  const steps: MagicExecutionStep[] = [];
  if (options.localSources?.length || options.localSourcesConfig) {
    steps.push({ kind: 'local-harvest', sources: options.localSources ?? [], depth: options.localDepth ?? 'medium', configPath: options.localSourcesConfig });
  }
  steps.push({ kind: 'oss', maxRepos });
  if (options.withDesign) steps.push(designStep);
  steps.push({ kind: 'autoforge', maxWaves: 12, profile, parallel: true, worktree });
  if (options.withDesign) steps.push(uxRefineStep);
  steps.push({ kind: 'party', worktree, isolation: true }, { kind: 'verify' }, { kind: 'synthesize' }, { kind: 'retro' }, { kind: 'lessons-compact' });
  return steps;
}

function buildMagicSteps(
  level: MagicLevel,
  profile: string,
  worktree: boolean,
  isolation: boolean,
  maxRepos: number,
  options: BuildMagicExecutionPlanOptions = {},
): MagicExecutionStep[] {
  const designStep: MagicExecutionStep = { kind: 'design', designPrompt: options.designPrompt };
  const uxRefineStep: MagicExecutionStep = { kind: 'ux-refine', openpencil: true };

  switch (level) {
    case 'spark': {
      const steps: MagicExecutionStep[] = [
        { kind: 'review' }, { kind: 'constitution' }, { kind: 'specify' }, { kind: 'clarify' },
      ];
      if (!options.skipTechDecide) steps.push({ kind: 'tech-decide' });
      steps.push({ kind: 'plan' }, { kind: 'tasks' });
      return steps;
    }
    case 'ember':
      return [{ kind: 'autoforge', maxWaves: 3, profile, parallel: false, worktree: false }, { kind: 'lessons-compact' }];
    case 'canvas':
      return [
        { kind: 'design', designPrompt: options.designPrompt },
        { kind: 'autoforge', maxWaves: 6, profile, parallel: true, worktree: false },
        { kind: 'ux-refine', openpencil: true }, { kind: 'verify' }, { kind: 'lessons-compact' },
      ];
    case 'magic':
      return [{ kind: 'autoforge', maxWaves: 8, profile, parallel: true, worktree: false }, { kind: 'verify' }, { kind: 'lessons-compact' }];
    case 'blaze':
      return buildBlazeSteps(profile, worktree, isolation, designStep, uxRefineStep, options.withDesign);
    case 'nova':
      return buildNovaSteps(profile, worktree, isolation, designStep, uxRefineStep, options.withTechDecide, options.withDesign);
    case 'inferno':
      return buildInfernoSteps(profile, worktree, maxRepos, designStep, uxRefineStep, options);
  }
}

export function formatMagicPlan(plan: MagicExecutionPlan): string {
  const lines: string[] = [
    `# ${capitalize(plan.level)} Preset Plan`,
    '',
    `Goal: ${plan.goal}`,
    `Intensity: ${plan.preset.intensity}`,
    `Token Level: ${plan.preset.tokenLevel}`,
    `Combines: ${plan.preset.combines}`,
    '',
    'Usage Rule:',
    MAGIC_USAGE_RULES,
    '',
    'Steps:',
  ];

  for (let i = 0; i < plan.steps.length; i++) {
    lines.push(`${i + 1}. ${formatMagicStep(plan.steps[i]!, plan.goal)}`);
  }

  const cycles = plan.preset.convergenceCycles;
  lines.push('');
  if (cycles === 0) {
    lines.push('Convergence: disabled (planning-only preset)');
  } else {
    lines.push(`Convergence: up to ${cycles} cycle${cycles === 1 ? '' : 's'} of (autoforge → verify) after pipeline if verify fails`);
  }

  return lines.join('\n');
}

export function buildMagicLevelsMarkdown(): string {
  const rows = Object.values(MAGIC_PRESETS)
    .map((preset) => `| /${preset.level} | ${preset.intensity} | ${preset.tokenLevel} | ${preset.combines} | ${preset.primaryUseCase} |`)
    .join('\n');

  return [
    '# Magic Levels',
    '',
    'Token-Optimized Magic Preset System',
    '',
    '| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    '## Usage Rule',
    '',
    '- /canvas for frontend-heavy features where visual design drives implementation.',
    '- First-time new matrix dimension + fresh OSS discovery -> /inferno',
    '- All follow-up PRD gap closing -> /magic',
    '',
    '## Notes',
    '',
    '- /magic remains the default balanced preset and the hero command.',
    '- All preset execution paths default to the budget profile unless you override --profile.',
    '- /spark is planning-only with tech-decide (use --skip-tech-decide to bypass).',
    '- /canvas is design-first: generates DESIGN.op, autoforges from it, and extracts tokens.',
    '- /blaze, /nova, and /inferno add full party orchestration on top of autoforge reliability.',
    '- /nova adds a planning prefix (constitution + plan + tasks) without OSS.',
    '- Add --with-design to /blaze, /nova, or /inferno to include design + ux-refine steps.',
  ].join('\n') + '\n';
}

function formatMagicStep(step: MagicExecutionStep, goal: string): string {
  switch (step.kind) {
    case 'review':
    case 'constitution':
    case 'clarify':
    case 'plan':
    case 'tasks':
    case 'verify':
    case 'synthesize':
    case 'retro':
      return `danteforge ${step.kind}`;
    case 'tech-decide':
      return 'danteforge tech-decide --auto';
    case 'specify':
      return `danteforge specify "${goal}"`;
    case 'design':
      return step.designPrompt
        ? `danteforge design "${step.designPrompt}"`
        : `danteforge design "${goal}"`;
    case 'ux-refine':
      return step.openpencil ? 'danteforge ux-refine --openpencil' : 'danteforge ux-refine';
    case 'autoforge':
      return `danteforge autoforge "${goal}" --max-waves ${step.maxWaves} --profile ${step.profile}${step.parallel ? ' --parallel' : ''}${step.worktree ? ' --worktree' : ''}`;
    case 'party':
      return `danteforge party${step.worktree ? ' --worktree' : ''}${step.isolation ? ' --isolation' : ''}`;
    case 'lessons-compact':
      return 'danteforge lessons --compact';
    case 'oss':
      return `danteforge oss --max-repos ${step.maxRepos}`;
    case 'local-harvest': {
      const sourcesArg = step.sources.length > 0
        ? ` ${step.sources.join(' ')}`
        : step.configPath ? ` --config ${step.configPath}` : '';
      return `danteforge local-harvest${sourcesArg} --depth ${step.depth}`;
    }
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
