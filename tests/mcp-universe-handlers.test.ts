// Tests for the 4 new MCP handlers that expose DanteForge's feature universe
// surface to MCP clients (Claude Code, Codex, DanteCode):
//   - danteforge_universe
//   - danteforge_ensure_universe_ready
//   - danteforge_canonical_competitors
//   - danteforge_compete_reset

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleUniverse,
  handleEnsureUniverseReady,
  handleCanonicalCompetitors,
  handleCompeteReset,
} from '../src/core/mcp-extended-handlers.js';

function mkTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dante-mcp-universe-'));
  mkdirSync(join(dir, '.danteforge'), { recursive: true });
  mkdirSync(join(dir, '.danteforge', 'compete'), { recursive: true });
  return dir;
}

function parseToolResult(result: { content: { text: string }[]; isError?: boolean }): { data: Record<string, unknown>; isError: boolean } {
  return {
    data: JSON.parse(result.content[0].text) as Record<string, unknown>,
    isError: result.isError === true,
  };
}

test('handleCanonicalCompetitors returns the 16 canonical DanteForge peers grouped by category', async () => {
  const result = await handleCanonicalCompetitors({});
  const { data, isError } = parseToolResult(result);
  assert.equal(isError, false);
  assert.ok((data.count as number) >= 14, `expected >= 14 canonical peers, got ${data.count}`);
  assert.ok(Array.isArray(data.competitors));
  const cats = data.categories as Record<string, string[]>;
  assert.ok(cats['spec-driven dev kits'].length >= 2, 'spec-driven category should include spec-kit + BMAD + OpenSpec');
  assert.ok(cats['skill consolidators'].length >= 1, 'skill consolidator category should include claude-skills');
  assert.ok(cats['orchestration peers'].length >= 5, 'orchestration peers should include MetaGPT/CrewAI/AutoGen/etc.');
  // Anti-test: must NOT include platforms DanteForge sits on top of
  assert.ok(!(data.competitors as string[]).some(c => /^Devin/i.test(c)), 'canonical seed should NOT include Devin');
  assert.ok(!(data.competitors as string[]).some(c => /^Cursor$/i.test(c)), 'canonical seed should NOT include Cursor');
});

test('handleUniverse returns null universe when none exists, with helpful hint', async () => {
  const dir = mkTmpProject();
  const result = await handleUniverse({ _cwd: dir });
  const { data } = parseToolResult(result);
  assert.equal(data.universe, null);
  assert.match(String(data.message), /ensure_universe_ready|refresh=true/);
});

test('handleEnsureUniverseReady invokes the engine and returns shape { features, competitors, generatedAt, ready }', async () => {
  const dir = mkTmpProject();
  // Use the real implementation, but make it cheap: write a pre-existing universe.
  const pre = {
    features: Array.from({ length: 25 }).map((_, i) => ({
      id: `feat-${i}`, name: `X${i}`, description: 'd',
      category: 'execution', competitorsThatHaveIt: ['A'],
    })),
    competitors: ['A'],
    generatedAt: new Date().toISOString(),
    version: 1,
    sourceDescription: 'prefab',
  };
  writeFileSync(join(dir, '.danteforge', 'feature-universe.json'), JSON.stringify(pre));
  const result = await handleEnsureUniverseReady({ _cwd: dir });
  const { data, isError } = parseToolResult(result);
  assert.equal(isError, false);
  assert.equal(data.features, 25);
  assert.equal(data.competitors, 1);
  assert.equal(data.ready, true);
  assert.ok(typeof data.generatedAt === 'string');
});

test('handleEnsureUniverseReady defaults to load-only — never blocks on LLM when nothing on disk', async () => {
  const dir = mkTmpProject();
  // No universe.json on disk; no `build:true` flag — must NOT call LLM, must return ready:false fast.
  const start = Date.now();
  const result = await handleEnsureUniverseReady({ _cwd: dir });
  const elapsed = Date.now() - start;
  const { data, isError } = parseToolResult(result);
  assert.equal(isError, false);
  assert.equal(data.ready, false);
  assert.equal(data.features, 0);
  assert.ok(elapsed < 1000, `must return fast without LLM, took ${elapsed}ms`);
});

test('handleCompeteReset requires explicit confirm:true (default rejects)', async () => {
  const dir = mkTmpProject();
  const result = await handleCompeteReset({ _cwd: dir });
  const { data, isError } = parseToolResult(result);
  assert.equal(isError, true);
  assert.match(String(data.error), /confirm: true/);
});

test('handleCompeteReset rewrites competitors with canonical seed when confirm:true', async () => {
  const dir = mkTmpProject();
  // Seed a matrix with junk competitors
  writeFileSync(join(dir, '.danteforge', 'compete', 'matrix.json'), JSON.stringify({
    project: 'test',
    competitors: ['JunkA', 'JunkB', 'JunkC'],
    competitors_oss: ['JunkA'],
    competitors_closed_source: ['JunkB', 'JunkC'],
    dimensions: [],
    overallSelfScore: 5,
  }));
  const result = await handleCompeteReset({ _cwd: dir, confirm: true });
  const { data, isError } = parseToolResult(result);
  assert.equal(isError, false);
  assert.equal(data.ok, true);
  assert.equal(data.mode, 'use-canonical');
  const count = data.competitorCount as number;
  assert.ok(count >= 14, `expected >= 14 canonical peers, got ${count}`);
  assert.match(String(data.nextStep), /ensure_universe_ready|refresh:true/);
  // Verify the matrix on disk actually changed
  const { readFileSync } = await import('node:fs');
  const matrixOnDisk = JSON.parse(readFileSync(join(dir, '.danteforge', 'compete', 'matrix.json'), 'utf8')) as { competitors: string[] };
  assert.ok(matrixOnDisk.competitors.some(c => /spec-kit/i.test(c)), 'matrix.json should now contain spec-kit');
  assert.ok(!matrixOnDisk.competitors.includes('JunkA'), 'matrix.json should no longer contain JunkA');
});

test('handleCompeteReset rejects useCanonical:false (no other modes wired yet)', async () => {
  const dir = mkTmpProject();
  writeFileSync(join(dir, '.danteforge', 'compete', 'matrix.json'), JSON.stringify({
    project: 'test', competitors: ['x'], dimensions: [], overallSelfScore: 5,
  }));
  const result = await handleCompeteReset({ _cwd: dir, confirm: true, useCanonical: false });
  const { isError } = parseToolResult(result);
  assert.equal(isError, true);
});

test('all 4 universe MCP tools are registered in TOOL_HANDLERS + TOOL_DEFINITIONS', async () => {
  const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
  const { TOOL_DEFINITIONS } = await import('../src/core/mcp-tool-definitions.js');
  const expected = [
    'danteforge_universe',
    'danteforge_ensure_universe_ready',
    'danteforge_canonical_competitors',
    'danteforge_compete_reset',
  ];
  const registeredHandlers = Object.keys(TOOL_HANDLERS);
  const registeredDefs = TOOL_DEFINITIONS.map(d => d.name);
  for (const name of expected) {
    assert.ok(registeredHandlers.includes(name), `${name} missing from TOOL_HANDLERS map`);
    assert.ok(registeredDefs.includes(name), `${name} missing from TOOL_DEFINITIONS`);
  }
  // Sanity: compete_reset must require confirm
  const resetDef = TOOL_DEFINITIONS.find(d => d.name === 'danteforge_compete_reset');
  assert.ok(resetDef, 'definition exists');
  const required = (resetDef!.inputSchema as { required?: string[] }).required ?? [];
  assert.ok(required.includes('confirm'), 'compete_reset must require confirm');
});
