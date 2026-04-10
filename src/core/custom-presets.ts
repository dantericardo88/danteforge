// Custom Presets — load and merge user-defined magic presets with built-ins
import path from 'path';
import os from 'os';
import type { MagicPresetMetadata, MagicLevel } from './magic-presets.js';

export interface CustomPresetMetadata {
  level: string;             // must not collide with built-in MagicLevel
  intensity: string;
  tokenLevel: string;
  combines: string;
  primaryUseCase: string;
  maxBudgetUsd: number;
  autoforgeWaves: number;
  convergenceCycles: number;
  targetMaturityLevel: 1 | 2 | 3 | 4 | 5 | 6;
  steps?: string[];          // explicit step-kind sequence (optional)
}

export class CustomPresetCollisionError extends Error {
  constructor(public readonly level: string) {
    super(`Custom preset level "${level}" collides with a built-in preset`);
    this.name = 'CustomPresetCollisionError';
  }
}

export interface CustomPresetsOptions {
  _readFile?: (p: string) => Promise<string>;
  cwd?: string;
  homeDir?: string;
}

const REQUIRED_STRING_FIELDS: (keyof CustomPresetMetadata)[] = [
  'level', 'intensity', 'tokenLevel', 'combines', 'primaryUseCase',
];
const REQUIRED_NUMBER_FIELDS: (keyof CustomPresetMetadata)[] = [
  'maxBudgetUsd', 'autoforgeWaves', 'convergenceCycles',
];
const VALID_MATURITY_LEVELS = new Set([1, 2, 3, 4, 5, 6]);

/**
 * Validate the shape of a custom preset object.
 * Returns true only if all required fields are present with correct types.
 */
export function validateCustomPreset(preset: unknown): preset is CustomPresetMetadata {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return false;
  const p = preset as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof p[field] !== 'string' || (p[field] as string).length === 0) return false;
  }
  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (typeof p[field] !== 'number') return false;
  }
  if (!VALID_MATURITY_LEVELS.has(p['targetMaturityLevel'] as number)) return false;

  return true;
}

async function parsePresetsFromYaml(content: string, readFile: (p: string) => Promise<string>): Promise<CustomPresetMetadata[]> {
  // Use js-yaml if available
  try {
    const { parse } = await import('yaml');
    const parsed = parse(content) as unknown;
    if (!parsed || !Array.isArray(parsed)) return [];
    const result: CustomPresetMetadata[] = [];
    for (const item of parsed) {
      if (validateCustomPreset(item)) {
        result.push(item as CustomPresetMetadata);
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Loads custom presets from .danteforge/custom-presets.yaml (project-level)
 * then falls back to ~/.danteforge/custom-presets.yaml (global).
 * Project-level takes precedence — first found wins, no merging.
 */
export async function loadCustomPresets(opts?: CustomPresetsOptions): Promise<CustomPresetMetadata[]> {
  const readFile = opts?._readFile ?? ((p: string) => import('fs/promises').then(m => m.readFile(p, 'utf8')));
  const cwd = opts?.cwd ?? process.cwd();
  const homeDir = opts?.homeDir ?? os.homedir();

  const projectPath = path.join(cwd, '.danteforge', 'custom-presets.yaml');
  const globalPath = path.join(homeDir, '.danteforge', 'custom-presets.yaml');

  // Try project-level first
  try {
    const content = await readFile(projectPath);
    return await parsePresetsFromYaml(content, readFile);
  } catch {
    // fall through to global
  }

  // Try global
  try {
    const content = await readFile(globalPath);
    return await parsePresetsFromYaml(content, readFile);
  } catch {
    return [];
  }
}

/**
 * Merge custom presets into the built-in presets map.
 * Returns a new object — NEVER mutates the builtins argument.
 * Throws CustomPresetCollisionError if any custom level matches a built-in key.
 */
export function mergeWithBuiltinPresets(
  builtins: Record<string, MagicPresetMetadata>,
  customs: CustomPresetMetadata[],
): Record<string, MagicPresetMetadata | CustomPresetMetadata> {
  const result: Record<string, MagicPresetMetadata | CustomPresetMetadata> = { ...builtins };

  for (const custom of customs) {
    if (custom.level in builtins) {
      throw new CustomPresetCollisionError(custom.level);
    }
    result[custom.level] = custom;
  }

  return result;
}
