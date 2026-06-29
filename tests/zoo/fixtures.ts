// tests/zoo/fixtures.ts — builders for the five FLEET ZOO repos (docs/SEAM_HARDENING_PLAN.md,
// Component 2). Each builder creates a REAL temp git repo under X:\tmp replicating one fleet
// repo's documented shape, so the whole ascend chain (real coordination, seamed agent work) can
// be driven through it in CI seconds. Fixtures are disposable: everything lives under ZOO_ROOT
// and is removed by the test file's after() hook.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

/** All zoo repos live here — X:\tmp by project convention (never C:), allowed by the saveMatrix guard. */
export const ZOO_ROOT = path.join(os.tmpdir(), `zoo-fleet-${process.pid}`);

// ── git helpers ───────────────────────────────────────────────────────────────

/** Run git with an EXPLICIT cwd. Every zoo git op goes through this so no fixture
 *  operation can ever address the real DanteForge checkout (the test process cwd). */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000 });
  return stdout;
}

/** A WorktreeGitFn (src/utils/worktree.ts seam) bound to the fixture repo's cwd. */
export function gitRawFor(cwd: string): { raw: (args: string[]) => Promise<string> } {
  return { raw: (args: string[]) => git(cwd, args) };
}

export async function initGitRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ['init']);
  await git(dir, ['config', 'user.email', 'zoo@danteforge.test']);
  await git(dir, ['config', 'user.name', 'Fleet Zoo']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', message]);
}

