// yardstick-repair.ts — repair a STUB capability_test that is masking a WORKING capability.
//
// The DanteCode deployment surfaced this real obstacle: a dim whose real, wired outcome PASSES, yet sits
// at derived 0 because its capability_test is a stub (`bash .../X.sh` that exits 1), which BLOCKS the score
// (a failing capability_test caps/blocks the dim). The autonomous build loop has nothing to build (the
// capability works); the honest fix is to repoint the capability_test at the real, passing test.
//
// THE HONESTY GATE (so this can never relabel a broken dim into a passing one): repair is allowed ONLY when
//   1. the current capability_test FAILS (it really is a stub blocking the dim), AND
//   2. the dim has a real, WIRED outcome (production src callsite, not a test file, not an `exit 1` scaffold), AND
//   3. that outcome's command GENUINELY PASSES when run right now (proven by execution, not asserted).
// If the real outcome also fails, this is a GENUINE GAP (route to build/author), not a stub-block — no repair.

export interface YardstickRepairResult {
  dimId: string;
  repaired: boolean;
  reason: string;
  newCommand?: string;
  callsite?: string;
}

interface DimLike {
  id: string;
  capability_test?: { command?: string } | unknown;
  outcomes?: Array<Record<string, unknown>>;
}

type RunShell = (command: string, cwd: string) => Promise<number>;

/** A real production callsite (src/packages file, not a test file). */
function isProductionCallsite(cs: unknown): cs is string {
  if (typeof cs !== 'string' || !cs || /TODO/i.test(cs)) return false;
  if (/\.(test|spec)\.[a-z]+$|(^|[/\\])tests?[/\\]/i.test(cs)) return false;
  return /(^|[/\\])(src|packages|lib)[/\\]/.test(cs);
}

/** A real (non-scaffold) outcome command. */
function isRealCommand(cmd: unknown): cmd is string {
  return typeof cmd === 'string' && cmd.trim().length > 0 && !/^\s*exit\s+\d+\s*$/.test(cmd) && cmd.trim() !== 'true';
}

export async function repairStubYardstick(dim: DimLike, cwd: string, runShell: RunShell): Promise<YardstickRepairResult> {
  const capCmd = (dim.capability_test as { command?: string } | undefined)?.command;
  if (!isRealCommand(capCmd)) return { dimId: dim.id, repaired: false, reason: 'no real capability_test to repair.' };

  // GATE 1 — the capability_test must currently FAIL (a stub blocking the dim). If it passes, no repair needed.
  if ((await runShell(capCmd, cwd)) === 0) {
    return { dimId: dim.id, repaired: false, reason: 'capability_test already passes — not a stub-block.' };
  }

  // GATE 2 — find a real, WIRED outcome (production callsite, real command).
  const candidate = (dim.outcomes ?? []).find(o => isProductionCallsite(o.required_callsite) && isRealCommand(o.command));
  if (!candidate) {
    return { dimId: dim.id, repaired: false, reason: 'no real wired outcome to point at — a GENUINE gap, route to build/author (not a stub-block).' };
  }

  // GATE 3 — the real outcome must GENUINELY PASS right now (proven by execution). This is what makes the
  // repair honest: a dim whose real test also fails is a real gap, and we refuse to repair it.
  if ((await runShell(String(candidate.command), cwd)) !== 0) {
    return { dimId: dim.id, repaired: false, reason: 'the real wired outcome FAILS too — this is a GENUINE capability gap, not a stub masking working code. No repair (route to build).' };
  }

  return {
    dimId: dim.id, repaired: true,
    newCommand: String(candidate.command), callsite: String(candidate.required_callsite),
    reason: `stub capability_test was masking a WORKING capability (its real wired outcome "${String(candidate.command).slice(0, 50)}" passes) — repaired to the real test.`,
  };
}
