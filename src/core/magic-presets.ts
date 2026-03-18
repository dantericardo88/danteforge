export type MagicLevel = 'spark' | 'ember' | 'magic' | 'blaze' | 'inferno';

export interface MagicPresetMetadata {
  level: MagicLevel;
  intensity: string;
  tokenLevel: string;
  combines: string;
  primaryUseCase: string;
  defaultProfile: 'budget';
}

export const DEFAULT_MAGIC_LEVEL: MagicLevel = 'magic';

export const MAGIC_PRESETS: Record<MagicLevel, MagicPresetMetadata> = {
  spark: {
    level: 'spark',
    intensity: 'Planning',
    tokenLevel: 'Zero',
    combines: 'review + constitution + specify + clarify + plan + tasks',
    primaryUseCase: 'Every new idea or project start',
    defaultProfile: 'budget',
  },
  ember: {
    level: 'ember',
    intensity: 'Light',
    tokenLevel: 'Very Low',
    combines: 'Budget magic + light checkpoints + basic loop detect',
    primaryUseCase: 'Quick features, prototyping, token-conscious work',
    defaultProfile: 'budget',
  },
  magic: {
    level: 'magic',
    intensity: 'Balanced (Default)',
    tokenLevel: 'Low-Medium',
    combines: 'Balanced party lanes + autoforge reliability + lessons',
    primaryUseCase: 'Daily main command - 80% of all work',
    defaultProfile: 'budget',
  },
  blaze: {
    level: 'blaze',
    intensity: 'High',
    tokenLevel: 'High',
    combines: 'Full party + strong autoforge + self-improve',
    primaryUseCase: 'Big features needing real power',
    defaultProfile: 'budget',
  },
  inferno: {
    level: 'inferno',
    intensity: 'Maximum',
    tokenLevel: 'Maximum',
    combines: 'Full party + max autoforge + deep OSS mining + evolution',
    primaryUseCase: 'First big attack on new matrix dimension',
    defaultProfile: 'budget',
  },
};

export const MAGIC_USAGE_RULES = [
  'Use /inferno for the first big attack on a new matrix dimension with fresh OSS discovery.',
  'Use /magic for all follow-up PRD gap closing.',
].join('\n');

export type MagicExecutionStep =
  | { kind: 'review' }
  | { kind: 'constitution' }
  | { kind: 'specify' }
  | { kind: 'clarify' }
  | { kind: 'plan' }
  | { kind: 'tasks' }
  | { kind: 'autoforge'; maxWaves: number; profile: string; parallel: boolean; worktree: boolean }
  | { kind: 'party'; worktree: boolean; isolation: boolean }
  | { kind: 'verify' }
  | { kind: 'synthesize' }
  | { kind: 'retro' }
  | { kind: 'lessons-compact' }
  | { kind: 'oss'; maxRepos: number };

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
  const isolation = options.isolation ?? (level === 'blaze' || level === 'inferno');
  const maxRepos = options.maxRepos ?? (level === 'inferno' ? 12 : 8);

  const steps = buildMagicSteps(level, profile, worktree, isolation, maxRepos);
  return {
    level,
    goal: resolvedGoal,
    preset,
    steps,
  };
}

function buildMagicSteps(
  level: MagicLevel,
  profile: string,
  worktree: boolean,
  isolation: boolean,
  maxRepos: number,
): MagicExecutionStep[] {
  switch (level) {
    case 'spark':
      return [
        { kind: 'review' },
        { kind: 'constitution' },
        { kind: 'specify' },
        { kind: 'clarify' },
        { kind: 'plan' },
        { kind: 'tasks' },
      ];
    case 'ember':
      return [
        { kind: 'autoforge', maxWaves: 3, profile, parallel: false, worktree: false },
        { kind: 'lessons-compact' },
      ];
    case 'magic':
      return [
        { kind: 'autoforge', maxWaves: 8, profile, parallel: true, worktree: false },
        { kind: 'lessons-compact' },
      ];
    case 'blaze':
      return [
        { kind: 'autoforge', maxWaves: 10, profile, parallel: true, worktree },
        { kind: 'party', worktree, isolation },
        { kind: 'verify' },
        { kind: 'lessons-compact' },
      ];
    case 'inferno':
      return [
        { kind: 'oss', maxRepos },
        { kind: 'autoforge', maxWaves: 12, profile, parallel: true, worktree },
        { kind: 'party', worktree, isolation: true },
        { kind: 'verify' },
        { kind: 'synthesize' },
        { kind: 'retro' },
        { kind: 'lessons-compact' },
      ];
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
    lines.push(`${i + 1}. ${formatMagicStep(plan.steps[i], plan.goal)}`);
  }

  return lines.join('\n');
}

export function buildMagicLevelsMarkdown(): string {
  const rows = Object.values(MAGIC_PRESETS)
    .map(preset => `| /${preset.level} | ${preset.intensity} | ${preset.tokenLevel} | ${preset.combines} | ${preset.primaryUseCase} |`)
    .join('\n');

  return [
    '# Magic Levels',
    '',
    'Token-Optimized Magic Preset System v0.8.1',
    '',
    '| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    '## Usage Rule',
    '',
    '- First-time new matrix dimension + fresh OSS discovery -> /inferno',
    '- All follow-up PRD gap closing -> /magic',
    '',
    '## Notes',
    '',
    '- /magic remains the default balanced preset and the hero command.',
    '- All preset execution paths default to the budget profile unless you override --profile.',
    '- /spark is planning-only and stays local-first.',
    '- /blaze and /inferno add full party orchestration on top of autoforge reliability.',
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
    case 'specify':
      return `danteforge specify "${goal}"`;
    case 'autoforge':
      return `danteforge autoforge "${goal}" --max-waves ${step.maxWaves} --profile ${step.profile}${step.parallel ? ' --parallel' : ''}${step.worktree ? ' --worktree' : ''}`;
    case 'party':
      return `danteforge party${step.worktree ? ' --worktree' : ''}${step.isolation ? ' --isolation' : ''}`;
    case 'lessons-compact':
      return 'danteforge lessons --compact';
    case 'oss':
      return `danteforge oss --max-repos ${step.maxRepos}`;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
