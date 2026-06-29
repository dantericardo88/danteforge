---
name: supervise
description: Auto-reengage Supervisor — keep an autonomous build engine looping through transient stops (sleep, crash, provider outage, dead council member) WITHOUT a human running `resume`. Builds a project to the 8.0 technological frontier unattended, then pauses for your feedback. Use when the operator wants AFK autonomous building that does not stop over and over.
version: 1.0.0
risk: medium
source: danteforge-native
importDate: 2026-06-29
---

# DanteForge Supervise Skill

The Supervisor is the **outer loop** DanteForge was missing. Every inner engine (`autoforge`,
`crusade`, `frontier`) exits cleanly with a status and then just stops — so a campaign used to die on a
clean exit, a crash, a laptop sleep, or a provider usage-limit, and a human had to nudge it back to
life every time. `supervise` wraps an engine and **re-engages it itself** through transient stops,
pausing only when it genuinely can't self-solve.

## When to use this skill

- The operator says "build this autonomously", "don't stop", "loop until done", "AFK build".
- A long campaign keeps stopping and needs to survive sleep / crashes / outages unattended.
- You want a project driven to **8.0 (BUILD-COMPLETE)** without babysitting.

## The Command

```bash
danteforge supervise "ship the feature" --engine autoforge --target 8 --posture tiered
```

| Flag | Meaning |
|------|---------|
| `--engine` | Inner loop: `autoforge` (default) \| `crusade` \| `frontier` |
| `--target` | Score target (default **8** — the technological frontier; see below) |
| `--posture` | `tiered` (default) \| `afk` \| `notify` |
| `--max-restarts` | Hard backstop on total relaunches (default 100) |
| `--status` | Print the current campaign state and exit |
| `--stop` | Signal a running supervisor to halt cleanly on its next turn |
| `--install-keepalive` | Generate an OS keepalive (Task Scheduler / launchd / systemd) so it survives host sleep |
| `--dry-run` | Show what would loop without launching |

## The frontier contract (8 vs 9+)

**8.0 is the technological frontier the loop is allowed to reach unattended** — wired + smoke-passing,
BUILD-COMPLETE. The Supervisor's default `--target` is **8** for exactly this reason. **9+ is the
COMPETITIVE frontier and is feedback-gated:** it unlocks only AFTER the operator (or other real users)
actually use the tool at 8.0 and give feedback. So the correct, designed behavior is: build to 8.0
AFK → pause → surface for usage + feedback. The loop will not — and must not — self-award 9+.

## Tiered autonomy (what restarts vs what pauses)

- **Auto-restart (silent):** degraded council panel, provider outage (waits out the named reset),
  engine crash / docker-down, max-cycles-with-progress.
- **Pause + notify YOU:** a real capability ceiling, a policy/governance block, a budget stop, or the
  circuit breaker (too many restarts with no measured progress). Each pause is written to
  `.danteforge/ESCALATIONS.md` as a DEFINED next problem (the no-walls invariant) — never a bare wall.

## Host-sleep survival

A pure in-process loop dies with the laptop. Run once:

```bash
danteforge supervise "ship it" --install-keepalive --engine autoforge --target 8
```

This writes an OS keepalive artifact to `.danteforge/keepalive/` and prints the one-line command to
register it (Windows Task Scheduler / macOS launchd / Linux systemd). The Supervisor is idempotent
(state-singleton), so the scheduler safely re-launches it; it resumes the saved campaign.

## State & resume

Campaign state lives in `.danteforge/supervisor-state.json` (goal, target, restarts, last exit,
escalations). A crash/sleep/reboot resumes from it. Check progress with `danteforge supervise --status`;
stop cleanly with `danteforge supervise --stop`.

## Notes

- The Supervisor drives the chosen engine; quality of each cycle improves when best-of-N + self-
  scaffolding are active (see the `autoforge`/`frontier` engines).
- Outcome is `stopped-success` (target reached), `paused`/`escalated` (your turn), `stopped-operator`
  (you stopped it), or `restart-cap` (backstop hit).
