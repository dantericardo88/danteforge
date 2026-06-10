import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProductProbes } from '../src/cli/commands/evidence-scaffold-detect.js';
import { runEvidenceScaffold } from '../src/cli/commands/evidence-scaffold.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

// ── Real temp repos (ephemeral; removed in after()) ───────────────────────────

const tmpDirs: string[] = [];

async function makeRepo(files: Record<string, string>): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-scaffold-detect-'));
  tmpDirs.push(tmp);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(tmp, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  }
  return tmp;
}

after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true });
});

// Run the scaffolder against a real repo dir with unknown dim ids (so the dim-keyed maps
// never fire and the generic product-probe fallback is what gets exercised).
async function scaffold(cwd: string, ids: string[]) {
  const matrix = { dimensions: ids.map(id => ({ id, label: id })) } as unknown as CompeteMatrix;
  let written: unknown = null;
  const stubScripts: string[] = [];
  const result = await runEvidenceScaffold({
    cwd,
    projectType: 'custom',
    _loadMatrix: async () => matrix,
    _writeFile: async (p) => { stubScripts.push(p); },
    _writeMatrix: async (m) => { written = m; },
    _createTimeMachineCommit: null,
  });
  const dims = (written as { dimensions: Array<Record<string, unknown>> } | null)?.dimensions ?? null;
  return { result, dims, stubScripts };
}