/** Commit count on HEAD — the "did the autopilot commit?" probe. */
export async function revCount(dir: string): Promise<number> {
  return Number((await git(dir, ['rev-list', '--count', 'HEAD'])).trim());
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

// ── matrix helpers ────────────────────────────────────────────────────────────

export interface ZooOutcome {
  id: string;
  kind?: string;
  tier: string;
  description: string;
  command?: string;
  expected_exit?: number;
  timeout_ms?: number;
  required_callsite?: string;
}

export interface ZooDim {
  id: string;
  label: string;
  weight: number;
  category: string;
  frequency: string;
  scores: Record<string, number>;
  gap_to_leader: number;
  leader: string;
  gap_to_closed_source_leader: number;
  closed_source_leader: string;
  gap_to_oss_leader: number;
  oss_leader: string;
  status: string;
  sprint_history: unknown[];
  next_sprint_target: number;
  capability_test?: { command: string; description: string; timeoutMs?: number };
  outcomes?: ZooOutcome[];
}

export interface ZooMatrix {
  project: string;
  competitors: string[];
  competitors_closed_source: string[];
  competitors_oss: string[];
  lastUpdated: string;
  overallSelfScore: number;
  dimensions: ZooDim[];
}

export function zooDim(id: string, over: Partial<ZooDim> = {}): ZooDim {
  return {
    id,
    label: id.replace(/_/g, ' '),
    weight: 1.0,
    category: 'features',
    frequency: 'medium',
    scores: { self: 4.0 },
    gap_to_leader: 0,
    leader: 'none',
    gap_to_closed_source_leader: 0,
    closed_source_leader: 'none',
    gap_to_oss_leader: 0,
    oss_leader: 'none',
    status: 'not-started',
    sprint_history: [],
    next_sprint_target: 7.0,
    ...over,
  };
}

export function zooMatrix(project: string, dimensions: ZooDim[]): ZooMatrix {
  return {
    project,
    competitors: [],
    competitors_closed_source: [],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 0,
    dimensions,
  };
}

export function matrixPath(dir: string): string {
  return path.join(dir, '.danteforge', 'compete', 'matrix.json');
}

export async function writeZooMatrix(dir: string, matrix: ZooMatrix): Promise<void> {
  await write(matrixPath(dir), JSON.stringify(matrix, null, 2) + '\n');
}

export async function readRawMatrix(dir: string): Promise<ZooMatrix> {
  return JSON.parse(await fs.readFile(matrixPath(dir), 'utf8')) as ZooMatrix;
}

// ── zoo-cold — zero-dep BOM'd package.json + README usage, no .danteforge ─────

export async function buildColdZoo(): Promise<string> {
  const dir = path.join(ZOO_ROOT, 'cold');
  // The BOM is the live pin: Windows editors routinely write package.json with a UTF-8 BOM and
  // the preflight must still read it as a zero-dependency manifest (not "assume deps").
  const pkg = JSON.stringify({
    name: 'weatherlog',
    version: '1.0.0',
    description: 'zero-dependency weather log formatter',
    license: 'MIT',
  }, null, 2);
  await write(path.join(dir, 'package.json'), '﻿' + pkg + '\n');
  await write(path.join(dir, 'README.md'), [
    '# weatherlog',
    '',
    'Formats raw weather station logs into daily tables.',
    '',
    '## Usage',
    '',
    '```',
    'weatherlog --input logs/2026-06.txt --format table',
    '```',
    '',
  ].join('\n'));
  await write(path.join(dir, 'index.js'), 'process.stdout.write("weatherlog\\n");\n');
  await initGitRepo(dir);
  await commitAll(dir, 'zoo-cold: initial');
  return dir;
}

// ── zoo-dantesecurity — polyglot (Cargo.toml + pyproject), 30 dims ────────────

export const SEC_LEDGER_DIM = 'sec_001';
export const SEC_SEAMED_DIM = 'sec_002';
export const SEC_ANNOTATE_DIM = 'sec_003';
export const SEC_DETIER_DIM = 'sec_004';
export const SEC_CARGO_DIMS = ['sec_005', 'sec_006', 'sec_007'];
export const SEC_SETUP_DIM = 'sec_030';

export async function buildDanteSecurityZoo(): Promise<string> {
  const dir = path.join(ZOO_ROOT, 'dantesecurity');
  await write(path.join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/dante-core"]\n');
  await write(path.join(dir, 'crates', 'dante-core', 'Cargo.toml'),
    '[package]\nname = "dante-core"\nversion = "0.1.0"\n');
  await write(path.join(dir, 'crates', 'dante-core', 'src', 'lib.rs'),
    'pub mod engine;\npub fn scan(input: &str) -> usize { input.len() }\n');
  await write(path.join(dir, 'crates', 'dante-core', 'src', 'engine.rs'),
    'pub fn run() -> bool { true }\n');
  await write(path.join(dir, 'pyproject.toml'),
    '[project]\nname = "dantesecurity-zoo"\nversion = "0.1.0"\n');
  // dante.py wires src/cli.py into production; src/scanner.py is deliberately UNWIRED
  // (imported only by the test file) so its T4+/T5 callsites orphan-flag deterministically.
  await write(path.join(dir, 'dante.py'),
    'from src.cli import main\n\nif __name__ == "__main__":\n    main()\n');
  await write(path.join(dir, 'src', 'cli.py'),
    'def main():\n    print("dante security harness")\n');
  await write(path.join(dir, 'src', 'scanner.py'),
    'def scan(path):\n    return ["finding"]\n');
  await write(path.join(dir, 'tests', 'test_scanner.py'),
    'from src.scanner import scan\n\ndef test_scan():\n    assert scan("samples/app.py")\n');
  await write(path.join(dir, 'tests', 'harness', 'check_sec_001.py'),
    'import sys\nprint("harness ok")\nsys.exit(0)\n');
  await write(path.join(dir, 'samples', 'app.py'), 'print("sample under scan")\n');

  const dims: ZooDim[] = [];
  // The ledger-pin dim: a T4 product run (cheap, deterministic node invocation) whose callsite
  // is orphan-flagged — the CAP-ENFORCED class that must NOT block the declarations ledger.
  dims.push(zooDim(SEC_LEDGER_DIM, {
    scores: { self: 6.0 },
    capability_test: { command: 'python tests/harness/check_sec_001.py', description: 'dante.py-style harness yardstick', timeoutMs: 30000 },
    outcomes: [{
      id: 'sec-001-t4-product-run', kind: 'shell', tier: 'T4',
      description: 'product scan run produces an observable findings line',
      command: 'node -e "console.log(\'dante scan complete: 3 findings\')"',
      expected_exit: 0, timeout_ms: 30000,
      required_callsite: 'src/scanner.py',
    }],
  }));
  // NEGATIVE-control dim: a passing-but-SEAMED T5 outcome (dishonesty class) — the ledger must refuse it.
  dims.push(zooDim(SEC_SEAMED_DIM, {
    capability_test: { command: 'python dante.py --check sec_002', description: 'harness yardstick', timeoutMs: 30000 },
    outcomes: [{
      id: 'sec-002-t5-seamed', kind: 'shell', tier: 'T5',
      description: 'seam-injected run that exits green',
      command: 'node -e "globalThis._cipCheck = true; console.log(\'seamed harness ok\')"',
      expected_exit: 0, timeout_ms: 10000,
    }],
  }));
  // T5 PRODUCT RUN with an orphan callsite: grounding must ANNOTATE it (tier kept), never de-tier.
  dims.push(zooDim(SEC_ANNOTATE_DIM, {
    capability_test: { command: 'python dante.py --check sec_003', description: 'harness yardstick', timeoutMs: 30000 },
    outcomes: [{
      id: 'sec-003-t5-product-run', kind: 'shell', tier: 'T5',
      description: 'real product scan of a realistic sample',
      command: 'python dante.py --scan samples/app.py',
      expected_exit: 0, timeout_ms: 10000,
      required_callsite: 'src/scanner.py',
    }],
  }));
  // TEST-BACKED orphan T5: the case grounding legitimately downgrades — proves de-tiers are detectable.
  dims.push(zooDim(SEC_DETIER_DIM, {
    capability_test: { command: 'python dante.py --check sec_004', description: 'harness yardstick', timeoutMs: 30000 },
    outcomes: [{
      id: 'sec-004-t5-test-backed', kind: 'shell', tier: 'T5',
      description: 'unit suite claimed as a T5 receipt',
      command: 'python -m pytest tests/test_scanner.py',
      expected_exit: 0, timeout_ms: 10000,
      required_callsite: 'src/scanner.py',
    }],
  }));
  // Three dims sharing ONE cargo target — the polyglot shared-receipt collision.
  for (const id of SEC_CARGO_DIMS) {
    dims.push(zooDim(id, {
      capability_test: { command: `python dante.py --check ${id}`, description: 'harness yardstick', timeoutMs: 30000 },
      outcomes: [{
        id: `${id}-t5-cargo`, kind: 'shell', tier: 'T5',
        description: 'cargo target claimed as this dim receipt',
        command: 'cargo test -p dante-core --lib scanner',
        expected_exit: 0, timeout_ms: 10000,
      }],
    }));
  }
  // Filler dims to reach the documented 30-dim shape (wired callsites, T4 product runs).
  for (let n = 8; n <= 29; n++) {
    const id = `sec_${String(n).padStart(3, '0')}`;
    dims.push(zooDim(id, {
      capability_test: { command: `python dante.py --check ${id}`, description: 'harness yardstick', timeoutMs: 30000 },
      outcomes: [{
        id: `${id}-t4-product-run`, kind: 'shell', tier: 'T4',
        description: 'product check run',
        command: `python dante.py --check ${id}`,
        expected_exit: 0, timeout_ms: 30000,
        required_callsite: 'src/cli.py',
      }],
    }));
  }
  // One un-scaffolded dim so the chain runs a real setup cycle.
  dims.push(zooDim(SEC_SETUP_DIM, {}));

  await writeZooMatrix(dir, zooMatrix('dantesecurity-zoo', dims));
  await initGitRepo(dir);
  await commitAll(dir, 'zoo-dantesecurity: initial');
  return dir;
}

// ── zoo-danteagents — Node monorepo, barrel-wired callsites, prior-session ledger ──

export const DA_SETUP_DIM = 'd_setup';
export const DA_LEDGERED_DIM = 'd_ledgered';
export const DA_ORPHAN_DIM = 'd_orphan';
export const DA_BARREL_DIM = 'd_barrel';
export const DA_LOST_OUTCOME = 'da-ledgered-o1';
export const DA_LEDGER_ONLY_OUTCOME = 'da-ledgered-o2';

export async function buildDanteAgentsZoo(): Promise<string> {
  const dir = path.join(ZOO_ROOT, 'danteagents');
  await write(path.join(dir, 'package.json'), JSON.stringify({
    name: 'danteagents-zoo', private: true,
    workspaces: ['packages/*'],
    devDependencies: { typescript: '^5.0.0' },
  }, null, 2) + '\n');
  await write(path.join(dir, '.gitignore'), 'node_modules/\n');
  await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
  await write(path.join(dir, 'node_modules', '.package-lock.json'), '{}\n');
  await write(path.join(dir, 'packages', 'core', 'package.json'),
    JSON.stringify({ name: '@zoo/core', main: 'src/index.ts' }, null, 2) + '\n');
  // The barrel: engine + reporter are wired THROUGH it; quality is exported by NOTHING
  // (unreachable from any entrypoint), so a T4+ callsite on it orphan-flags deterministically.
  await write(path.join(dir, 'packages', 'core', 'src', 'index.ts'),
    "export * from './engine.js';\nexport * from './reporter.js';\n");
  await write(path.join(dir, 'packages', 'core', 'src', 'engine.ts'),
    "export function runEngine(input: string): string { return 'engine:' + input; }\n");
  await write(path.join(dir, 'packages', 'core', 'src', 'reporter.ts'),
    "export function report(line: string): string { return 'report:' + line; }\n");
  await write(path.join(dir, 'packages', 'core', 'src', 'quality.ts'),
    'export function qualityScore(n: number): number { return n * 2; }\n');
  await write(path.join(dir, 'packages', 'core', 'src', 'main.ts'),
    "import { runEngine } from './index.js';\nconsole.log(runEngine('boot'));\n");

  const dims: ZooDim[] = [
    zooDim(DA_SETUP_DIM, {}), // missing capability_test → drives one real setup cycle
    zooDim(DA_LEDGERED_DIM, {
      capability_test: { command: 'node packages/core/src/main.js --check', description: 'agents yardstick', timeoutMs: 30000 },
      outcomes: [{
        id: DA_LOST_OUTCOME, kind: 'shell', tier: 'T4',
        description: 'gate-confirmed earn from a prior session',
        command: 'node -e "console.log(\'ledgered ok\')"',
        expected_exit: 0, timeout_ms: 30000,
        required_callsite: 'packages/core/src/engine.ts',
      }],
    }),
    zooDim(DA_ORPHAN_DIM, {
      capability_test: { command: 'node packages/core/src/main.js --report', description: 'agents yardstick', timeoutMs: 30000 },
      outcomes: [{
        id: 'da-orphan-t5', kind: 'runtime-exec', tier: 'T5',
        description: 'product run of the agents engine',
        command: 'node packages/core/src/main.js --report',
        expected_exit: 0, timeout_ms: 10000,
        required_callsite: 'packages/core/src/quality.ts',
      }],
    }),
    zooDim(DA_BARREL_DIM, {
      capability_test: { command: 'node packages/core/src/main.js --run', description: 'agents yardstick', timeoutMs: 30000 },
      outcomes: [{
        id: 'da-barrel-t5', kind: 'runtime-exec', tier: 'T5',
        description: 'product run anchored on a barrel-wired callsite',
        command: 'node packages/core/src/main.js --run',
        expected_exit: 0, timeout_ms: 10000,
        required_callsite: 'packages/core/src/engine.ts',
      }],
    }),
  ];
  await writeZooMatrix(dir, zooMatrix('danteagents-zoo', dims));

  // Prior-session declarations ledger: holds the matrix-declared earn (o1) PLUS one earn the
  // matrix has already lost (o2) — the recovery stock a setup rewrite must never silently kill.
  const ledgerDir = path.join(dir, '.danteforge', 'compete', 'declarations');
  await write(path.join(ledgerDir, '.gitignore'), '*\n');
  const o1 = {
    id: DA_LOST_OUTCOME, kind: 'shell', tier: 'T4',
    description: 'gate-confirmed earn from a prior session',
    command: 'node -e "console.log(\'ledgered ok\')"',
    expected_exit: 0, timeout_ms: 30000,
    required_callsite: 'packages/core/src/engine.ts',
  };
  const o2 = {
    id: DA_LEDGER_ONLY_OUTCOME, kind: 'shell', tier: 'T4',
    description: 'prior-session earn already wiped from matrix.json',
    command: 'node -e "console.log(\'ledgered second ok\')"',
    expected_exit: 0, timeout_ms: 30000,
    required_callsite: 'packages/core/src/reporter.ts',
  };
  await write(path.join(ledgerDir, `${DA_LEDGERED_DIM}.json`), JSON.stringify({
    dimensionId: DA_LEDGERED_DIM,
    outcomes: [o1, o2],
    updatedAt: new Date().toISOString(),
    recordedBy: 'validate-gate',
  }, null, 2));

  await initGitRepo(dir);
  await commitAll(dir, 'zoo-danteagents: initial');
  return dir;
}

// ── zoo-dantecode — broken pre-commit + dirty derived cache ───────────────────

export const DC_DIMS = ['dim_alpha', 'dim_beta', 'dim_gamma', 'dim_delta'];

export async function buildDanteCodeZoo(): Promise<string> {
  const dir = path.join(ZOO_ROOT, 'dantecode');
  await write(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dantecode-zoo', private: true,
    workspaces: ['packages/*'],
    dependencies: { 'left-pad': '^1.3.0' },
  }, null, 2) + '\n');
  await write(path.join(dir, '.gitignore'), 'node_modules/\n');
  await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
  await write(path.join(dir, 'node_modules', '.package-lock.json'), '{}\n');
  await write(path.join(dir, 'packages', 'app', 'package.json'),
    JSON.stringify({ name: '@zoo/app', main: 'src/index.js' }, null, 2) + '\n');
  await write(path.join(dir, 'packages', 'app', 'src', 'index.js'),
    'console.log("dantecode zoo app");\n');

  // Dirty derived cache: scores.derived persisted at a fabricated 8.6 with ZERO evidence on
  // disk — loadMatrix must drop it and the loop must plan on the honest unverified cap (5.0).
  const dims = DC_DIMS.map(id => zooDim(id, {
    scores: { self: 8.6, derived: 8.6 },
    capability_test: { command: 'node packages/app/src/index.js --check', description: 'app yardstick', timeoutMs: 30000 },
    outcomes: [{
      id: `${id}-t5`, kind: 'shell', tier: 'T5',
      description: 'claimed product run with no receipt on disk',
      command: 'node packages/app/src/index.js --run',
      expected_exit: 0, timeout_ms: 10000,
      required_callsite: 'packages/app/src/index.js',
    }],
  }));
  await writeZooMatrix(dir, zooMatrix('dantecode-zoo', dims));
  await initGitRepo(dir);
  await commitAll(dir, 'zoo-dantecode: initial');

  // Broken pre-commit pipeline (installed AFTER the initial commit): any commit attempt fails.
  await write(path.join(dir, '.git', 'hooks', 'pre-commit'),
    '#!/bin/sh\necho "pre-commit pipeline broken (zoo marker)" >&2\nexit 1\n');
  return dir;
}

