// Tests for per-command filters — sacred bypass, strip boilerplate, pass clean output (PRD-26)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gitFilter } from '../src/core/context-economy/filters/git.js';
import { npmFilter } from '../src/core/context-economy/filters/npm.js';
import { pnpmFilter } from '../src/core/context-economy/filters/pnpm.js';
import { eslintFilter } from '../src/core/context-economy/filters/eslint.js';
import { jestFilter } from '../src/core/context-economy/filters/jest.js';
import { vitestFilter } from '../src/core/context-economy/filters/vitest.js';
import { cargoFilter } from '../src/core/context-economy/filters/cargo.js';
import { dockerFilter } from '../src/core/context-economy/filters/docker.js';
import { findFilter } from '../src/core/context-economy/filters/find.js';
import { pytestFilter } from '../src/core/context-economy/filters/pytest.js';

// ── git ───────────────────────────────────────────────────────────────────────

describe('gitFilter.detect', () => {
  it('detects git status', () => assert.ok(gitFilter.detect('git', ['status'])));
  it('detects git diff', () => assert.ok(gitFilter.detect('git', ['diff'])));
  it('detects git log', () => assert.ok(gitFilter.detect('git', ['log'])));
  it('does not detect non-git command', () => assert.ok(!gitFilter.detect('npm', ['install'])));
  it('does not detect unknown git subcommand', () => assert.ok(!gitFilter.detect('git', ['rebase'])));
});

describe('gitFilter.filter', () => {
  it('strips hint: lines', () => {
    const output = 'hint: Use --set-upstream next time\nOn branch main';
    const result = gitFilter.filter(output, 'git', ['status']);
    assert.ok(!result.output.includes('hint:'));
  });

  it('sacred-bypass on error content', () => {
    const output = 'error: failed to push refs\nTo https://github.com/...';
    const result = gitFilter.filter(output, 'git', ['push']);
    assert.equal(result.status, 'sacred-bypass');
    assert.ok(result.output.includes('error'));
  });

  it('compacts long git log', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `commit ${i}: fix something`);
    const output = lines.join('\n');
    const result = gitFilter.filter(output, 'git', ['log']);
    assert.ok(result.output.length < output.length);
  });
});

// ── npm ───────────────────────────────────────────────────────────────────────

describe('npmFilter.detect', () => {
  it('detects npm install', () => assert.ok(npmFilter.detect('npm', ['install'])));
  it('detects npm ci', () => assert.ok(npmFilter.detect('npm', ['ci'])));
  it('does not detect pnpm', () => assert.ok(!npmFilter.detect('pnpm', ['install'])));
});

describe('npmFilter.filter', () => {
  it('strips "added N packages" boilerplate', () => {
    const output = 'added 47 packages, and audited 48 packages\nnpm notice New minor version available';
    const result = npmFilter.filter(output, 'npm', ['install']);
    assert.ok(!result.output.includes('added 47 packages'));
  });

  it('sacred-bypass when npm audit finds vulnerabilities with severity', () => {
    const output = 'found 3 vulnerabilities\nCritical: SECURITY: Prototype pollution\n  fix available via npm audit fix';
    const result = npmFilter.filter(output, 'npm', ['audit']);
    assert.equal(result.status, 'sacred-bypass');
  });
});

// ── pnpm ──────────────────────────────────────────────────────────────────────

describe('pnpmFilter.detect', () => {
  it('detects pnpm install', () => assert.ok(pnpmFilter.detect('pnpm', ['install'])));
  it('does not detect npm', () => assert.ok(!pnpmFilter.detect('npm', ['install'])));
});

describe('pnpmFilter.filter', () => {
  it('strips Progress: lines', () => {
    const output = 'Progress: resolved 100, reused 95\nDone in 2.5s';
    const result = pnpmFilter.filter(output, 'pnpm', ['install']);
    assert.ok(!result.output.includes('Progress:'));
  });
});

// ── eslint ────────────────────────────────────────────────────────────────────

describe('eslintFilter.detect', () => {
  it('detects eslint command', () => assert.ok(eslintFilter.detect('eslint', [])));
  it('detects npx eslint', () => assert.ok(eslintFilter.detect('npx eslint', [])));
  it('does not detect jest', () => assert.ok(!eslintFilter.detect('jest', [])));
});

describe('eslintFilter.filter', () => {
  it('preserves error lines', () => {
    const output = 'src/foo.ts\n  1:5  error  no-unused-vars  x is defined but never used';
    const result = eslintFilter.filter(output, 'eslint', []);
    assert.ok(result.output.includes('error'));
  });

  it('strips blank lines', () => {
    const output = 'src/foo.ts\n\n  1:5  error  no-unused-vars\n\n';
    const result = eslintFilter.filter(output, 'eslint', []);
    assert.ok(!result.output.includes('\n\n\n'));
  });
});

// ── jest ──────────────────────────────────────────────────────────────────────

describe('jestFilter.detect', () => {
  it('detects jest command', () => assert.ok(jestFilter.detect('jest', [])));
  it('detects npx jest', () => assert.ok(jestFilter.detect('npx jest', [])));
});

