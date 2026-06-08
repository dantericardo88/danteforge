// outcome-grounding.test.ts — the grounding engine makes a dirty suite honest:
// repoint a decoupled-but-real outcome to the wired module its seam-free test
// exercises; downgrade orphan + seamed outcomes to T2; leave the matrix gate-clean.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundOutcomes } from '../src/core/outcome-grounding.js';
import { checkOutcomeIntegrity } from '../src/matrix/engines/outcome-integrity.js';

const R = path.join('X:\\tmp', `grounding-test-${process.pid}`);

before(async () => {
  await fs.mkdir(path.join(R, 'src', 'core'), { recursive: true });
  await fs.mkdir(path.join(R, 'src', 'cli'), { recursive: true });
  await fs.mkdir(path.join(R, 'tests'), { recursive: true });
  // Production wiring: index.ts imports real-feature -> 'real-feature' is wired. orphan-feature is not.
  await fs.writeFile(path.join(R, 'src', 'cli', 'index.ts'), `import { run } from '../core/real-feature.js';\nrun();\n`, 'utf8');
  await fs.writeFile(path.join(R, 'src', 'core', 'real-feature.ts'), `export function run() {}\n`, 'utf8');
  await fs.writeFile(path.join(R, 'src', 'core', 'orphan-feature.ts'), `export function lonely() {}\n`, 'utf8');
  // Tests
  await fs.writeFile(path.join(R, 'tests', 'real.test.ts'), `import { run } from '../src/core/real-feature.js';\nrun();\n`, 'utf8');
  await fs.writeFile(path.join(R, 'tests', 'orphan.test.ts'), `import { lonely } from '../src/core/orphan-feature.js';\nlonely();\n`, 'utf8');
  await fs.writeFile(path.join(R, 'tests', 'seamed.test.ts'), `import { run } from '../src/core/real-feature.js';\nvi.mock('x');\nrun();\n`, 'utf8');
});
after(async () => { await fs.rm(R, { recursive: true, force: true }).catch(() => {}); });