// ── zoo-teardown — host repo + node_modules junction + workspace symlink chain ──

export interface TeardownHost {
  dir: string;
  nodeModules: string;
  packagesDir: string;
}

export async function buildTeardownZoo(name = 'teardown-host'): Promise<TeardownHost> {
  const dir = path.join(ZOO_ROOT, name);
  await write(path.join(dir, 'package.json'), JSON.stringify({
    name: 'teardown-zoo', private: true, workspaces: ['packages/*'],
    dependencies: { 'left-pad': '^1.3.0' },
  }, null, 2) + '\n');
  await write(path.join(dir, '.gitignore'), 'node_modules/\n');
  await write(path.join(dir, 'README.md'), '# teardown zoo host\n');
  await write(path.join(dir, 'packages', 'pkg', 'package.json'),
    JSON.stringify({ name: '@scope/pkg', main: 'lib.js' }, null, 2) + '\n');
  await write(path.join(dir, 'packages', 'pkg', 'lib.js'),
    'module.exports = { zoo: "workspace package payload" };\n');
  const nodeModules = path.join(dir, 'node_modules');
  await write(path.join(nodeModules, 'left-pad', 'package.json'),
    JSON.stringify({ name: 'left-pad', version: '1.3.0', main: 'index.js' }, null, 2) + '\n');
  await write(path.join(nodeModules, 'left-pad', 'index.js'),
    'module.exports = function leftPad(s) { return " " + s; };\n');
  // The workspace symlink chain: node_modules/@scope/pkg -> packages/pkg (a Windows junction).
  await fs.mkdir(path.join(nodeModules, '@scope'), { recursive: true });
  await fs.symlink(path.join(dir, 'packages', 'pkg'), path.join(nodeModules, '@scope', 'pkg'), 'junction');
  await initGitRepo(dir);
  await commitAll(dir, 'zoo-teardown: initial');
  return { dir, nodeModules, packagesDir: path.join(dir, 'packages') };
}

