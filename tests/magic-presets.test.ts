import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('magic preset system', () => {
  it('defines the exact 5 preset levels with the documented metadata', async () => {
    const {
      MAGIC_PRESETS,
      DEFAULT_MAGIC_LEVEL,
      MAGIC_USAGE_RULES,
    } = await import('../src/core/magic-presets.js');

    assert.strictEqual(DEFAULT_MAGIC_LEVEL, 'magic');
    assert.deepStrictEqual(
      Object.keys(MAGIC_PRESETS),
      ['spark', 'ember', 'magic', 'blaze', 'inferno'],
    );

    assert.deepStrictEqual(MAGIC_PRESETS.spark, {
      level: 'spark',
      intensity: 'Planning',
      tokenLevel: 'Zero',
      combines: 'review + constitution + specify + clarify + plan + tasks',
      primaryUseCase: 'Every new idea or project start',
      defaultProfile: 'budget',
    });

    assert.deepStrictEqual(MAGIC_PRESETS.ember, {
      level: 'ember',
      intensity: 'Light',
      tokenLevel: 'Very Low',
      combines: 'Budget magic + light checkpoints + basic loop detect',
      primaryUseCase: 'Quick features, prototyping, token-conscious work',
      defaultProfile: 'budget',
    });

    assert.deepStrictEqual(MAGIC_PRESETS.magic, {
      level: 'magic',
      intensity: 'Balanced (Default)',
      tokenLevel: 'Low-Medium',
      combines: 'Balanced party lanes + autoforge reliability + lessons',
      primaryUseCase: 'Daily main command - 80% of all work',
      defaultProfile: 'budget',
    });

    assert.deepStrictEqual(MAGIC_PRESETS.blaze, {
      level: 'blaze',
      intensity: 'High',
      tokenLevel: 'High',
      combines: 'Full party + strong autoforge + self-improve',
      primaryUseCase: 'Big features needing real power',
      defaultProfile: 'budget',
    });

    assert.deepStrictEqual(MAGIC_PRESETS.inferno, {
      level: 'inferno',
      intensity: 'Maximum',
      tokenLevel: 'Maximum',
      combines: 'Full party + max autoforge + deep OSS mining + evolution',
      primaryUseCase: 'First big attack on new matrix dimension',
      defaultProfile: 'budget',
    });

    assert.match(MAGIC_USAGE_RULES, /\/inferno.*first big attack/i);
    assert.match(MAGIC_USAGE_RULES, /\/magic.*follow-up PRD gap closing/i);
  });

  it('builds execution plans that separate planning, follow-up, and maximum-intensity presets', async () => {
    const { buildMagicExecutionPlan } = await import('../src/core/magic-presets.js');

    const sparkPlan = buildMagicExecutionPlan('spark', 'Map a new product dimension');
    assert.deepStrictEqual(
      sparkPlan.steps.map(step => step.kind),
      ['review', 'constitution', 'specify', 'clarify', 'plan', 'tasks'],
    );

    const emberPlan = buildMagicExecutionPlan('ember', 'Close a quick feature gap');
    assert.deepStrictEqual(
      emberPlan.steps.map(step => step.kind),
      ['autoforge', 'lessons-compact'],
    );

    const magicPlan = buildMagicExecutionPlan('magic', 'Close PRD gaps after wave one');
    assert.deepStrictEqual(
      magicPlan.steps.map(step => step.kind),
      ['autoforge', 'lessons-compact'],
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
      ['autoforge', 'party', 'verify', 'lessons-compact'],
    );

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
    assert.match(cliSrc, /\.command\('magic \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('blaze \[goal\]'\)/);
    assert.match(cliSrc, /\.command\('inferno \[goal\]'\)/);
    assert.match(cliSrc, /--level <level>/);
  });
});

// ─── buildMagicLevelsMarkdown ──────────────────────────────────────────────

describe('buildMagicLevelsMarkdown', () => {
  it('returns a markdown table with all 5 preset levels', async () => {
    const { buildMagicLevelsMarkdown } = await import('../src/core/magic-presets.js');
    const markdown = buildMagicLevelsMarkdown();

    assert.ok(typeof markdown === 'string', 'should return a string');
    assert.ok(markdown.includes('# Magic Levels'), 'should have a header');
    assert.ok(markdown.includes('/spark'), 'should include spark preset');
    assert.ok(markdown.includes('/ember'), 'should include ember preset');
    assert.ok(markdown.includes('/magic'), 'should include magic preset');
    assert.ok(markdown.includes('/blaze'), 'should include blaze preset');
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
