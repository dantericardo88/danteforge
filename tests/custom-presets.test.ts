// Custom Presets tests — validateCustomPreset, loadCustomPresets, mergeWithBuiltinPresets

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCustomPreset,
  loadCustomPresets,
  mergeWithBuiltinPresets,
  CustomPresetCollisionError,
  type CustomPresetMetadata,
} from '../src/core/custom-presets.js';
import type { MagicPresetMetadata } from '../src/core/magic-presets.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCustomPreset(overrides: Partial<CustomPresetMetadata> = {}): CustomPresetMetadata {
  return {
    level: 'my-preset',
    intensity: 'high',
    tokenLevel: 'medium',
    combines: 'autoforge + verify',
    primaryUseCase: 'rapid prototyping',
    maxBudgetUsd: 5,
    autoforgeWaves: 3,
    convergenceCycles: 2,
    targetMaturityLevel: 3,
    ...overrides,
  };
}

const VALID_YAML = `
- level: ultra
  intensity: very-high
  tokenLevel: heavy
  combines: everything
  primaryUseCase: maximum quality
  maxBudgetUsd: 50
  autoforgeWaves: 10
  convergenceCycles: 5
  targetMaturityLevel: 6
`;

// ── validateCustomPreset ──────────────────────────────────────────────────────

describe('validateCustomPreset', () => {
  it('returns true for a valid preset', () => {
    assert.equal(validateCustomPreset(makeCustomPreset()), true);
  });

  it('returns false for null / undefined', () => {
    assert.equal(validateCustomPreset(null), false);
    assert.equal(validateCustomPreset(undefined), false);
  });

  it('returns false for a string', () => {
    assert.equal(validateCustomPreset('not an object'), false);
  });

  it('returns false for an array', () => {
    assert.equal(validateCustomPreset([]), false);
  });

  it('returns false when required string field is missing', () => {
    const { level: _l, ...withoutLevel } = makeCustomPreset();
    assert.equal(validateCustomPreset(withoutLevel), false);
  });

  it('returns false when required string field is empty', () => {
    assert.equal(validateCustomPreset(makeCustomPreset({ level: '' })), false);
  });

  it('returns false when required number field is a string', () => {
    assert.equal(validateCustomPreset({ ...makeCustomPreset(), maxBudgetUsd: 'five' }), false);
  });

  it('returns false for invalid targetMaturityLevel', () => {
    assert.equal(validateCustomPreset(makeCustomPreset({ targetMaturityLevel: 7 as never })), false);
    assert.equal(validateCustomPreset(makeCustomPreset({ targetMaturityLevel: 0 as never })), false);
  });

  it('returns true for all valid maturity levels 1-6', () => {
    for (let l = 1; l <= 6; l++) {
      assert.equal(validateCustomPreset(makeCustomPreset({ targetMaturityLevel: l as 1 })), true, `level ${l} should be valid`);
    }
  });

  it('accepts optional steps field', () => {
    assert.equal(validateCustomPreset(makeCustomPreset({ steps: ['forge', 'verify'] })), true);
  });
});

// ── loadCustomPresets ─────────────────────────────────────────────────────────

