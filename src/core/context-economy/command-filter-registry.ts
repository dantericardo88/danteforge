// Command Filter Registry — maps command families to filter modules (PRD-26).

import type { CommandFilter, FilterResult } from './types.js';
import { gitFilter } from './filters/git.js';
import { npmFilter } from './filters/npm.js';
import { pnpmFilter } from './filters/pnpm.js';
import { eslintFilter } from './filters/eslint.js';
import { jestFilter } from './filters/jest.js';
import { vitestFilter } from './filters/vitest.js';
import { cargoFilter } from './filters/cargo.js';
import { dockerFilter } from './filters/docker.js';
import { findFilter } from './filters/find.js';
import { pytestFilter } from './filters/pytest.js';
import { estimateTokens } from '../token-estimator.js';

const BUILT_IN_FILTERS: CommandFilter[] = [
  gitFilter,
  npmFilter,
  pnpmFilter,
  eslintFilter,
  jestFilter,
  vitestFilter,
  cargoFilter,
  dockerFilter,
  findFilter,
  pytestFilter,
];

export interface RegistryLookupResult {
  filter: CommandFilter | null;
  filterStatus: 'found' | 'passthrough';
}

export class CommandFilterRegistry {
  private readonly filters: CommandFilter[];

  constructor(extraFilters: CommandFilter[] = []) {
    this.filters = [...BUILT_IN_FILTERS, ...extraFilters];
  }

  lookup(command: string, args: string[]): RegistryLookupResult {
    for (const f of this.filters) {
      if (f.detect(command, args)) {
        return { filter: f, filterStatus: 'found' };
      }
    }
    return { filter: null, filterStatus: 'passthrough' };
  }

  apply(output: string, command: string, args: string[]): FilterResult & { command: string } {
    const { filter, filterStatus } = this.lookup(command, args);

    if (filterStatus === 'passthrough' || filter === null) {
      const tokens = estimateTokens(output);
      return {
        command,
        output,
        status: 'passthrough',
        inputTokens: tokens,
        outputTokens: tokens,
        savedTokens: 0,
        savingsPercent: 0,
        sacredSpanCount: 0,
        filterId: 'passthrough',
      };
    }

    try {
      return { command, ...filter.filter(output, command, args) };
    } catch {
      const tokens = estimateTokens(output);
      return {
        command,
        output,
        status: 'filter-failed',
        inputTokens: tokens,
        outputTokens: tokens,
        savedTokens: 0,
        savingsPercent: 0,
        sacredSpanCount: 0,
        filterId: filter.filterId,
      };
    }
  }

  get filterIds(): string[] {
    return this.filters.map((f) => f.filterId);
  }

  get size(): number {
    return this.filters.length;
  }
}

export const defaultRegistry = new CommandFilterRegistry();
