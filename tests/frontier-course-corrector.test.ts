// frontier-course-corrector.test.ts — the evidence-only stall classifier.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseStall, isCeiling, routeStallAction, resolveStall, diagnoseStallFromProject, MAX_COURSE_CORRECTIONS, type StallInputs } from '../src/core/frontier-course-corrector.js';

const base = (over: Partial<StallInputs> = {}): StallInputs => ({
  dimId: 'd', scoreBefore: 7, scoreAfter: 7,
  commands: [{ command: 'npx tsx --test tests/x.test.ts', exitCode: 0 }],
  gateFailures: [], integrityViolations: [], filesChanged: 3, attemptsSoFar: 0,
  ...over,
});

// routeStallAction now also carries decomposed `children` for retry-decompose (a wall → worklist of sub-problems).
// These assertions check the ACTION shape, not the dynamic child list — `ep` extracts the actionable fields.
const ep = (r: { exec: string | null; plateau: boolean }) => ({ exec: r.exec, plateau: r.plateau });

describe('resolveStall — Richard\'s DNA in the stall brain: env blocker is a problem, not a wall', () => {
  const envBlocked = () => diagnoseStall(base({ commands: [{ command: 'pdftotext in.pdf out.txt', exitCode: 127 }] }));

  it('an env-blocked stall is routed to the registry; SOLVED → un-plateau + retry (not a wall)', async () => {
    let routed = false;
    const r = await resolveStall(envBlocked(), '/x', { _solve: async () => { routed = true; return { solved: true }; } });
    assert.equal(routed, true, 'the unbuildable stall is routed through solveObstacle, not plateaued outright');
    assert.equal(r.plateau, false);
    assert.equal(r.solvedByRegistry, true);
  });

  it('env-blocked but the registry genuinely can\'t solve it → the honest ceiling stands (only AFTER trying)', async () => {
    const r = await resolveStall(envBlocked(), '/x', { _solve: async () => ({ solved: false }) });
    assert.equal(r.plateau, true, 'honest ceiling, but it tried 3 solutions first');
    assert.notEqual(r.solvedByRegistry, true);
  });

  it('a non-env stall (wrong-approach) keeps the gated path — the registry is NOT invoked', async () => {
    let routed = false;
    const wrongApproach = diagnoseStall(base({ filesChanged: 5 })); // clean build, score held → wrong-approach
    const r = await resolveStall(wrongApproach, '/x', { _solve: async () => { routed = true; return { solved: true }; } });
    assert.equal(routed, false, 'honesty/score stalls are not registry-auto-solvable by design');
    assert.deepEqual({ exec: r.exec, plateau: r.plateau }, ep(routeStallAction(wrongApproach)));
  });
});

describe('diagnoseStall — evidence-only, bounded', () => {
  it('budget exhausted → honest-ceiling (no infinite churn)', () => {
    const d = diagnoseStall(base({ attemptsSoFar: MAX_COURSE_CORRECTIONS }));
    assert.equal(d.category, 'honest-ceiling');
    assert.equal(d.action, 'honest-ceiling');
    assert.ok(isCeiling(d));
  });

  it('command-not-found (exit 127) → unbuildable / mark-unbuildable', () => {
    const d = diagnoseStall(base({ commands: [{ command: 'pdftotext in.pdf out.txt', exitCode: 127 }] }));
    assert.equal(d.category, 'unbuildable');
    assert.equal(d.action, 'mark-unbuildable');
    assert.ok(isCeiling(d));
  });

  it('build command failed (real non-zero) → build-failed / retry-decompose', () => {
    const d = diagnoseStall(base({ commands: [{ command: 'npm run build', exitCode: 2 }] }));
    assert.equal(d.category, 'build-failed');
    assert.equal(d.action, 'retry-decompose');
  });

  it('ORPHAN_CALLSITE persists → orphan-still / ground-orphan', () => {
    const d = diagnoseStall(base({ integrityViolations: [{ kind: 'ORPHAN_CALLSITE', detail: 'foo.ts not imported by production' }] }));
    assert.equal(d.category, 'orphan-still');
    assert.equal(d.action, 'ground-orphan');
  });

  it('CALLSITE_DECOUPLED / SEAM_USAGE persists → wrong-outcome / fix-outcome', () => {
    const a = diagnoseStall(base({ integrityViolations: [{ kind: 'CALLSITE_DECOUPLED', detail: 'test does not reference callsite' }] }));
    assert.equal(a.category, 'wrong-outcome');
    assert.equal(a.action, 'fix-outcome');
    const b = diagnoseStall(base({ integrityViolations: [{ kind: 'SEAM_USAGE', detail: 'seamed test' }] }));
    assert.equal(b.category, 'wrong-outcome');
  });

  it('clean commands but ZERO files changed → no-op-build', () => {
    const d = diagnoseStall(base({ filesChanged: 0 }));
    assert.equal(d.category, 'no-op-build');
    assert.equal(d.action, 'retry-decompose');
  });

  it('a non-integrity gate rejected the work → wrong-approach', () => {
    const d = diagnoseStall(base({ gateFailures: [{ gateName: 'no-stub-scanner', detail: 'stub found' }] }));
    assert.equal(d.category, 'wrong-approach');
    assert.equal(d.action, 'retry-decompose');
  });

  it('files changed + clean + no integrity issue but score held → wrong-approach', () => {
    const d = diagnoseStall(base({ filesChanged: 5 }));
    assert.equal(d.category, 'wrong-approach');
  });

  it('integrity orphan takes precedence over a clean-but-unmoved build', () => {
    const d = diagnoseStall(base({ filesChanged: 9, integrityViolations: [{ kind: 'ORPHAN_CALLSITE', detail: 'x' }] }));
    assert.equal(d.category, 'orphan-still');
  });

  it('INVARIANT: every diagnosis carries at least one hard fact (never prose-only)', () => {
    const cases: StallInputs[] = [
      base({ attemptsSoFar: 5 }),
      base({ commands: [{ command: 'x', exitCode: 127 }] }),
      base({ commands: [{ command: 'npm run build', exitCode: 1 }] }),
      base({ integrityViolations: [{ kind: 'ORPHAN_CALLSITE', detail: 'x' }] }),
      base({ integrityViolations: [{ kind: 'SEAM_USAGE', detail: 'x' }] }),
      base({ filesChanged: 0 }),
      base({ gateFailures: [{ gateName: 'taste-gate' }] }),
      base({ filesChanged: 4 }),
    ];
    for (const c of cases) {
      const d = diagnoseStall(c);
      assert.ok(d.evidence.length >= 1, `${d.category} must cite evidence`);
      assert.ok(d.rationale.length > 0);
    }
  });
});