/** Sacrificial junction fixture for the NEGATIVE control: a content directory plus a junction
 *  pointing INTO it, so a delete-through-the-junction wipe can be demonstrated and detected
 *  without risking any real fixture. */
export async function buildSacrificialJunction(name = 'teardown-sacrifice'): Promise<{ target: string; junction: string }> {
  const base = path.join(ZOO_ROOT, name);
  const target = path.join(base, 'target-node-modules');
  await write(path.join(target, 'left-pad', 'index.js'), 'module.exports = 1;\n');
  await write(path.join(target, 'left-pad', 'package.json'), '{ "name": "left-pad" }\n');
  await write(path.join(target, 'lodash', 'index.js'), 'module.exports = 2;\n');
  const junction = path.join(base, 'worktree-sim', 'node_modules');
  await fs.mkdir(path.dirname(junction), { recursive: true });
  await fs.symlink(target, junction, 'junction');
  return { target, junction };
}

// ── integrity snapshot rig ────────────────────────────────────────────────────

/**
 * Byte-level snapshot of a directory tree: relative path → `sha1:<hex>` for files,
 * `link:<target>` for symlinks/junctions (NOT followed — a junction is recorded as a link,
 * never walked, so a snapshot can never recurse through it), `dir` for plain directories.
 * Two equal snapshots ⇒ the tree is byte-intact.
 */
export async function snapshotTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isSymbolicLink()) {
        let target = '';
        try { target = (await fs.readlink(abs)).replace(/\\/g, '/').toLowerCase(); } catch { target = '<unreadable>'; }
        out[rel] = `link:${target}`;
      } else if (e.isDirectory()) {
        out[rel] = 'dir';
        await walk(abs);
      } else {
        const content = await fs.readFile(abs);
        out[rel] = `sha1:${createHash('sha1').update(content).digest('hex')}`;
      }
    }
  }
  await walk(root);
  return out;
}

export async function removeZooRoot(): Promise<void> {
  await fs.rm(ZOO_ROOT, { recursive: true, force: true }).catch(() => undefined);
}
