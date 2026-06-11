# Seam Hardening Plan — find the bugs before the run does

**Thesis (operator, 2026-06-11):** the fleet's bugs live at the SEAMS between verified components —
contracts, invariants, fixture-representativeness — not inside the components. Five of the six
classes found by live fleet runs 1–2 were preemptively catchable with the right machinery. This
plan makes every discovered class a permanent preemptive check, so live runs only sample the
irreducible OS-race residue.

## Evidence (what live runs found vs what would have caught it)

| Live bug | Class | Preemptive catcher |
|---|---|---|
| inner 30m budget == outer 30m kill cap (dead-loop) | constant contract | LAW L6 (timeout nesting) |
| git ops on main tree under isolation | stated-but-unchecked invariant | LAW L1 + recording-seam drive-through |
| grounding de-tiered product runs | property over input space | LAW L5 |
| declarations ledger inert fleet-wide | unrepresentative fixtures | FLEET ZOO (orphan-flagged stock) |
| junction wipe ate node_modules + packages/ | destructive-op blast radius | ZOO fault-injection teardown case |
| kill/spawn PID reuse race | OS timing | residue — chaos sampling only |

## Component 1 — THE LAWS (tests/laws/*.test.ts)

Machine-checked global invariants, driven through the REAL orchestrator flows with recording
seams (fake work layer, real coordination layer). The existing exemplar is the score-write grep
gate — since it exists, that bug class has never recurred.

- **L1 — Isolation:** under `--isolate`, no git mutation ever addresses the user's tree
  (recording GitFn drive-through of setup → experiment → rollback → merge-back; pins
  `bindGitToCwd` + `assertGitTargetNotUserTree` end-to-end, not just unit).
- **L2 — Score writes:** nothing raises a persisted score except `writeVerifiedScore`
  (extends the existing grep gate with a runtime drive-through: run setup/build/push flows with
  seams, snapshot matrix scores at every step, assert no step raised any score outside the gate).
- **L3 — Declaration durability:** no flow (setup, grounding, migration, reset-simulation)
  silently REMOVES a gate-confirmed declaration — every removal is a tombstone or a loud
  declarations-lost event.
- **L4 — Process hygiene:** every spawn in a flow is tracked and reaped on exit/timeout
  (recording spawn seam; assert track/untrack pairing and killTree on every timeout path).
- **L5 — Evidence honor:** execution-proven evidence (runtime-exec/cli-smoke product runs) is
  never de-tiered by any automated pass; bounding is only ever by CAP. Test-backed evidence may
  be downgraded only with provenance in `changes[]`.
- **L6 — Clock nesting:** every outer timeout strictly exceeds the sum of its inner budgets +
  slack: `phaseTimeoutMs(cmd) > innerBudget(cmd) + 2m` for every command buildTo7Commands /
  setupCommands emit. Pure function over the REAL command lists — zero seams needed.
- **L7 — Flag wiring:** every option an orchestrator passes on a CLI string is accepted by the
  target command's registration (parse the emitted args against the commander definitions —
  catches passed-but-unwired flags).

## Component 2 — THE FLEET ZOO (tests/zoo/*.test.ts + tests/zoo/fixtures.ts)

Fixture repos replicating each fleet repo's REAL shape, run through the whole chain
(`runAscendFrontier` with seamed agents — real coordination, no LLM cost) in CI seconds:

- `zoo-dantesecurity`: polyglot (Cargo.toml + pyproject), 130+ dims, dante.py-style harness
  yardsticks, orphan-flagged T4 stock, cargo targets as receipts.
- `zoo-danteagents`: Node monorepo, barrel-wired callsites (orphan-flagged), product-run T5
  outcomes, prior-session declarations to protect.
- `zoo-dantecode`: monorepo with a BROKEN pre-commit pipeline + a binary-shim package, dirty
  matrix derived cache.
- `zoo-cold`: zero-dep BOM'd package.json, README usage block, no .danteforge at all.
- `zoo-teardown`: worktree with node_modules junction + workspace symlink chain — run EVERY
  cleanup path, assert host node_modules/packages integrity afterward (the junction-wipe pin).

Each zoo case asserts: terminal state is honest, ledger bundle complete, no law violated,
declarations recorded where expected, and the run's actions match the repo's shape.

## Component 3 — REHEARSAL MODE (`ascend-frontier --rehearse`)

Extends dry-run from "print next action" to "execute the FULL coordination layer with the work
layer stubbed by recording fakes": define/setup/build/push all run their real sequencing, git
operations, ledger writes, and state transitions; agent dispatch + outcome execution return
scripted results. The laws are asserted continuously. An operator (or the fleet prompt's Phase 1)
runs `--rehearse` before a live run: minutes, no LLM cost, catches coordination bugs preemptively.
Built AFTER laws+zoo land (it reuses their recording-seam rig and touches ascend-frontier.ts).

## Sequencing

1. ✅ Fleet-run-2 engine fixes landed first (2a03d7a) — laws pin FIXED behavior.
2. Laws (L1–L7) + Zoo — parallel build, new test files only.
3. Rehearsal mode — after laws land; wires the rig into `--rehearse`.
4. CI: laws+zoo join `npm run verify` (fast); chaos sampling (random phase kills) stays a
   nightly/manual lane — it samples the OS-race residue, the one class only execution finds.

## The standing rule (process, not code)

Every future live-run failure gets promoted into: (1) a fix, (2) a regression pin, and (3) where
generalizable, a LAW or ZOO case — so each class is found preemptively forever after. A live run
should only ever discover a class once.
