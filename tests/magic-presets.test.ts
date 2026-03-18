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
