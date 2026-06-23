import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedLeaderTargetFromHarvest, type HarvestedSignal } from '../src/core/harvested-bar.js';
import type { FrontierSpec } from '../src/core/frontier-spec.js';

// The council's "wire the attribution teeth into seeding" gap: seedLeaderTargetFromHarvest must SET
// addressed_actor (from demand text) + artifact_actor (from the dim context) so applyFrontierGate's cap fires.

function spec(runCommand: string, callsite: string): FrontierSpec {
  return {
    version: 1, target_score: 9.0, status: 'draft',
    leader_target: { competitor: 'demand', score: 0, observed_capability: 'TODO', category_delta: 'TODO' },
    real_user_path: { required_callsite: callsite, run_command: runCommand, observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}
function demand(claim: string): HarvestedSignal {
  return { kind: 'demand', source: 'cline/cline#1', fetched_at: '2026-06-23T00:00:00Z', claim };
}

test('seeding sets addressed_actor from the DEMAND text and artifact_actor from the dim context', () => {
  const s = spec('node dist/index.js mcp-server', 'src/core/mcp-server.ts');
  seedLeaderTargetFromHarvest(s, [demand('MCP hosts ignore the server-level instructions; the host must honor them')]);
  assert.equal(s.addressed_actor, 'host');   // the demand is filed against the host
  assert.equal(s.artifact_actor, 'server');  // the artifact runs the MCP server
});

test('a server-addressed demand on a server artifact ALIGNS (actors match → no attribution cap)', () => {
  const s = spec('node dist/index.js mcp-server', 'src/core/mcp-server.ts');
  seedLeaderTargetFromHarvest(s, [demand('the MCP server should expose stable tool ids and structured server errors')]);
  assert.equal(s.addressed_actor, 'server');
  assert.equal(s.artifact_actor, 'server');
});