describe('routeStallAction — diagnosis → bounded self-correcting action', () => {
  it('orphan/wrong-outcome → run ground-outcomes, then RETRY (not plateau)', () => {
    const orphan = routeStallAction(diagnoseStall(base({ integrityViolations: [{ kind: 'ORPHAN_CALLSITE', detail: 'x' }] })));
    assert.deepEqual(orphan, { exec: 'ground-outcomes --apply', plateau: false });
    const decoupled = routeStallAction(diagnoseStall(base({ integrityViolations: [{ kind: 'CALLSITE_DECOUPLED', detail: 'x' }] })));
    assert.deepEqual(decoupled, { exec: 'ground-outcomes --apply', plateau: false });
  });
  it('wrong-approach / no-op → retry, no command, no plateau', () => {
    assert.deepEqual(ep(routeStallAction(diagnoseStall(base({ filesChanged: 4 })))), { exec: null, plateau: false });
    assert.deepEqual(ep(routeStallAction(diagnoseStall(base({ filesChanged: 0 })))), { exec: null, plateau: false });
  });
  it('unbuildable / budget-exhausted → PLATEAU (honest ceiling), no retry', () => {
    assert.deepEqual(routeStallAction(diagnoseStall(base({ commands: [{ command: 'x', exitCode: 127 }] }))), { exec: null, plateau: true });
    assert.deepEqual(routeStallAction(diagnoseStall(base({ attemptsSoFar: MAX_COURSE_CORRECTIONS }))), { exec: null, plateau: true });
  });
});

describe('diagnoseStallFromProject — gathers live evidence (seamed)', () => {
  it('routes an orphan violation to orphan-still even with no repo (best-effort I/O)', async () => {
    const d = await diagnoseStallFromProject({
      cwd: '/nonexistent', dimId: 'd', scoreBefore: 7, scoreAfter: 7, attemptsSoFar: 0,
      _integrityViolations: async () => [{ kind: 'ORPHAN_CALLSITE', detail: 'foo not wired' }],
      _changedFiles: async () => 3,
    });
    assert.equal(d.category, 'orphan-still');
    assert.deepEqual(routeStallAction(d), { exec: 'ground-outcomes --apply', plateau: false });
  });
  it('clean integrity + zero changed files → no-op-build (retry)', async () => {
    const d = await diagnoseStallFromProject({
      cwd: '/nonexistent', dimId: 'd', scoreBefore: 7, scoreAfter: 7, attemptsSoFar: 0,
      _integrityViolations: async () => [], _changedFiles: async () => 0,
    });
    assert.equal(d.category, 'no-op-build');
  });
  it('threaded command exit codes un-blind the build-failed branch (was structurally impossible with commands:[])', async () => {
    const d = await diagnoseStallFromProject({
      cwd: '/nonexistent', dimId: 'd', scoreBefore: 7, scoreAfter: 7, attemptsSoFar: 0,
      commands: [{ command: 'forge (build)', exitCode: 1 }],
      _integrityViolations: async () => [], _changedFiles: async () => 0,
    });
    assert.equal(d.category, 'build-failed');
    assert.deepEqual(ep(routeStallAction(d)), { exec: null, plateau: false }); // retry-decompose, don't burn budget on the wrong fix
  });

  it('budget exhausted → honest ceiling regardless of evidence', async () => {
    const d = await diagnoseStallFromProject({
      cwd: '/nonexistent', dimId: 'd', scoreBefore: 7, scoreAfter: 7, attemptsSoFar: MAX_COURSE_CORRECTIONS,
      _integrityViolations: async () => [{ kind: 'ORPHAN_CALLSITE', detail: 'x' }], _changedFiles: async () => 3,
    });
    assert.ok(isCeiling(d));
  });
});
