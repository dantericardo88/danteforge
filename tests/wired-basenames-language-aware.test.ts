// wired-basenames-language-aware.test.ts — buildWiredBasenames is the load-bearing input to the
// ORPHAN_CALLSITE gate (caps T4+ at 7.0 fleet-wide). It must recognize PRODUCTION wiring in every
// language the fleet targets (JS/TS/Python/Rust/Go), exclude test files (a test import is not
// production wiring), and NOT over-credit. JS/TS behavior must stay byte-for-byte.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildWiredBasenames } from '../src/matrix/engines/outcome-integrity.js';

const R = path.join(os.tmpdir(), `wired-basenames-${process.pid}`);

before(async () => {
  const w = async (rel: string, content: string): Promise<void> => {
    const p = path.join(R, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  };
  // Python production: imports a local module → its basename is wired.
  await w('src/app.py', 'from core.phishing_simulator import PhishingSimulator\nimport util.budget_meter\n');
  // Python TEST file: its import must NOT count as production wiring.
  await w('tests/test_app.py', 'from core.secret_unwired import Lonely\n');
  // Rust production: `mod` declares a module, `use` references segments (crate/super/self excluded).
  await w('src/main.rs', 'mod escape_detector;\nuse crate::budget::BudgetEnforcer;\nuse super::ignored_kw;\n');
  // Go production: quoted import path → basename wired. Its _test.go sibling must be excluded.
  await w('cmd/server/main.go', 'import "myapp/pkg/injection_scanner"\n');
  await w('cmd/server/server_test.go', 'import "myapp/pkg/test_only_dep"\n');
  // JS/TS production (preserved path): relative import → basename wired.
  await w('src/index.ts', "import { run } from './core/real_feature.js';\nrun();\n");
});
after(async () => { await fs.rm(R, { recursive: true, force: true }).catch(() => {}); });

describe('buildWiredBasenames — language-aware production wiring', () => {
  test('recognizes Python / Rust / Go / JS-TS production imports, excludes test files, does not over-credit', async () => {
    const wired = await buildWiredBasenames(R);

    // Python: last dotted segment of each production import.
    assert.ok(wired.has('phishing_simulator'), 'python `from core.phishing_simulator import` → wired');
    assert.ok(wired.has('budget_meter'), 'python `import util.budget_meter` → wired');

    // Rust: mod name + each use-path segment (minus crate/super/self).
    assert.ok(wired.has('escape_detector'), 'rust `mod escape_detector;` → wired');
    assert.ok(wired.has('budget') && wired.has('BudgetEnforcer'), 'rust `use crate::budget::BudgetEnforcer` segments → wired');
    assert.ok(!wired.has('crate'), 'rust keyword `crate` is NOT credited as a module');

    // Go: basename of the quoted import path.
    assert.ok(wired.has('injection_scanner'), 'go `import "myapp/pkg/injection_scanner"` → wired');

    // JS/TS preserved.
    assert.ok(wired.has('real_feature'), 'ts relative import preserved → wired');

    // Test-file imports are NOT production wiring (the anti-over-credit guard).
    assert.ok(!wired.has('secret_unwired'), 'a module imported ONLY by a Python test file is NOT wired');
    assert.ok(!wired.has('test_only_dep'), 'a module imported ONLY by a Go _test.go file is NOT wired');
  });
});
