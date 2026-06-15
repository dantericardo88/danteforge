# Universe: UX Polish & Onboarding
Generated: 2026-06-15T00:00:00.000Z
Researched by: claude

## OSS Leader
**Name**: Aider
**URL**: https://github.com/Aider-AI/aider
**Key capability**: A terminal-native coding agent whose first-run experience is near-frictionless — `pip install aider-chat` then `aider` drops you into a working session that auto-detects the git repo, shows a clear colorized diff of every edit, asks before committing, and explains what it did in plain language. Onboarding requires no config file; sensible defaults work immediately; errors are phrased as next steps, not stack traces. The transferable capability is that a brand-new user reaches a real, reviewable code change within a minute and never sees a raw traceback or an unexplained failure.

## Closed-Source Leader (if known)
**Name**: Cursor
**URL**: https://cursor.com
**Key capability**: Category-defining onboarding + polish: a guided first-run that imports existing editor settings, instant legible feedback for every action, progressive disclosure (simple by default, depth on demand), inline help, and operator surfaces that never crash or dead-end. New users reach value with zero documentation and consistently cite the experience as best-in-class. For DanteForge the transferable bar is not the editor — it is the standard that every command degrades gracefully, every error names the next step, and a newcomer is guided to a first real outcome without reading source.

## Score Ladder
| Score | Evidence required for UX Polish & Onboarding |
|-------|----------------------------------------------|
| 5 | A CLI exists and runs core workflows, but output is dense/raw, failures surface as stack traces, flags are inconsistent, and a new user must read the source or ask a maintainer to get started. No first-run guidance. |
| 6 | Output is formatted (color, tables, spinners); most errors are human messages rather than tracebacks; a `flow`/guide command and a README quickstart exist; but operator surfaces still crash on edge cases (empty/partial/hand-edited state), some flags are undiscoverable, and onboarding is "read the docs." |
| 7 | Current DanteForge level: consistent command structure with `--help`, a workflow picker (`danteforge flow`), progress indication, and a generated guide. Cap remains because operator surfaces still have rough edges (a report/status command can crash on malformed or empty state), there is no guided first-run wizard, several errors state what failed but not the next step, and a newcomer still needs tribal knowledge to reach first value. |
| 8 | Zero rough edges on operator surfaces: every command degrades gracefully on empty/partial/stale/hand-edited state (never an uncaught crash), and every failure names a concrete next step. A guided first-run (`danteforge init`/`flow` wizard) takes a new user from clone to a first real outcome in under five minutes without reading docs. Flags are consistent and discoverable; a smoke check exercises the top operator commands so a crash is caught before release. |
| 9 | Cursor/Aider-grade polish: instant, legible feedback for every action; a cohesive status/dashboard view that answers "what is running, what changed, what passed, what failed, what's next" in one place; progressive disclosure (sensible zero-config defaults, depth on demand); in-context help and "did you mean" for mistyped commands; onboarding that adapts to the detected project type and gets an unaided newcomer to a real outcome. |
| 10 | Category-defining onboarding + polish, EXTERNALLY VALIDATED: the 9.0 experience is confirmed by real first-time users (not the authors) — a recorded usability session or task-completion telemetry showing they reach a real outcome with zero documentation, plus a satisfaction signal (survey/NPS) — and the experience is independently cited as best-in-class for agentic dev tools, the bar competitors are measured against. |

## What practitioners say (Reddit/Twitter/HN)
- Recurring praise for Aider/Cursor centers on "it just worked the first time" and "the diff/feedback is always clear" — onboarding friction and opaque failures are the most common complaints about competing agentic CLIs.
- For agentic dev tools specifically, the loudest UX complaints are uncaught crashes on real-world repo state, errors that don't say what to do next, and the need to read source/docs to get started — which is exactly what the 7→8 rung above targets.

## Notes
UX Polish & Onboarding is graded on the OPERATOR experience of DanteForge itself (its CLI surfaces,
errors, onboarding, and feedback), not on UI it generates for others. The 7-cap is honest: live operator
surfaces have crashed on malformed/empty state (e.g. `compete --report` on a dimension lacking
sprint_history), and there is no guided first-run wizard yet. Reaching 8.0 is concrete and bounded —
crash-proof operator surfaces + an actionable-error pass + a guided first-run + a CLI-smoke that exercises
the top commands.
