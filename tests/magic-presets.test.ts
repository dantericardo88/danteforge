import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('magic preset system', () => {
  it('defines the exact preset levels with the documented metadata', async () => {
    const {
      MAGIC_PRESETS,
      DEFAULT_MAGIC_LEVEL,
      MAGIC_USAGE_RULES,
    } = await import('../src/core/magic-presets.js');

    assert.strictEqual(DEFAULT_MAGIC_LEVEL, 'magic');
    assert.deepStrictEqual(
      Object.keys(MAGIC_PRESETS),
      ['spark', 'ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno'],
    );

    assert.deepStrictEqual(MAGIC_PRESETS.spark, {
      level: 'spark',
      intensity: 'Planning',
      tokenLevel: 'Zero',
      combines: 'review + constitution + specify + clarify + tech-decide + plan + tasks',
      primaryUseCase: 'Every new idea or project start',
      defaultProfile: 'budget',
      routingAggressiveness: 'aggressive',
      maxBudgetUsd: 0.05,
      autoforgeWaves: 3,
      convergenceCycles: 0,
      targetMaturityLevel: 1,
    });

    assert.deepStrictEqual(MAGIC_PRESETS.canvas, {
      level: 'canvas',
      intensity: 'Design-First',
      tokenLevel: 'Low-Medium',
      combines: 'Design generation + autoforge + UX token extraction + verify',
      primaryUseCase: 'Frontend-heavy features where visual design drives implementation',
      defaultProfile: 'budget',
      routingAggressiveness: 'balanced',
      maxBudgetUsd: 0.75,
      autoforgeWaves: 6,
      convergenceCycles: 2,
      targetMaturityLevel: 3,
    });

    assert.deepStrictEqual(MAGIC_PRESETS.nova, {
      level: 'nova',
      intensity: 'Very High',
      tokenLevel: 'High-Max',
      combines: 'Planning prefix + blaze execution + inferno polish (no OSS)',
      primaryUseCase: 'Feature sprints that need planning + deep execution without OSS overhead',
      defaultProfile: 'budget',
      routingAggressiveness: 'balanced',
      maxBudgetUsd: 3.00,
      autoforgeWaves: 10,
      convergenceCycles: 3,
      targetMaturityLevel: 6,
    });

    assert.match(MAGIC_USAGE_RULES, /\/canvas.*frontend-heavy/i);
    assert.match(MAGIC_USAGE_RULES, /\/inferno.*first big attack/i);
    assert.match(MAGIC_USAGE_RULES, /\/nova.*planned feature sprints/i);
    assert.match(MAGIC_USAGE_RULES, /\/magic.*follow-up PRD gap closing/i);
  });

  it('builds execution plans that separate planning, design-first, and high-intensity presets', async () => {
    const { buildMagicExecutionPlan } = await import('../src/core/magic-presets.js');

    const sparkPlan = buildMagicExecutionPlan('spark', 'Map a new product dimension');
    assert.deepStrictEqual(
      sparkPlan.steps.map((step) => step.kind),
      ['review', 'constitution', 'specify', 'clarify', 'tech-decide', 'plan', 'tasks'],
    );

    const sparkNoTechPlan = buildMagicExecutionPlan('spark', 'Map a new product dimension', { skipTechDecide: true });
    assert.deepStrictEqual(
      sparkNoTechPlan.steps.map((step) => step.kind),
      ['review', 'constitution', 'specify', 'clarify', 'plan', 'tasks'],
    );

    const canvasPlan = buildMagicExecutionPlan('canvas', 'Build a new dashboard UI');
    assert.deepStrictEqual(
      canvasPlan.steps.map((step) => step.kind),
      ['design', 'autoforge', 'ux-refine', 'verify', 'lessons-compact'],
    );

    const magicPlan = buildMagicExecutionPlan('magic', 'Close PRD gaps after wave one');
    assert.deepStrictEqual(
      magicPlan.steps.map((step) => step.kind),
      ['autoforge', 'verify', 'lessons-compact'],
    );

    const blazeDesignPlan = buildMagicExecutionPlan('blaze', 'Build UI feature', { withDesign: true });
    assert.deepStrictEqual(
      blazeDesignPlan.steps.map((step) => step.kind),
      ['design', 'autoforge', 'ux-refine', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );

    const novaPlan = buildMagicExecutionPlan('nova', 'Plan and execute a major feature sprint');
    assert.deepStrictEqual(
      novaPlan.steps.map((step) => step.kind),
      ['constitution', 'plan', 'tasks', 'autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );

    const infernoPlan = buildMagicExecutionPlan('inferno', 'Attack a new matrix dimension', {
      localSources: ['./proj-a'],
      localDepth: 'medium',
    });
    assert.deepStrictEqual(
      infernoPlan.steps.map((step) => step.kind),
      ['local-harvest', 'oss', 'autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );
  });

  it('registers the magic command and level flags in the CLI surface', async () => {
    const cliSrc = await fs.readFile('src/cli/index.ts', 'utf8');

    // magic is the canonical build command — spark/ember/blaze/nova/inferno are
    // preset functions in magic.js but no longer separate top-level CLI commands
    assert.match(cliSrc, /\.command\('magic \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('canvas \[goal\]'\)/);
    assert.match(cliSrc, /--skip-tech-decide/);
    assert.match(cliSrc, /--with-design/);
    assert.match(cliSrc, /--local-sources/);
  });
});

describe('buildMagicLevelsMarkdown', () => {
  it('returns a markdown table with all preset levels', async () => {
    const { buildMagicLevelsMarkdown } = await import('../src/core/magic-presets.js');
    const markdown = buildMagicLevelsMarkdown();

    assert.ok(markdown.includes('# Magic Levels'));
    assert.ok(markdown.includes('/spark'));
    assert.ok(markdown.includes('/ember'));
    assert.ok(markdown.includes('/canvas'));
    assert.ok(markdown.includes('/magic'));
    assert.ok(markdown.includes('/blaze'));
    assert.ok(markdown.includes('/nova'));
    assert.ok(markdown.includes('/inferno'));
  });

  it('includes token level and intensity columns', async () => {
    const { buildMagicLevelsMarkdown } = await import('../src/core/magic-presets.js');
    const markdown = buildMagicLevelsMarkdown();

    assert.ok(markdown.includes('Token Level'));
    assert.ok(markdown.includes('Intensity'));
    assert.ok(markdown.includes('## Usage Rule'));
    assert.ok(markdown.includes('## Notes'));
  });
});

describe('formatMagicPlan', () => {
  it('formats a spark plan with all steps listed', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('spark', 'Launch my SaaS product');
    const formatted = formatMagicPlan(plan);

    assert.ok(formatted.includes('Spark Preset Plan'));
    assert.ok(formatted.includes('Goal: Launch my SaaS product'));
    assert.ok(formatted.includes('danteforge review'));
  });

  it('formats a nova plan with planning prefix and polish steps', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('nova', 'Build a major authenticated feature');
    const formatted = formatMagicPlan(plan);

    assert.ok(formatted.includes('Nova Preset Plan'));
    assert.ok(formatted.includes('danteforge constitution'));
    assert.ok(formatted.includes('danteforge synthesize'));
    assert.ok(formatted.includes('danteforge party'));
  });
});