describe('evidence-scaffold-detect: capability-driven probes from real entrypoints', () => {
  test('(a) npm scripts start → runnable probe, no exit-1 outcome scaffold', async () => {
    const cwd = await makeRepo({
      'package.json': JSON.stringify({ name: 'srv', scripts: { start: 'node server.js' } }),
      'server.js': 'console.log("up");',
      'README.md': '# srv\n\n## Usage\n\n```bash\nnpm run start\n```\n',
    });

    const probes = detectProductProbes(cwd);
    const runnable = probes.find(p => !p.needsInput);
    assert.ok(runnable, 'a runnable probe must be detected from scripts.start');
    assert.equal(runnable.command, 'npm run start');
    assert.equal(runnable.source, 'scripts');
    assert.equal(runnable.language, 'node');

    const { result, dims } = await scaffold(cwd, ['cold_dim']);
    assert.deepEqual(result.probeDetected, ['cold_dim']);
    assert.deepEqual(result.outcomeProbesGenerated, ['cold_dim']);
    assert.deepEqual(result.outcomeStubsGenerated, [], 'no exit-1 outcome scaffold when a runnable probe exists');
    assert.deepEqual(result.outcomeAuthorRouted, []);
    assert.deepEqual(result.stubGenerated, []);

    const dim = dims![0]!;
    const ct = dim.capability_test as Record<string, unknown>;
    assert.equal(ct.command, 'npm run start');
    const o = (dim.outcomes as Array<Record<string, unknown>>)[0]!;
    assert.equal(o.command, 'npm run start');
    assert.notEqual(o.command, 'exit 1');
    assert.equal(o.kind, 'runtime-exec');
    assert.equal(o.tier, 'T5');
    assert.equal(o._scaffold, undefined, 'a real probe outcome is a genuine declaration, not a scaffold marker');
    assert.equal((o.product_probe as Record<string, unknown>).source, 'scripts');
  });

  test('(b) pyproject [project.scripts] → python candidate (runnable with README usage, needsInput without)', async () => {
    const withReadme = await makeRepo({
      'pyproject.toml': '[project]\nname = "mytool"\n\n[project.scripts]\nmytool = "mytool.cli:main"\n',
      'README.md': '# mytool\n\n## Usage\n\n```\nmytool ingest data.csv\n```\n',
    });
    const runnable = detectProductProbes(withReadme).find(p => p.language === 'python');
    assert.ok(runnable, 'a python probe must be detected from [project.scripts]');
    assert.equal(runnable.source, 'pyproject');
    assert.equal(runnable.needsInput, false);
    assert.equal(runnable.command, 'python -m mytool.cli ingest data.csv');

    const noReadme = await makeRepo({
      'pyproject.toml': '[project]\nname = "mytool"\n\n[project.scripts]\nmytool = "mytool.cli:main"\n',
    });
    const candidate = detectProductProbes(noReadme).find(p => p.language === 'python');
    assert.ok(candidate, 'the entrypoint must still surface as a candidate');
    assert.equal(candidate.needsInput, true);
    assert.equal(candidate.command, 'python -m mytool.cli');
    assert.match(String(candidate.missingInput), /README/);
  });

  test('(c) Cargo [[bin]] with no derivable arg → needsInput candidate, scaffold_note, still-failing scaffold', async () => {
    const cwd = await makeRepo({
      'Cargo.toml': '[package]\nname = "rusty"\nversion = "0.1.0"\n\n[[bin]]\nname = "rusty"\npath = "src/main.rs"\n',
      'src/main.rs': 'fn main() {}\n',
      'README.md': '# rusty\n\nrusty is a tool for things.\n', // prose only — never a derivable arg
    });

    const probes = detectProductProbes(cwd);
    assert.equal(probes.length, 1);
    assert.equal(probes[0]!.needsInput, true, 'prose must never be mined for arguments');
    assert.equal(probes[0]!.command, 'cargo run --quiet --bin rusty');
    assert.equal(probes[0]!.source, 'cargo');

    const { result, dims } = await scaffold(cwd, ['cold_dim']);
    assert.deepEqual(result.probeAuthorRouted, ['cold_dim']);
    assert.deepEqual(result.outcomeAuthorRouted, ['cold_dim']);
    assert.deepEqual(result.probeDetected, []);
    assert.deepEqual(result.outcomeProbesGenerated, []);

    const dim = dims![0]!;
    const o = (dim.outcomes as Array<Record<string, unknown>>)[0]!;
    assert.equal(o.command, 'exit 1', 'a needsInput candidate keeps the honest failing scaffold');
    assert.equal(o._scaffold, true);
    assert.equal(o.candidate_command, 'cargo run --quiet --bin rusty');
    assert.match(String(o.scaffold_note), /cargo run --quiet --bin rusty/);
    assert.match(String(o.scaffold_note), /yardstick author/);

    const ct = dim.capability_test as Record<string, unknown>;
    assert.ok(String(ct.command).startsWith('bash '), 'cap-test stays a failing scaffold script');
    assert.equal(ct.candidate_command, 'cargo run --quiet --bin rusty');
    assert.match(String(ct.scaffold_note), /realistic input/);
  });

  test('(d) bare repo → unchanged exit-1 scaffold behavior', async () => {
    const cwd = await makeRepo({ 'notes.txt': 'nothing runnable here' });

    assert.deepEqual(detectProductProbes(cwd), []);

    const { result, dims, stubScripts } = await scaffold(cwd, ['cold_dim']);
    assert.deepEqual(result.stubGenerated, ['cold_dim']);
    assert.deepEqual(result.outcomeStubsGenerated, ['cold_dim']);
    assert.deepEqual(result.probeDetected, []);
    assert.deepEqual(result.probeAuthorRouted, []);
    assert.deepEqual(result.outcomeProbesGenerated, []);
    assert.deepEqual(result.outcomeAuthorRouted, []);
    assert.ok(stubScripts.some(p => p.includes('cold_dim.sh')), 'stub script still written');

    const o = ((dims![0]!.outcomes) as Array<Record<string, unknown>>)[0]!;
    assert.equal(o.command, 'exit 1');
    assert.equal(o._scaffold, true);
    assert.equal(o.scaffold_note, undefined, 'no candidate → no author-routing marker');
    assert.equal(o.candidate_command, undefined);
  });

  test('(e) help-screen derivations are rejected — never a runnable probe', async () => {
    const cwd = await makeRepo({
      'package.json': JSON.stringify({
        name: 'mytool',
        bin: { mytool: 'dist/cli.js' },
        scripts: { start: 'node dist/cli.js --help' },
      }),
      'dist/cli.js': 'console.log("hi");',
      'README.md': '# mytool\n\n```\nmytool --help\nmytool -h\nmytool process <file>\n```\n',
    });

    const probes = detectProductProbes(cwd);
    assert.equal(probes.filter(p => !p.needsInput).length, 0,
      'help screens and usage notation must never become runnable probes');

    const { result, dims } = await scaffold(cwd, ['cold_dim']);
    assert.deepEqual(result.probeDetected, []);
    assert.deepEqual(result.outcomeProbesGenerated, []);
    const o = ((dims![0]!.outcomes) as Array<Record<string, unknown>>)[0]!;
    assert.equal(o.command, 'exit 1', 'help-only repo falls back to the honest failing scaffold');
  });

  test('(f) go cmd/<name>/main.go with README usage → runnable go probe', async () => {
    const cwd = await makeRepo({
      'go.mod': 'module example.com/server\n',
      'cmd/server/main.go': 'package main\n\nfunc main() {}\n',
      'README.md': '# server\n\n```\nserver --port 8080\n```\n',
    });
    const probe = detectProductProbes(cwd).find(p => p.language === 'go');
    assert.ok(probe, 'a go probe must be detected from cmd/server/main.go');
    assert.equal(probe.needsInput, false);
    assert.equal(probe.command, 'go run ./cmd/server --port 8080');
    assert.equal(probe.source, 'go');
  });
});
