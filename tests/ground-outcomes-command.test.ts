// ground-outcomes-command.test.ts — the command's exit-code policy (fleet run 2: the
// engine read itself as failing forever). Grounding only rewrites T5+ TEST-backed
// outcomes, but the integrity gate flags T4+ — including product runs and T4 earns it
// deliberately leaves alone. Remaining ORPHAN_CALLSITE/UNSCANNABLE flags are CAP-ENFORCED
// bounds (integrityCapFor), not grounding work → exit 0 with an honest note. Real
// dishonesty dirt (seam/shared/decoupled) still exits 1.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundOutcomesCommand } from '../src/cli/commands/ground-outcomes.js';

const R = path.join('X:\\tmp', `ground-outcomes-cmd-test-${process.pid}`);
let caseN = 0;

before(async () => {
  await fs.mkdir(R, { recursive: true });
});
after(async () => { await fs.rm(R, { recursive: true, force: true }).catch(() => {}); });

// process.exitCode hygiene: the command communicates via process.exitCode — save and
// restore around every case so a deliberate exit-1 case can't fail the test process.
let savedExitCode: number | string | undefined;
beforeEach(() => { savedExitCode = process.exitCode; process.exitCode = undefined; });
afterEach(() => { process.exitCode = savedExitCode; });

async function makeProject(dimensions: unknown[]): Promise<string> {
  const dir = path.join(R, `case-${caseN++}`);
  await fs.mkdir(path.join(dir, 'src', 'core'), { recursive: true });
  await fs.mkdir(path.join(dir, 'src', 'cli'), { recursive: true });
  await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
  await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
  // Production wiring: index.ts imports real-feature → wired; orphan-feature is NOT wired.
  await fs.writeFile(path.join(dir, 'src', 'cli', 'index.ts'), `import { run } from '../core/real-feature.js';\nrun();\n`, 'utf8');
  await fs.writeFile(path.join(dir, 'src', 'core', 'real-feature.ts'), `export function run() {}\n`, 'utf8');
  await fs.writeFile(path.join(dir, 'src', 'core', 'orphan-feature.ts'), `export function lonely() {}\n`, 'utf8');
  await fs.writeFile(path.join(dir, 'tests', 'orphan.test.ts'), `import { lonely } from '../src/core/orphan-feature.js';\nlonely();\n`, 'utf8');
  await fs.writeFile(
    path.join(dir, '.danteforge', 'compete', 'matrix.json'),
    JSON.stringify({ project: 't', dimensions }, null, 2) + '\n',
    'utf8',
  );
  return dir;
}

describe('groundOutcomesCommand exit-code policy', () => {
  it('exits 0 when ONLY cap-enforced orphan flags remain (product runs + T4 earns grounding does not rewrite)', async () => {
    const dir = await makeProject([
      // T5 product run with an unwired callsite: grounding ANNOTATES (keeps tier), the
      // orphan flag remains — it is a score cap, not grounding work.
      { id: 'd_product', outcomes: [{ id: 'o1', tier: 'T5', kind: 'runtime-exec', command: 'node dist/index.js --help', required_callsite: 'src/core/orphan-feature.ts' }] },
      // T4 TEST-backed earn: below the T5+ grounding loop, orphan-flagged by the T4+ gate —
      // grounding deliberately leaves it alone.
      { id: 'd_t4', outcomes: [{ id: 'o2', tier: 'T4', command: 'npx tsx --test tests/orphan.test.ts', required_callsite: 'src/core/orphan-feature.ts' }] },
    ]);

    await groundOutcomesCommand({ project: dir });
    assert.equal(process.exitCode ?? 0, 0, 'cap-enforced orphan flags must read CLEAN-FOR-GROUNDING (exit 0)');
  });

  it('still exits 1 on seam dirt that survives grounding (a seamed product-run command)', async () => {
    const dir = await makeProject([
      // The command STRING itself carries an injection seam (_cipCheck) — a seamed product
      // run is annotated (tier kept), so the SEAM_USAGE membership survives the re-check.
      // That is dishonesty dirt, not a cap-enforced bound → exit 1.
      { id: 'd_seamed_product', outcomes: [{ id: 'o1', tier: 'T5', kind: 'runtime-exec', command: 'node -e "globalThis._cipCheck = 1; process.exit(0)"', required_callsite: 'src/core/real-feature.ts' }] },
    ]);

    await groundOutcomesCommand({ project: dir });
    assert.equal(process.exitCode, 1, 'seam dirt must still fail the command');
  });

  it('exits 0 with nothing flagged at all (clean suite)', async () => {
    const dir = await makeProject([
      { id: 'd_clean', outcomes: [{ id: 'o1', tier: 'T2', command: 'node -e "process.exit(0)"' }] },
    ]);

    await groundOutcomesCommand({ project: dir });
    assert.equal(process.exitCode ?? 0, 0);
  });

  it('exits 1 when there is no matrix', async () => {
    const dir = path.join(R, `case-${caseN++}-empty`);
    await fs.mkdir(dir, { recursive: true });
    await groundOutcomesCommand({ project: dir });
    assert.equal(process.exitCode, 1);
  });
});
