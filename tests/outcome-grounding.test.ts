// outcome-grounding.test.ts — the grounding engine makes a dirty suite honest:
// repoint a decoupled-but-real outcome to the wired module its seam-free test
// exercises; downgrade orphan + seamed TEST-BACKED outcomes to T2; ANNOTATE
// product-run outcomes (they prove by execution — kept at tier, bounded by the
// orphan cap, never de-tiered; the fleet-run-2 over-downgrade fix).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundOutcomes, PRODUCT_RUN_GROUNDING_NOTE } from '../src/core/outcome-grounding.js';
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
  it('grounds decoupled-but-real, downgrades orphan + seamed TEST-backed, annotates product runs', async () => {
    const matrix: any = {
      dimensions: [
        // Decoupled: command runs a seam-free test that imports a WIRED module, but the callsite is a test file.
        { id: 'd_decoupled', outcomes: [{ id: 'o1', tier: 'T5', command: 'npx tsx --test tests/real.test.ts', required_callsite: 'tests/real.test.ts' }] },
        // Orphan TEST-backed: callsite exists + tested but is NOT wired into production.
        { id: 'd_orphan', outcomes: [{ id: 'o2', tier: 'T5', command: 'npx tsx --test tests/orphan.test.ts', required_callsite: 'src/core/orphan-feature.ts' }] },
        // Seamed: test exercises a wired module but uses an injection seam (vi.mock).
        { id: 'd_seamed', outcomes: [{ id: 'o3', tier: 'T5', command: 'npx tsx --test tests/seamed.test.ts', required_callsite: 'src/core/real-feature.ts' }] },
        // Placeholder: never authored — a non-test command, so it is a product run to the engine
        // (annotated, bounded by the orphan cap; the honesty gate still flags the sentinel callsite).
        { id: 'd_placeholder', outcomes: [{ id: 'o4', tier: 'T5', command: 'echo todo', required_callsite: 'TODO-set-real-callsite' }] },
        // PRODUCT RUN (fleet-run-2 over-downgrade fix): a real runtime-exec invocation with an
        // orphan-flagged callsite proves by EXECUTION — it must keep tier + callsite, never de-tier.
        { id: 'd_product', outcomes: [{ id: 'o5', tier: 'T5', kind: 'runtime-exec', command: 'node dist/index.js --help', required_callsite: 'src/core/orphan-feature.ts', description: 'real product smoke' }] },
      ],
    };

    const summary = await groundOutcomes({ matrix, projectPath: R });

    const byId = Object.fromEntries(summary.results.map(r => [r.dimId, r]));
    assert.equal(byId['d_decoupled']!.status, 'grounded', 'decoupled-but-real is grounded');
    assert.equal(matrix.dimensions[0].outcomes[0].required_callsite, 'src/core/real-feature.ts', 'repointed to the real wired module');
    assert.equal(matrix.dimensions[0].outcomes[0].tier, 'T5', 'a genuinely-grounded outcome KEEPS its tier');

    assert.equal(byId['d_orphan']!.status, 'downgraded');
    assert.equal(matrix.dimensions[1].outcomes[0].tier, 'T2', 'orphan TEST-backed outcome still downgraded to T2');
    assert.equal(matrix.dimensions[1].outcomes[0].required_callsite, undefined, 'orphan callsite dropped');

    assert.equal(byId['d_seamed']!.status, 'downgraded');
    assert.equal(matrix.dimensions[2].outcomes[0].tier, 'T2', 'seamed outcome downgraded to T2');

    assert.equal(byId['d_placeholder']!.status, 'annotated', 'non-test command is a product run: annotated, not downgraded');
    assert.equal(matrix.dimensions[3].outcomes[0].tier, 'T5', 'product-run tier untouched');

    // The product run: tier + callsite kept, annotation appended, change recorded as an annotation.
    const product = matrix.dimensions[4].outcomes[0];
    assert.equal(byId['d_product']!.status, 'annotated');
    assert.equal(product.tier, 'T5', 'product run keeps T5 — proves by execution, bounded by the orphan cap');
    assert.equal(product.required_callsite, 'src/core/orphan-feature.ts', 'product-run callsite kept');
    assert.ok(product.description.includes(PRODUCT_RUN_GROUNDING_NOTE), 'annotation appended to description');
    assert.ok(product.description.startsWith('real product smoke'), 'original description preserved');
    assert.equal(byId['d_product']!.changes.length, 1);
    assert.match(byId['d_product']!.changes[0]!, /annotated/, 'recorded as an annotation, not a downgrade');

    // Idempotent: a second run adds nothing — the note appears exactly once, no new changes.
    const again = await groundOutcomes({ matrix, projectPath: R });
    const productAgain = Object.fromEntries(again.results.map(r => [r.dimId, r]))['d_product']!;
    assert.equal(productAgain.status, 'annotated');
    assert.deepEqual(productAgain.changes, [], 'second run records no new change');
    assert.equal(product.description.split(PRODUCT_RUN_GROUNDING_NOTE).length - 1, 1, 'note appended exactly once');

    // After grounding: NO dishonesty dirt remains (seam/decoupled cleared); the only
    // remaining flags are the CAP-ENFORCED orphan bounds on the product-run dims —
    // those are score caps (integrityCapFor), not grounding work.
    const after = await checkOutcomeIntegrity(matrix.dimensions, R);
    const blocking = [...new Set([...after.seamedDims, ...after.sharedReceiptDims, ...after.decoupledDims])];
    assert.deepEqual(blocking, [], `no seam/shared/decoupled dirt may remain, got: ${blocking.join(',')}`);
    assert.deepEqual([...after.orphanDims].sort(), ['d_placeholder', 'd_product'], 'product-run dims stay orphan-flagged (cap-bounded), not laundered clean');
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