describe('loadCustomPresets', () => {
  it('returns empty array when no file exists', async () => {
    const result = await loadCustomPresets({
      _readFile: async () => { throw new Error('ENOENT'); },
      cwd: '/fake/cwd',
      homeDir: '/fake/home',
    });
    assert.deepEqual(result, []);
  });

  it('parses valid YAML from project-level path', async () => {
    const result = await loadCustomPresets({
      _readFile: async (p: string) => {
        if (p.includes('.danteforge')) return VALID_YAML;
        throw new Error('not found');
      },
      cwd: '/fake/cwd',
      homeDir: '/fake/home',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].level, 'ultra');
    assert.equal(result[0].targetMaturityLevel, 6);
  });

  it('falls back to global path when project-level missing', async () => {
    let readCount = 0;
    const result = await loadCustomPresets({
      _readFile: async (p: string) => {
        readCount++;
        // On Windows, path.join uses backslashes; match by 'home' vs 'cwd' substring
        if (p.includes('home') && p.includes('custom-presets.yaml')) return VALID_YAML;
        throw new Error('ENOENT');
      },
      cwd: '/fake/cwd',
      homeDir: '/fake/home',
    });
    assert.ok(readCount >= 2, 'should try project first, then global');
    assert.equal(result.length, 1);
  });

  it('returns empty array for invalid YAML (non-array root)', async () => {
    const result = await loadCustomPresets({
      _readFile: async () => 'key: value\n',
      cwd: '/fake/cwd',
      homeDir: '/fake/home',
    });
    assert.deepEqual(result, []);
  });

  it('skips invalid preset items in the array', async () => {
    const mixedYaml = `
- level: valid
  intensity: medium
  tokenLevel: light
  combines: forge
  primaryUseCase: testing
  maxBudgetUsd: 5
  autoforgeWaves: 2
  convergenceCycles: 1
  targetMaturityLevel: 2
- level: ""
  intensity: ""
  tokenLevel: ""
  combines: ""
  primaryUseCase: ""
  maxBudgetUsd: bad
  autoforgeWaves: 1
  convergenceCycles: 1
  targetMaturityLevel: 1
`;
    const result = await loadCustomPresets({
      _readFile: async () => mixedYaml,
      cwd: '/fake/cwd',
      homeDir: '/fake/home',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].level, 'valid');
  });

  it('project-level takes precedence over global', async () => {
    const projectYaml = `
- level: project-preset
  intensity: low
  tokenLevel: light
  combines: forge
  primaryUseCase: project use
  maxBudgetUsd: 2
  autoforgeWaves: 1
  convergenceCycles: 1
  targetMaturityLevel: 1
`;
    const globalYaml = `
- level: global-preset
  intensity: high
  tokenLevel: heavy
  combines: everything
  primaryUseCase: global use
  maxBudgetUsd: 50
  autoforgeWaves: 10
  convergenceCycles: 5
  targetMaturityLevel: 6
`;
    const result = await loadCustomPresets({
      _readFile: async (p: string) => {
        if (p.includes('fake') && (p.includes('cwd') || p.includes('Projects'))) return projectYaml;
        if (p.includes('fake') && p.includes('home')) return globalYaml;
        throw new Error('not found');
      },
      cwd: '/fake/cwd',
      homeDir: '/fake/home',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].level, 'project-preset');
  });
});

// ── mergeWithBuiltinPresets ───────────────────────────────────────────────────

describe('mergeWithBuiltinPresets', () => {
  const builtins: Record<string, MagicPresetMetadata> = {
    ember: {
      level: 'ember',
      intensity: 'gentle',
      tokenLevel: 'light',
      combines: 'review + forge',
      primaryUseCase: 'small fixes',
      maxBudgetUsd: 2,
      autoforgeWaves: 1,
      convergenceCycles: 1,
      targetMaturityLevel: 2,
      steps: [],
    },
  };

  it('adds custom preset to result', () => {
    const custom = makeCustomPreset({ level: 'ultra' });
    const result = mergeWithBuiltinPresets(builtins, [custom]);
    assert.ok('ultra' in result);
    assert.ok('ember' in result);
  });

  it('does not mutate builtins argument', () => {
    const original = { ...builtins };
    const custom = makeCustomPreset({ level: 'extra' });
    mergeWithBuiltinPresets(builtins, [custom]);
    assert.deepEqual(Object.keys(builtins), Object.keys(original));
  });

  it('throws CustomPresetCollisionError on level collision', () => {
    const collidingCustom = makeCustomPreset({ level: 'ember' });
    assert.throws(
      () => mergeWithBuiltinPresets(builtins, [collidingCustom]),
      CustomPresetCollisionError,
    );
  });

  it('CustomPresetCollisionError has the colliding level', () => {
    const collidingCustom = makeCustomPreset({ level: 'ember' });
    try {
      mergeWithBuiltinPresets(builtins, [collidingCustom]);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof CustomPresetCollisionError);
      assert.equal(err.level, 'ember');
    }
  });

  it('merges multiple custom presets', () => {
    const customs = [makeCustomPreset({ level: 'alpha' }), makeCustomPreset({ level: 'beta' })];
    const result = mergeWithBuiltinPresets(builtins, customs);
    assert.ok('alpha' in result);
    assert.ok('beta' in result);
    assert.ok('ember' in result);
  });

  it('returns copy with builtins only when customs is empty', () => {
    const result = mergeWithBuiltinPresets(builtins, []);
    assert.deepEqual(Object.keys(result), Object.keys(builtins));
  });
});