describe('groundOutcomes', () => {
  it('grounds decoupled-but-real, downgrades orphan + seamed, and leaves the suite gate-clean', async () => {
    const matrix: any = {
      dimensions: [
        // Decoupled: command runs a seam-free test that imports a WIRED module, but the callsite is a test file.
        { id: 'd_decoupled', outcomes: [{ id: 'o1', tier: 'T5', command: 'npx tsx --test tests/real.test.ts', required_callsite: 'tests/real.test.ts' }] },
        // Orphan: callsite exists + tested but is NOT wired into production.
        { id: 'd_orphan', outcomes: [{ id: 'o2', tier: 'T5', command: 'npx tsx --test tests/orphan.test.ts', required_callsite: 'src/core/orphan-feature.ts' }] },
        // Seamed: test exercises a wired module but uses an injection seam (vi.mock).
        { id: 'd_seamed', outcomes: [{ id: 'o3', tier: 'T5', command: 'npx tsx --test tests/seamed.test.ts', required_callsite: 'src/core/real-feature.ts' }] },
        // Placeholder: never authored.
        { id: 'd_placeholder', outcomes: [{ id: 'o4', tier: 'T5', command: 'echo todo', required_callsite: 'TODO-set-real-callsite' }] },
      ],
    };

    const summary = await groundOutcomes({ matrix, projectPath: R });

    const byId = Object.fromEntries(summary.results.map(r => [r.dimId, r]));
    assert.equal(byId['d_decoupled']!.status, 'grounded', 'decoupled-but-real is grounded');
    assert.equal(matrix.dimensions[0].outcomes[0].required_callsite, 'src/core/real-feature.ts', 'repointed to the real wired module');
    assert.equal(matrix.dimensions[0].outcomes[0].tier, 'T5', 'a genuinely-grounded outcome KEEPS its tier');

    assert.equal(byId['d_orphan']!.status, 'downgraded');
    assert.equal(matrix.dimensions[1].outcomes[0].tier, 'T2', 'orphan outcome downgraded to T2');
    assert.equal(matrix.dimensions[1].outcomes[0].required_callsite, undefined, 'orphan callsite dropped');

    assert.equal(byId['d_seamed']!.status, 'downgraded');
    assert.equal(matrix.dimensions[2].outcomes[0].tier, 'T2', 'seamed outcome downgraded to T2');

    assert.equal(byId['d_placeholder']!.status, 'downgraded', 'TODO placeholder downgraded');

    // The whole point: after grounding, the gate is CLEAN — the score can no longer lie.
    const after = await checkOutcomeIntegrity(matrix.dimensions, R);
    const dirty = [...new Set([...after.seamedDims, ...after.decoupledDims, ...after.orphanDims])];
    assert.deepEqual(dirty, [], `suite must be gate-clean after grounding, still dirty: ${dirty.join(',')}`);
  });

  it('self-heals node:test --grep → --test-name-pattern (and leaves mocha/vitest --grep alone)', async () => {
    const matrix: any = {
      dimensions: [
        { id: 'dnode', outcomes: [{ id: 'o', tier: 'T2', command: "npx tsx --test --grep 'scorePlan' tests/x.test.ts" }] },
        { id: 'dmocha', outcomes: [{ id: 'o2', tier: 'T2', command: "npx mocha --grep 'foo' tests/y.test.ts" }] },
      ],
    };
    await groundOutcomes({ matrix, projectPath: R });
    assert.match(matrix.dimensions[0].outcomes[0].command, /--test-name-pattern 'scorePlan'/, 'node:test --grep corrected');
    assert.ok(!matrix.dimensions[0].outcomes[0].command.includes('--grep'), 'no --grep left on the node:test command');
    assert.match(matrix.dimensions[1].outcomes[0].command, /mocha --grep 'foo'/, 'mocha --grep is left untouched (valid there)');
  });

  it('self-heals a cli-smoke SCHEMA mismatch (shell-schema command → cli_args; test-runner → runtime-exec)', async () => {
    const matrix: any = {
      dimensions: [
        // a real product CLI smoke authored with the SHELL schema (command + expected_output_pattern, no cli_args)
        { id: 'dhelp', outcomes: [{ id: 'o', tier: 'T5', kind: 'cli-smoke', command: '--help', expected_output_pattern: 'Usage|Commands' }] },
        // a real product CLI with a quoted arg + binary prefix
        { id: 'dprod', outcomes: [{ id: 'o2', tier: 'T5', kind: 'cli-smoke', command: "node dist/index.js traceability --spec 'a b.md'" }] },
        // a TEST RUNNER mislabeled cli-smoke — it was never a real product smoke
        { id: 'dtest', outcomes: [{ id: 'o3', tier: 'T5', kind: 'cli-smoke', command: 'npx tsx --test tests/x.test.ts' }] },
        // an already-correct cli-smoke (cli_args present) must be left untouched
        { id: 'dok', outcomes: [{ id: 'o4', tier: 'T5', kind: 'cli-smoke', cli_args: ['plan', '--help'], expected_stdout_patterns: ['Usage'] }] },
      ],
    };
    await groundOutcomes({ matrix, projectPath: R });
    const o = matrix.dimensions[0].outcomes[0];
    assert.deepEqual(o.cli_args, ['--help'], 'shell-schema --help → cli_args');
    assert.deepEqual(o.expected_stdout_patterns, ['Usage|Commands'], 'pattern moved to expected_stdout_patterns');
    assert.equal(o.command, undefined, 'shell-schema command dropped');
    assert.deepEqual(matrix.dimensions[1].outcomes[0].cli_args, ['traceability', '--spec', 'a b.md'], 'binary prefix stripped, quoted arg kept whole');
    assert.equal(matrix.dimensions[2].outcomes[0].kind, 'runtime-exec', 'a test-runner cli-smoke is relabeled, not a fake smoke');
    assert.equal(matrix.dimensions[2].outcomes[0].command, 'npx tsx --test tests/x.test.ts', 'the test command is kept for runtime-exec');
    assert.deepEqual(matrix.dimensions[3].outcomes[0].cli_args, ['plan', '--help'], 'an already-correct cli-smoke is untouched');
  });
});
