// Search engine factory — selects between MinimalNativeEngine and RipgrepFallback.
// Phase L of docs/PRDs/autonomous-frontier-reaching.md.
//
// Selection policy (auto mode, the default):
//   - native: when the repo has TypeScript files AND the operator hasn't
//     opted out via `forceRipgrep`. The native engine's findSymbol is O(symbols)
//     instead of O(files) which matters for substrate operations.
//   - ripgrep: otherwise. Always available; no setup required.
//
// Explicit override via SearchEnginePreference lets operators force either
// implementation. Mostly useful for parity testing during Phase M rollout.

import { MinimalNativeEngine } from './minimal-native-engine.js';
import { RipgrepFallback } from './ripgrep-fallback.js';
import type {
  CreateSearchEngineOptions,
  SearchEngine,
  SearchEnginePreference,
} from './types.js';

export function createSearchEngine(options: CreateSearchEngineOptions = {}): SearchEngine {
  const pref = resolvePreference(options);
  switch (pref) {
    case 'native':
      return new MinimalNativeEngine();
    case 'ripgrep':
      return new RipgrepFallback();
    case 'auto':
    default:
      // Auto = native by default. The native engine internally delegates pattern
      // search to ripgrep, so the cost of choosing wrong is small.
      return new MinimalNativeEngine();
  }
}

function resolvePreference(options: CreateSearchEngineOptions): SearchEnginePreference {
  if (options.forceRipgrep) return 'ripgrep';
  return options.preference ?? 'auto';
}