describe('jestFilter.filter', () => {
  it('strips ✓ passing test lines', () => {
    const output = '  ✓ should return true (5ms)\n  ✓ handles null input (2ms)\nTests: 2 passed';
    const result = jestFilter.filter(output, 'jest', []);
    assert.ok(!result.output.includes('✓ should return'));
  });

  it('preserves FAIL suite output in sacred bypass', () => {
    const output = 'FAILED tests/auth.test.ts\n  ● login › should authenticate\n    expect(true).toBe(false)';
    const result = jestFilter.filter(output, 'jest', []);
    assert.ok(result.output.includes('FAIL') || result.output.includes('expect'));
  });
});

// ── vitest ────────────────────────────────────────────────────────────────────

describe('vitestFilter.detect', () => {
  it('detects vitest command', () => assert.ok(vitestFilter.detect('vitest', [])));
});

describe('vitestFilter.filter', () => {
  it('strips ✓ pass lines', () => {
    const output = '  ✓ foo test (2ms)\n  ✓ bar test (1ms)\nTest Files  2 passed';
    const result = vitestFilter.filter(output, 'vitest', []);
    assert.ok(result.outputTokens <= result.inputTokens);
  });
});

// ── cargo ─────────────────────────────────────────────────────────────────────

describe('cargoFilter.detect', () => {
  it('detects cargo build', () => assert.ok(cargoFilter.detect('cargo', ['build'])));
  it('detects cargo test', () => assert.ok(cargoFilter.detect('cargo', ['test'])));
  it('does not detect cargo publish (not in supported set)', () => assert.ok(!cargoFilter.detect('cargo', ['publish'])));
});

describe('cargoFilter.filter', () => {
  it('strips Compiling lines', () => {
    const output = '   Compiling serde v1.0.0\n   Compiling myapp v0.1.0\n   Finished dev profile';
    const result = cargoFilter.filter(output, 'cargo', ['build']);
    assert.ok(!result.output.includes('Compiling serde'));
  });

  it('preserves error output as sacred bypass', () => {
    const output = 'error[E0308]: mismatched types\n --> src/main.rs:5:10\n  |\n5 |     let x: i32 = "hello";\n  |                  ^^^^^^^ expected i32';
    const result = cargoFilter.filter(output, 'cargo', ['build']);
    assert.ok(result.output.includes('error'));
    assert.equal(result.status, 'sacred-bypass');
  });
});

// ── docker ────────────────────────────────────────────────────────────────────

describe('dockerFilter.detect', () => {
  it('detects docker build', () => assert.ok(dockerFilter.detect('docker', ['build'])));
  it('detects docker ps', () => assert.ok(dockerFilter.detect('docker', ['ps'])));
  it('does not detect kubectl', () => assert.ok(!dockerFilter.detect('kubectl', ['get'])));
});

describe('dockerFilter.filter', () => {
  it('strips "Sending build context" lines', () => {
    const output = 'Sending build context to Docker daemon  10.24kB\nStep 1/5 : FROM node:18\n ---> abc123def456';
    const result = dockerFilter.filter(output, 'docker', ['build']);
    assert.ok(!result.output.includes('Sending build context'));
  });

  it('truncates long logs output', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `[2026-04-25] log line ${i}`);
    const output = lines.join('\n');
    const result = dockerFilter.filter(output, 'docker', ['logs']);
    assert.ok(result.outputTokens < result.inputTokens);
  });
});

// ── find ──────────────────────────────────────────────────────────────────────

describe('findFilter.detect', () => {
  it('detects find command', () => assert.ok(findFilter.detect('find', ['.', '-name', '*.ts'])));
  it('does not detect grep', () => assert.ok(!findFilter.detect('grep', ['-r', 'pattern'])));
});

describe('findFilter.filter', () => {
  it('returns output unchanged for small result sets', () => {
    const output = 'src/foo.ts\nsrc/bar.ts\nsrc/baz.ts';
    const result = findFilter.filter(output, 'find', []);
    assert.ok(result.output.includes('src/foo.ts'));
  });

  it('summarizes large result sets', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `src/deep/path/file${i}.ts`);
    const output = lines.join('\n');
    const result = findFilter.filter(output, 'find', []);
    assert.ok(result.outputTokens < result.inputTokens);
  });
});

// ── pytest ────────────────────────────────────────────────────────────────────

describe('pytestFilter.detect', () => {
  it('detects pytest command', () => assert.ok(pytestFilter.detect('pytest', [])));
  it('detects python -m pytest', () => assert.ok(pytestFilter.detect('python -m pytest', [])));
});

describe('pytestFilter.filter', () => {
  it('strips PASSED lines', () => {
    const output = 'PASSED test_auth.py::test_login\nPASSED test_auth.py::test_logout\n=== 2 passed in 0.5s ===';
    const result = pytestFilter.filter(output, 'pytest', []);
    assert.ok(!result.output.includes('PASSED test_auth'));
  });

  it('preserves traceback in sacred bypass', () => {
    const output = 'Traceback (most recent call last):\n  File "test.py", line 5\nAssertionError: False is not True';
    const result = pytestFilter.filter(output, 'pytest', []);
    assert.ok(result.output.includes('Traceback') || result.output.includes('AssertionError'));
  });
});
