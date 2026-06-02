import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkOrphanAudit, type CheckIO } from '../src/matrix/engines/hardener.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

// Real temp projects on X: (never C:/os.tmpdir for persistent artifacts).
const ROOT = path.join('X:\\tmp', `orphan-xlang-${process.pid}`);
const RUST = path.join(ROOT, 'rust');
const PY = path.join(ROOT, 'py');

before(async () => {
  // Rust project with src/: canary is wired into main.rs via `use crate::canary::deploy_canary`.
  await fs.mkdir(path.join(RUST, 'src'), { recursive: true });
  await fs.writeFile(path.join(RUST, 'src', 'canary.rs'), `pub fn deploy_canary() { /* tripwire */ }\n`, 'utf8');
  await fs.writeFile(path.join(RUST, 'src', 'main.rs'), `use crate::canary::deploy_canary;\nfn main() { deploy_canary(); }\n`, 'utf8');
  await fs.writeFile(path.join(RUST, 'src', 'orphan.rs'), `pub fn never_called() {}\n`, 'utf8');

  // Python project WITHOUT a top-level src/ (files at repo root) — exercises the fallback scan.
  await fs.mkdir(PY, { recursive: true });
  await fs.writeFile(path.join(PY, 'phishing.py'), `def classify_lure(x):\n    return True\n`, 'utf8');
  await fs.writeFile(path.join(PY, 'orchestrator.py'), `from phishing import classify_lure\nclassify_lure('x')\n`, 'utf8');
  // A module nothing imports or references — a genuine orphan.
  await fs.writeFile(path.join(PY, 'lonely.py'), `def solo_fn():\n    return 1\n`, 'utf8');
});

after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function dimWith(file: string, symbol: string): MatrixDimension {
  return { id: 'd', label: 'd', capability_callsite: { file, symbol } } as unknown as MatrixDimension;
}

describe('orphan-audit — cross-language (Rust/Python/Go) callsites', () => {
  test('Rust callsite wired into main.rs is NOT flagged orphan (the DanteSecurity false-cap)', async () => {
    const r = await checkOrphanAudit(dimWith('src/canary.rs', 'deploy_canary'), RUST);
    assert.equal(r.passed, true, 'a genuinely-wired Rust callsite must pass orphan-audit');
    assert.equal(r.skipped ?? false, false);
  });

  test('Rust callsite that nothing references IS still flagged orphan (rigor preserved)', async () => {
    const r = await checkOrphanAudit(dimWith('src/orphan.rs', 'never_called'), RUST);
    assert.equal(r.passed, false, 'a true orphan must still be caught — we did not weaken the gate');
    assert.ok(r.findings.length >= 1);
  });

  test('Python callsite imported via `from x import y` (no src/ dir) is NOT orphan', async () => {
    const r = await checkOrphanAudit(dimWith('phishing.py', 'classify_lure'), PY);
    assert.equal(r.passed, true, 'Python from-import wiring must be recognized via the repo-root fallback scan');
  });

  test('a Python module nothing imports or references IS flagged orphan', async () => {
    const r = await checkOrphanAudit(dimWith('lonely.py', 'solo_fn'), PY);
    assert.equal(r.passed, false, 'a module that no production file imports or references is a true orphan');
  });
});

describe('orphan-audit — self-bounding timeout (the DanteAgents 8-min hang)', () => {
  test('a scan that exceeds its budget returns a NON-blocking skip, never hangs or caps', async () => {
    // Force the deadline into the past so the first read-loop iteration trips the budget.
    const prev = process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'];
    process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'] = '-100';
    try {
      const io: CheckIO = {
        readFile: async () => 'no reference here',
        exists: async () => true,
        listFiles: async () => ['src/foo.ts'], // ignores deadline so the loop body executes
      };
      const r = await checkOrphanAudit(dimWith('src/foo.ts', 'someSymbol'), '/tmp/fake', io);
      assert.equal(r.passed, true, 'a timed-out scan must NOT block certification');
      assert.equal(r.skipped, true);
      assert.match(r.skipReason ?? '', /exceeded its budget/);
    } finally {
      if (prev === undefined) delete process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'];
      else process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'] = prev;
    }
  });
});
