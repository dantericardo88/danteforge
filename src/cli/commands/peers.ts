// peers — diagnostic: show which peer preset is resolved for the current
// project and why. Helps users sanity-check that running /universe or
// /compete in a partially-built project will pick the right competitors.

import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import {
  resolveProjectPreset,
  getPeerPreset,
  listAvailablePresets,
  type PeerPreset,
} from '../../core/peer-presets.js';
import { loadMatrix } from '../../core/compete-matrix.js';

export interface PeersOptions {
  cwd?: string;
  json?: boolean;
  preset?: string;        // if set, just print that preset's list
  showAll?: boolean;      // dump every preset's full list
}

export async function peers(options: PeersOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  if (options.showAll) {
    const all: Record<string, string[]> = {};
    for (const name of listAvailablePresets()) {
      all[name] = getPeerPreset(name);
    }
    if (options.json) {
      logger.info(JSON.stringify({ presets: all }, null, 2));
    } else {
      for (const [name, list] of Object.entries(all)) {
        logger.info(`\n[${name}]  ${list.length} peers`);
        for (const peer of list) logger.info(`  - ${peer}`);
      }
    }
    return;
  }

  if (options.preset) {
    const list = getPeerPreset(options.preset as PeerPreset);
    if (options.json) {
      logger.info(JSON.stringify({ preset: options.preset, count: list.length, peers: list }, null, 2));
    } else {
      logger.info(`[${options.preset}]  ${list.length} peers`);
      for (const peer of list) logger.info(`  - ${peer}`);
    }
    return;
  }

  // Default: diagnose the current project
  const state = await loadState({ cwd }).catch(() => null);
  const matrix = await loadMatrix(cwd).catch(() => null);
  const resolution = await resolveProjectPreset(cwd, state ?? undefined);

  let activeSource: string;
  let activeCompetitors: string[];
  if (state?.competitors && state.competitors.length > 0) {
    activeSource = 'state.competitors (STATE.yaml)';
    activeCompetitors = state.competitors;
  } else if (matrix?.competitors && Array.isArray(matrix.competitors) && matrix.competitors.length > 0) {
    activeSource = '.danteforge/compete/matrix.json';
    activeCompetitors = matrix.competitors.map((c: unknown) =>
      typeof c === 'string' ? c : (c as { name?: string })?.name ?? String(c),
    ).filter(Boolean);
  } else if (resolution.literalCompetitors) {
    activeSource = '.danteforge/peers.json (literal competitors)';
    activeCompetitors = resolution.literalCompetitors;
  } else if (resolution.preset) {
    activeSource = `${resolution.preset} preset (resolved via ${resolution.reason})`;
    activeCompetitors = getPeerPreset(resolution.preset);
  } else {
    activeSource = 'NONE — falling back would return empty';
    activeCompetitors = [];
  }

  if (options.json) {
    logger.info(JSON.stringify({
      cwd,
      project: state?.project ?? null,
      resolution,
      activeSource,
      activeCompetitorCount: activeCompetitors.length,
      activeCompetitors,
    }, null, 2));
    return;
  }

  logger.info('');
  logger.info(`Project peer resolution for: ${cwd}`);
  logger.info(`  state.project:    ${state?.project ?? '(none)'}`);
  logger.info(`  matrix.json:      ${matrix ? `${matrix.competitors?.length ?? 0} competitor(s)` : '(none)'}`);
  logger.info(`  peers.json:       ${resolution.literalCompetitors ? `${resolution.literalCompetitors.length} literal` : '(none)'}`);
  logger.info(`  identity preset:  ${resolution.preset ?? '(unresolved)'}`);
  logger.info(`  reason:           ${resolution.reason}`);
  logger.info('');
  logger.info(`Active source for /universe + /compete: ${activeSource}`);
  logger.info(`Competitors (${activeCompetitors.length}):`);
  for (const peer of activeCompetitors.slice(0, 20)) logger.info(`  - ${peer}`);
  if (activeCompetitors.length > 20) logger.info(`  ... and ${activeCompetitors.length - 20} more`);

  if (activeCompetitors.length === 0) {
    logger.info('');
    logger.warn('No competitors will be resolved. To seed:');
    logger.warn('  - Run: danteforge compete --reset --preset <coding-assistant|dev-tool-optimizer|agent-framework>');
    logger.warn('  - Or create .danteforge/peers.json with { "preset": "..." } or { "competitors": ["..."] }');
    logger.warn('  - Or set state.competitors in .danteforge/STATE.yaml');
  }
}
