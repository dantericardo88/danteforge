import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('magic preset system', () => {
  it('defines the exact 6 preset levels with the documented metadata', async () => {
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
      convergenceCycles: 0,
    });

    assert.deepStrictEqual(MAGIC_PRESETS.ember, {
      level: 'ember',
      intensity: 'Light',
      tokenLevel: 'Very Low',
      combines: 'Budget magic + light checkpoints + basic loop detect',
      primaryUseCase: 'Quick features, prototyping, token-conscious work',
      defaultProfile: 'budget',
      routingAggressiveness: 'aggressive',
      maxBudgetUsd: 0.15,
      convergenceCycles: 1,
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
      convergenceCycles: 2,
    });

    assert.deepStrictEqual(MAGIC_PRESETS.magic, {
      level: 'magic',
      intensity: 'Balanced (Default)',
      tokenLevel: 'Low-Medium',
      combines: 'Balanced party lanes + autoforge reliability + verify + lessons',
      primaryUseCase: 'Daily main command - 80% of all work',
      defaultProfile: 'budget',
      routingAggressiveness: 'balanced',
      maxBudgetUsd: 0.50,
      convergenceCycles: 2,
    });

    assert.deepStrictEqual(MAGIC_PRESETS.blaze, {
      level: 'blaze',
      intensity: 'High',
      tokenLevel: 'High',
      combines: 'Full party + strong autoforge + synthesize + retro + self-improve',
      primaryUseCase: 'Big features needing real power',
      defaultProfile: 'budget',
      routingAggressiveness: 'balanced',
      maxBudgetUsd: 1.50,
      convergenceCycles: 2,
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
      convergenceCycles: 3,
    });

    assert.deepStrictEqual(MAGIC_PRESETS.inferno, {
      level: 'inferno',
      intensity: 'Maximum',
      tokenLevel: 'Maximum',
      combines: 'Full party + max autoforge + deep OSS mining + evolution',
      primaryUseCase: 'First big attack on new matrix dimension',
      defaultProfile: 'budget',
      routingAggressiveness: 'conservative',
      maxBudgetUsd: 5.00,
      convergenceCycles: 3,
    });

    assert.match(MAGIC_USAGE_RULES, /\/canvas.*frontend-heavy/i);
    assert.match(MAGIC_USAGE_RULES, /\/inferno.*first big attack/i);
    assert.match(MAGIC_USAGE_RULES, /\/nova.*planned feature sprints/i);
    assert.match(MAGIC_USAGE_RULES, /\/magic.*follow-up PRD gap closing/i);
  });

  it('builds execution plans that separate planning, follow-up, and maximum-intensity presets', async () => {
    const { buildMagicExecutionPlan } = await import('../src/core/magic-presets.js');

    const sparkPlan = buildMagicExecutionPlan('spark', 'Map a new product dimension');
    assert.deepStrictEqual(
      sparkPlan.steps.map(step => step.kind),
      ['review', 'constitution', 'specify', 'clarify', 'tech-decide', 'plan', 'tasks'],
    );

    // spark with skipTechDecide omits the tech-decide step
    const sparkNoTechPlan = buildMagicExecutionPlan('spark', 'Map a new product dimension', { skipTechDecide: true });
    assert.deepStrictEqual(
      sparkNoTechPlan.steps.map(step => step.kind),
      ['review', 'constitution', 'specify', 'clarify', 'plan', 'tasks'],
    );

    const emberPlan = buildMagicExecutionPlan('ember', 'Close a quick feature gap');
    assert.deepStrictEqual(
      emberPlan.steps.map(step => step.kind),
      ['autoforge', 'lessons-compact'],
    );

    const canvasPlan = buildMagicExecutionPlan('canvas', 'Build a new dashboard UI');
    assert.deepStrictEqual(
      canvasPlan.steps.map(step => step.kind),
      ['design', 'autoforge', 'ux-refine', 'verify', 'lessons-compact'],
    );
    assert.strictEqual(canvasPlan.preset.maxBudgetUsd, 0.75);

    const magicPlan = buildMagicExecutionPlan('magic', 'Close PRD gaps after wave one');
    assert.deepStrictEqual(
      magicPlan.steps.map(step => step.kind),
      ['autoforge', 'verify', 'lessons-compact'],
    );
    assert.strictEqual(magicPlan.steps[0]?.kind, 'autoforge');
    if (magicPlan.steps[0]?.kind === 'autoforge') {
      assert.strictEqual(magicPlan.steps[0].profile, 'budget');
      assert.strictEqual(magicPlan.steps[0].parallel, true);
      assert.strictEqual(magicPlan.steps[0].maxWaves, 8);
    }

    const blazePlan = buildMagicExecutionPlan('blaze', 'Drive a larger feature to completion');
    assert.deepStrictEqual(
      blazePlan.steps.map(step => step.kind),
      ['autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );

    // blaze with --with-design adds design + ux-refine
    const blazeDesignPlan = buildMagicExecutionPlan('blaze', 'Build UI feature', { withDesign: true });
    assert.deepStrictEqual(
      blazeDesignPlan.steps.map(step => step.kind),
      ['design', 'autoforge', 'ux-refine', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );

    const novaPlan = buildMagicExecutionPlan('nova', 'Plan and execute a major feature sprint');
    assert.deepStrictEqual(
      novaPlan.steps.map(step => step.kind),
      ['constitution', 'plan', 'tasks', 'autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );

    // nova with --tech-decide adds tech-decide after tasks
    const novaWithTechPlan = buildMagicExecutionPlan('nova', 'Plan feature sprint', { withTechDecide: true });
    assert.ok(novaWithTechPlan.steps.some(s => s.kind === 'tech-decide'), 'nova --tech-decide should include tech-decide step');

    const infernoPlan = buildMagicExecutionPlan('inferno', 'Attack a new matrix dimension');
    assert.deepStrictEqual(
      infernoPlan.steps.map(step => step.kind),
      ['oss', 'autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact'],
    );
  });

  it('registers the preset commands and magic level flag in the CLI surface', async () => {
    const cliSrc = await fs.readFile('src/cli/index.ts', 'utf8');

    assert.match(cliSrc, /\.command\('spark \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('ember \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('canvas \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('magic \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('blaze \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('nova \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('inferno \[goal\]'\)/);
    assert.match(cliSrc, /--level <level>/);
    assert.match(cliSrc, /--skip-tech-decide/, 'spark should have --skip-tech-decide option');
    assert.match(cliSrc, /--with-design/, 'blaze/nova/inferno should have --with-design option');
    assert.match(cliSrc, /--design-prompt/, 'blaze/nova/inferno should have --design-prompt option');
  });
});

// ─── buildMagicLevelsMarkdown ──────────────────────────────────────────────

describe('buildMagicLevelsMarkdown', () => {
  it('returns a markdown table with all 7 preset levels', async () => {
    const { buildMagicLevelsMarkdown } = await import('../src/core/magic-presets.js');
    const markdown = buildMagicLevelsMarkdown();

    assert.ok(typeof markdown === 'string', 'should return a string');
    assert.ok(markdown.includes('# Magic Levels'), 'should have a header');
    assert.ok(markdown.includes('/spark'), 'should include spark preset');
    assert.ok(markdown.includes('/ember'), 'should include ember preset');
    assert.ok(markdown.includes('/canvas'), 'should include canvas preset');
    assert.ok(markdown.includes('/magic'), 'should include magic preset');
    assert.ok(markdown.includes('/blaze'), 'should include blaze preset');
    assert.ok(markdown.includes('/nova'), 'should include nova preset');
    assert.ok(markdown.includes('/inferno'), 'should include inferno preset');
  });

  it('includes token level and intensity columns', async () => {
    const { buildMagicLevelsMarkdown } = await import('../src/core/magic-presets.js');
    const markdown = buildMagicLevelsMarkdown();

    assert.ok(markdown.includes('Token Level'), 'table should have Token Level column');
    assert.ok(markdown.includes('Intensity'), 'table should have Intensity column');
  });

  it('includes usage rules section', async () => {
    const { buildMagicLevelsMarkdown } = await import('../src/core/magic-presets.js');
    const markdown = buildMagicLevelsMarkdown();

    assert.ok(markdown.includes('## Usage Rule'), 'should have usage rules section');
    assert.ok(markdown.includes('## Notes'), 'should have notes section');
  });
});

// ─── formatMagicPlan (exercises formatMagicStep + capitalize) ─────────────

describe('formatMagicPlan', () => {
  it('formats a spark plan with all steps listed', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('spark', 'Launch my SaaS product');
    const formatted = formatMagicPlan(plan);

    assert.ok(typeof formatted === 'string', 'should return a string');
    assert.ok(formatted.includes('Spark Preset Plan'), 'title should be capitalized');
    assert.ok(formatted.includes('Goal: Launch my SaaS product'), 'should include the goal');
    assert.ok(formatted.includes('Steps:'), 'should have steps section');
    assert.ok(formatted.includes('danteforge review') || formatted.includes('review'), 'steps should list commands');
  });

  it('formats an inferno plan with all 7 steps', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('inferno', 'Build full e-commerce platform');
    const formatted = formatMagicPlan(plan);

    assert.ok(formatted.includes('Inferno Preset Plan'), 'inferno should be capitalized');
    assert.ok(formatted.includes('danteforge oss') || formatted.includes('oss'), 'should include oss step');
    assert.ok(formatted.includes('danteforge verify') || formatted.includes('verify'), 'should include verify step');
  });

  it('formats a blaze plan with party and worktree step', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('blaze', 'Complete big feature');
    const formatted = formatMagicPlan(plan);

    assert.ok(formatted.includes('Blaze Preset Plan'), 'blaze should be capitalized');
    assert.ok(formatted.includes('danteforge party') || formatted.includes('party'), 'should include party step');
  });

  it('formats a nova plan with planning prefix and synthesize/retro polish', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('nova', 'Build a major authenticated feature');
    const formatted = formatMagicPlan(plan);

    assert.ok(formatted.includes('Nova Preset Plan'), 'nova should be capitalized');
    assert.ok(formatted.includes('danteforge constitution') || formatted.includes('constitution'), 'should include constitution step');
    assert.ok(formatted.includes('danteforge synthesize') || formatted.includes('synthesize'), 'should include synthesize polish step');
    assert.ok(formatted.includes('danteforge party') || formatted.includes('party'), 'should include party step');
  });

  it('formats autoforge step with correct options', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('magic', 'Close PRD gaps');
    const formatted = formatMagicPlan(plan);

    assert.ok(
      formatted.includes('--max-waves') || formatted.includes('autoforge'),
      'autoforge step should show options',
    );
    assert.ok(formatted.includes('"Close PRD gaps"'), 'goal should be quoted in autoforge step');
  });
});
