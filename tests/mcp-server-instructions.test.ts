import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DANTEFORGE_MCP_INSTRUCTIONS } from '../src/core/mcp-server-instructions.js';
import { createMcpServer } from '../src/core/mcp-server.js';

// Demand-grounded capability test for ecosystem_mcp (engineering frontier).
// Provenance: harvested demand cluster "mcp / server / after" — cline/cline#8797 (server-level instructions)
// + cline/cline#8087 (stable tool identity). These prove DanteForge's SERVER-SIDE half of that demand.

test('DanteForge declares substantive server-level MCP instructions (cline#8797 — server half)', () => {
  const i = DANTEFORGE_MCP_INSTRUCTIONS;
  assert.ok(i.length > 200, 'instructions must be substantive, not a placeholder');
  assert.match(i, /danteforge_state/, 'guides the host to the entry tool');
  assert.match(i, /specify[\s\S]*plan[\s\S]*tasks[\s\S]*forge[\s\S]*verify/, 'declares the gated workflow order');
  assert.match(i, /stub|mock|TODO/, 'declares the zero-tolerance rule a host should honor');
  assert.match(i, /7\.0|receipt|evidence-gated/, 'declares the evidence-gated scoring rule');
});

test('the MCP initialize response CARRIES the server-level instructions (the #8797 receipt)', async () => {
  const server = createMcpServer();
  const res = await server.handleRequest({ method: 'initialize', params: {} }) as { result?: { instructions?: string } };
  assert.equal(
    res.result?.instructions,
    DANTEFORGE_MCP_INSTRUCTIONS,
    'a host connecting to DanteForge receives its server-level instructions in the initialize response',
  );
});

test('tool identity is STABLE across reconnects — the #8087 claim is true (static danteforge_* names)', async () => {
  // Two independent server instances (a reconnect) must expose byte-identical, static tool identifiers —
  // never an ephemeral per-session key. This is exactly the failure cline#8087 reports in another host.
  const a = createMcpServer();
  const b = createMcpServer();
  const ra = await a.handleRequest({ method: 'tools/list', params: {} }) as { result?: { tools?: Array<{ name: string }> } };
  const rb = await b.handleRequest({ method: 'tools/list', params: {} }) as { result?: { tools?: Array<{ name: string }> } };
  const namesA = (ra.result?.tools ?? []).map(t => t.name);
  const namesB = (rb.result?.tools ?? []).map(t => t.name);
  assert.ok(namesA.length > 0, 'server exposes tools');
  assert.deepEqual(namesA, namesB, 'tool identities are identical across server instances / reconnects');
  assert.ok(namesA.every(n => /^danteforge_[a-z0-9_]+$/.test(n)), 'every tool id is a static danteforge_* literal, not an ephemeral key');
});
