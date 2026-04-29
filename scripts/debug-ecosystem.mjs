import { loadState } from '../src/core/state.ts';
import { computeEcosystemMcpScore } from '../src/core/harsh-scorer.ts';

for (const cwd of ['C:/Projects/DanteForge', 'C:/Projects/DanteCode', 'C:/Projects/DanteAgents']) {
  const state = await loadState({ cwd });
  const s = state;
  console.log(`\n=== ${cwd} ===`);
  console.log('skillCount:', typeof s.skillCount, '=', s.skillCount);
  console.log('hasPluginManifest:', typeof s.hasPluginManifest, '=', s.hasPluginManifest);
  console.log('mcpToolCount:', typeof s.mcpToolCount, '=', s.mcpToolCount);
  console.log('providerCount:', typeof s.providerCount, '=', s.providerCount);
  const score = computeEcosystemMcpScore(state, cwd);
  console.log('ecosystemMcp 0-100:', score);
}
