import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadCustomPresets,
  validateCustomPreset,
  mergeWithBuiltinPresets,
  CustomPresetCollisionError,
  type CustomPresetMetadata,
} from '../src/core/custom-presets.js';
import { MAGIC_PRESETS } from '../src/core/magic-presets.js';

const VALID_PRESET: CustomPresetMetadata = {
  level: 'my-custom',
  intensity: 'Medium',
  tokenLevel: 'Medium',
  combines: 'autoforge + verify',
  primaryUseCase: 'Custom workflow',
  maxBudgetUsd: 1.0,
  autoforgeWaves: 3,
  convergenceCycles: 0,
  targetMaturityLevel: 3,
};

const VALID_YAML = `
- level: my-custom
  intensity: Medium
  tokenLevel: Medium
  combines: autoforge + verify
  primaryUseCase: Custom workflow
  maxBudgetUsd: 1.0
  autoforgeWaves: 3
  convergenceCycles: 0
  targetMaturityLevel: 3
`;

describe('custom-presets', () => {
  // 1. loadCustomPresets — file not found
  it('loadCustomPresets returns [] when _readFile throws ENOENT', async () => {
    const result = await loadCustomPresets({
      _readFile: async () => { throw new Error('ENOENT: no such file'); },
    });
    assert.deepEqual(result, []);
  });

  // 2. loadCustomPresets — empty YAML
  it('loadCustomPresets with empty YAML returns []', async () => {
    const result = await loadCustomPresets({
      _readFile: async () => '',
    });
    assert.deepEqual(result, []);
  });

  // 3. loadCustomPresets — valid YAML
  it('loadCustomPresets with valid YAML returns parsed presets', async () => {
    const result = await loadCustomPresets({
      _readFile: async () => VALID_YAML,
      cwd: '/tmp/test',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.level, 'my-custom');
    assert.equal(result[0]!.intensity, 'Medium');
    assert.equal(result[0]!.maxBudgetUsd, 1.0);
  });

  // 4. validateCustomPreset — empty object
  it('validateCustomPreset({}) returns false', () => {
    assert.equal(validateCustomPreset({}), false);
  });

  // 5. validateCustomPreset — valid object
  it('validateCustomPreset returns true for a valid preset', () => {
    assert.equal(
      validateCustomPreset({
        level: 'x',
        intensity: 'x',
        tokenLevel: 'x',
        combines: 'x',
        primaryUseCase: 'x',
        maxBudgetUsd: 1,
        autoforgeWaves: 3,
        convergenceCycles: 0,
        targetMaturityLevel: 3,
      }),
      true,
    );
  });

  // 6. validateCustomPreset — missing level
  it('validateCustomPreset with missing level returns false', () => {
    const { level: _, ...rest } = VALID_PRESET;
    assert.equal(validateCustomPreset(rest), false);
  });

  // 7. validateCustomPreset — missing maxBudgetUsd
  it('validateCustomPreset with missing maxBudgetUsd returns false', () => {
    const { maxBudgetUsd: _, ...rest } = VALID_PRESET;
    assert.equal(validateCustomPreset(rest), false);
  });

  // 8. mergeWithBuiltinPresets — contains all 7 built-in keys
  it('mergeWithBuiltinPresets with empty customs contains all 7 built-in keys', () => {
    const merged = mergeWithBuiltinPresets(MAGIC_PRESETS, []);
    const builtinKeys = ['spark', 'ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno'];
    for (const key of builtinKeys) {
      assert.ok(key in merged, `key "${key}" should be in merged`);
    }
    assert.equal(Object.keys(merged).length, 7);
  });

  // 9. mergeWithBuiltinPresets — contains 8 keys with one custom
  it('mergeWithBuiltinPresets with one custom returns 8 keys', () => {
    const merged = mergeWithBuiltinPresets(MAGIC_PRESETS, [VALID_PRESET]);
    assert.equal(Object.keys(merged).length, 8);
    assert.ok('my-custom' in merged);
  });

  // 10. mergeWithBuiltinPresets — does NOT mutate MAGIC_PRESETS
  it('mergeWithBuiltinPresets does not mutate MAGIC_PRESETS', () => {
    mergeWithBuiltinPresets(MAGIC_PRESETS, [VALID_PRESET]);
    assert.equal(Object.keys(MAGIC_PRESETS).length, 7);
    assert.ok(!('my-custom' in MAGIC_PRESETS));
  });

  // 11. MAGIC_PRESETS length still 7
  it('MAGIC_PRESETS always has exactly 7 keys', () => {
    assert.equal(Object.keys(MAGIC_PRESETS).length, 7);
  });

  // 12. mergeWithBuiltinPresets — collision throws
  it('mergeWithBuiltinPresets with collision throws CustomPresetCollisionError', () => {
    const colliding: CustomPresetMetadata = { ...VALID_PRESET, level: 'magic' };
    assert.throws(
      () => mergeWithBuiltinPresets(MAGIC_PRESETS, [colliding]),
      (err: unknown) => err instanceof CustomPresetCollisionError,
    );
  });

  // 13. CustomPresetCollisionError has correct name and level
  it('CustomPresetCollisionError has correct name and level property', () => {
    const err = new CustomPresetCollisionError('blaze');
    assert.equal(err.name, 'CustomPresetCollisionError');
    assert.equal(err.level, 'blaze');
    assert.ok(err.message.includes('blaze'));
  });

  // 14. merged result contains custom preset level
  it('merged result contains the custom preset', () => {
    const merged = mergeWithBuiltinPresets(MAGIC_PRESETS, [VALID_PRESET]);
    assert.ok('my-custom' in merged);
    assert.equal(merged['my-custom']!.level, 'my-custom');
  });

  // 15. custom preset steps can be empty array
  it('custom preset with empty steps array is valid', () => {
    assert.equal(validateCustomPreset({ ...VALID_PRESET, steps: [] }), true);
  });

  // 16. loadCustomPresets — multi-preset YAML
  it('loadCustomPresets with multi-preset YAML returns multiple presets', async () => {
    const multiYaml = `
- level: preset-a
  intensity: Low
  tokenLevel: Low
  combines: autoforge
  primaryUseCase: Test A
  maxBudgetUsd: 0.5
  autoforgeWaves: 2
  convergenceCycles: 0
  targetMaturityLevel: 2
- level: preset-b
  intensity: High
  tokenLevel: High
  combines: party + verify
  primaryUseCase: Test B
  maxBudgetUsd: 2.0
  autoforgeWaves: 8
  convergenceCycles: 2
  targetMaturityLevel: 5
`;
    const result = await loadCustomPresets({
      _readFile: async () => multiYaml,
      cwd: '/tmp/test',
    });
    assert.equal(result.length, 2);
    assert.equal(result[0]!.level, 'preset-a');
    assert.equal(result[1]!.level, 'preset-b');
  });

  // 17. validateCustomPreset — wrong type for autoforgeWaves
  it('validateCustomPreset with string autoforgeWaves returns false', () => {
    assert.equal(validateCustomPreset({ ...VALID_PRESET, autoforgeWaves: 'three' }), false);
  });

  // 18. validateCustomPreset — targetMaturityLevel out of range
  it('validateCustomPreset with targetMaturityLevel 7 returns false', () => {
    assert.equal(validateCustomPreset({ ...VALID_PRESET, targetMaturityLevel: 7 }), false);
  });

  // 19. mergeWithBuiltinPresets returns new object
  it('mergeWithBuiltinPresets returns a new object (not same reference as builtins)', () => {
    const merged = mergeWithBuiltinPresets(MAGIC_PRESETS, []);
    assert.notEqual(merged, MAGIC_PRESETS as unknown);
  });

  // 20. Custom presets can include optional steps array
  it('custom preset with steps array is preserved after merge', () => {
    const withSteps: CustomPresetMetadata = { ...VALID_PRESET, steps: ['autoforge', 'verify'] };
    const merged = mergeWithBuiltinPresets(MAGIC_PRESETS, [withSteps]);
    const entry = merged['my-custom'] as CustomPresetMetadata;
    assert.deepEqual(entry.steps, ['autoforge', 'verify']);
  });

  // 21. loadCustomPresets reads project-level file
  it('loadCustomPresets with project-level file reads it', async () => {
    const cwd = process.cwd();
    const projectPath = path.join(cwd, '.danteforge', 'custom-presets.yaml');
    const readFile = async (p: string) => {
      if (p === projectPath) return VALID_YAML;
      throw new Error('ENOENT');
    };
    const result = await loadCustomPresets({ _readFile: readFile, cwd });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.level, 'my-custom');
  });

  // 22. loadCustomPresets falls back to global if project file not found
  it('loadCustomPresets falls back to global if project file not found', async () => {
    const cwd = process.cwd();
    const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
    const globalPath = path.join(homeDir, '.danteforge', 'custom-presets.yaml');
    const readFile = async (p: string) => {
      if (p === globalPath) return VALID_YAML;
      throw new Error('ENOENT');
    };
    const result = await loadCustomPresets({ _readFile: readFile, cwd, homeDir });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.level, 'my-custom');
  });
});
