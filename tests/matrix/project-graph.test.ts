// Phase 2 — Project Graph builder tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProjectGraph, writeProjectGraph } from '../../src/matrix/engines/project-graph.js';

const tmpDirs: string[] = [];
async function makeFixtureRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-pg-'));
  tmpDirs.push(dir);
  await fs.mkdir(path.join(dir, 'src/core'), { recursive: true });
  await fs.mkdir(path.join(dir, 'src/cli/commands'), { recursive: true });
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });

  await fs.writeFile(
    path.join(dir, 'src/core/foo.ts'),
    `export interface Foo { x: number; }\nexport function makeFoo(): Foo { return { x: 1 }; }\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'src/core/bar.ts'),
    `import { Foo } from './foo.js';\nexport function useFoo(f: Foo): number { return f.x; }\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'src/cli/commands/hello.ts'),
    `export function hello(): string { return 'hi'; }\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, '.danteforge/agent-guard.json'),
    JSON.stringify({ frozenFiles: ['src/core/foo.ts'] }),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, '.danteforge/agent-ownership.json'),
    JSON.stringify({
      globalAllowed: [],
      workstreams: {
        'matrix-kernel': { owned: ['src/core/**'] },
        'workflow-commands': { owned: ['src/cli/**'] },
      },
    }),
    'utf8',
  );

  return dir;
}

after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

// ── buildProjectGraph ───────────────────────────────────────────────────────

describe('buildProjectGraph', () => {
  it('produces a graph for a fixture repo with file + module nodes', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });

    assert.equal(graph.project.projectId, path.basename(cwd));
    assert.equal(graph.project.rootPath, cwd);

    // Should have at least 3 file nodes + at least 2 module nodes
    const fileNodes = graph.nodes.filter(n => n.type === 'file' || n.type === 'cli-command');
    const moduleNodes = graph.nodes.filter(n => n.type === 'module');
    assert.ok(fileNodes.length >= 3, `expected ≥3 file nodes, got ${fileNodes.length}`);
    assert.ok(moduleNodes.length >= 1, `expected ≥1 module node, got ${moduleNodes.length}`);
  });

  it('tags the frozen file as protected', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });
    const fooNode = graph.nodes.find(n => n.paths.includes('src/core/foo.ts'));
    assert.ok(fooNode, 'foo.ts node should exist');
    assert.equal(fooNode!.protected, true);
  });

  it('tags ownedBy from workstream ownership', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });
    const fooNode = graph.nodes.find(n => n.paths.includes('src/core/foo.ts'));
    assert.equal(fooNode!.ownedBy, 'matrix-kernel');
    const helloNode = graph.nodes.find(n => n.paths.includes('src/cli/commands/hello.ts'));
    assert.equal(helloNode!.ownedBy, 'workflow-commands');
  });

  it('extracts exports from each file', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });
    const fooNode = graph.nodes.find(n => n.paths.includes('src/core/foo.ts'));
    assert.ok(fooNode!.exports!.includes('Foo'), 'should export Foo');
    assert.ok(fooNode!.exports!.includes('makeFoo'), 'should export makeFoo');
  });

  it('detects relative imports as dependsOn edges', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });
    const barNode = graph.nodes.find(n => n.paths.includes('src/core/bar.ts'));
    assert.ok(barNode!.dependsOn && barNode!.dependsOn.length > 0, 'bar.ts should have deps');
    const hasFooDep = barNode!.dependsOn!.some(d => d.includes('foo'));
    assert.ok(hasFooDep, `expected bar to depend on foo, got: ${barNode!.dependsOn!.join(', ')}`);
  });

  it('classifies CLI command files', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });
    const helloNode = graph.nodes.find(n => n.paths.includes('src/cli/commands/hello.ts'));
    assert.equal(helloNode!.type, 'cli-command');
  });

  it('handles empty repos gracefully', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-pg-empty-'));
    tmpDirs.push(cwd);
    const graph = await buildProjectGraph({ cwd });
    assert.equal(graph.nodes.length, 0);
  });
});

// ── writeProjectGraph ──────────────────────────────────────────────────────

describe('writeProjectGraph', () => {
  it('persists the graph to the canonical path', async () => {
    const cwd = await makeFixtureRepo();
    const graph = await buildProjectGraph({ cwd });
    const outPath = await writeProjectGraph(graph, cwd);
    assert.ok(outPath.endsWith('matrix.project-graph.json'));
    const content = await fs.readFile(outPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.project.projectId, graph.project.projectId);
    assert.equal(parsed.nodes.length, graph.nodes.length);
  });
});
