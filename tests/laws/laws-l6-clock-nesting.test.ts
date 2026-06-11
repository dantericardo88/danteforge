// LAW L6 — Clock nesting: every outer timeout strictly exceeds the sum of its inner budgets +
// slack, over the REAL command lists the orchestrator emits (zero seams needed — pure functions).
//
// Pins the fleet-run-2 dead-loop: the inner 30m per-dim autoresearch budget equaled the outer 30m
// tree-kill cap, so the kill always landed mid-cycle, nothing persisted, and two repos restarted
// at dim001 forever. The fix is the triplet (--time 18, --max-minutes 55, 60m phase cap); this law
// derives the constraints FROM the emitted args + phaseTimeoutMs — it hard-codes none of them, and
// it FAILS if someone reverts --time toward 30 or shrinks the 60m cap.
//
// NEGATIVE CONTROLS: the pre-fix shapes are replayed through the same checker and must TRIP.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupCommands, buildTo7Commands } from '../../src/cli/commands/ascend-frontier.js';
import { phaseTimeoutMs } from '../../src/cli/commands/ascend-frontier-runner.js';
import { checkClockNesting, parseDeclaredBudgetsMin, CLOCK_SLACK_MINUTES } from './rig.js';

function allEmittedCommands(): string[][] {
  return [
    ...setupCommands(false, []),
    ...setupCommands(true, ['claude-code', 'codex']),
    ...buildTo7Commands(false, [], ['dim_a', 'dim_b']),
    ...buildTo7Commands(true, ['claude-code', 'codex'], ['dim_a']),
  ];
}

describe('L6 — the law holds over every REAL emitted command list', () => {
  test('phaseTimeoutMs(cmd) exceeds every declared inner budget + slack, for every emitted command', () => {
    const commands = allEmittedCommands();
    assert.ok(commands.length >= 8, `the emitters produced a real command set (got ${commands.length})`);
    for (const args of commands) {
      const violations = checkClockNesting(args, phaseTimeoutMs(args));
      assert.deepEqual(violations, [], `clock-nesting violations for "${args.join(' ')}"`);
    }
  });

  test('the build phase REALLY declares its budgets (the law is not vacuously passing)', () => {
    const build = buildTo7Commands(false, [], ['dim_a']);
    const crusade = build.find(a => a[0] === 'harden-crusade');
    assert.ok(crusade, 'build-to-7 emits a harden-crusade command');
    const { time, maxMinutes } = parseDeclaredBudgetsMin(crusade!);
    assert.ok(time !== undefined, 'a per-cycle --time budget is declared');
    assert.ok(maxMinutes !== undefined, 'a --max-minutes checkpoint budget is declared');
    assert.ok(crusade!.includes('--loop'), 'the loop flag is present, so the checkpoint rule is load-bearing');
    // Derived relations only — no literal pinned:
    const outer = phaseTimeoutMs(crusade!);
    assert.ok(outer > (maxMinutes! + CLOCK_SLACK_MINUTES) * 60_000,
      `the phase kill cap (${outer / 60_000}m) clears the checkpoint budget (${maxMinutes}m) + slack — the clean exit always beats the kill`);
    assert.ok(2 * (time! + CLOCK_SLACK_MINUTES) <= maxMinutes!,
      `at least two full cycles (2×(${time}+${CLOCK_SLACK_MINUTES})m) fit inside --max-minutes ${maxMinutes}m`);
  });

  test('crusade phases get a strictly larger kill cap than ordinary sub-commands', () => {
    // Relation, not literals: the dead-loop fix gave build phases headroom over the uniform cap.
    assert.ok(phaseTimeoutMs(['harden-crusade']) > phaseTimeoutMs(['ground-outcomes', '--apply']));
    assert.ok(phaseTimeoutMs(['council-crusade']) > phaseTimeoutMs(['validate', 'x']));
  });
});

describe('L6 — NEGATIVE controls: the pre-fix shapes TRIP the checker', () => {
  test('the original dead-loop (inner 30m == outer 30m, no checkpoint) fails on BOTH rules', () => {
    const oldShape = ['harden-crusade', '--parallel', '1', '--loop', '--target', '7', '--time', '30'];
    const violations = checkClockNesting(oldShape, 30 * 60_000);
    assert.ok(violations.some(v => v.includes('dead-loop')), `R1 (inner==outer) trips: ${violations.join(' | ')}`);
    assert.ok(violations.some(v => v.includes('--max-minutes checkpoint')), `R2 (no checkpoint) trips: ${violations.join(' | ')}`);
  });

  test('reverting --time toward the old 30 (keeping everything else) fails the two-cycle rule', () => {
    const current = buildTo7Commands(false, [], ['dim_a']).find(a => a[0] === 'harden-crusade')!;
    const reverted = current.map((tok, i) => (current[i - 1] === '--time' ? '30' : tok));
    const violations = checkClockNesting(reverted, phaseTimeoutMs(reverted));
    assert.ok(violations.some(v => v.includes('fewer than 2 full cycles')),
      `the --time revert must fail the law: ${violations.join(' | ')}`);
  });

  test('shrinking the build-phase kill cap back to the uniform 30m fails against the emitted budgets', () => {
    const current = buildTo7Commands(false, [], ['dim_a']).find(a => a[0] === 'harden-crusade')!;
    const violations = checkClockNesting(current, 30 * 60_000);
    assert.ok(violations.some(v => v.includes('does NOT exceed inner --max-minutes')),
      `a shrunken cap must fail the law: ${violations.join(' | ')}`);
  });
});
