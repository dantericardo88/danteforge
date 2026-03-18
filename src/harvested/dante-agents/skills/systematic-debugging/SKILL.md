---
name: systematic-debugging
description: "Use when encountering bugs, test failures, or unexpected behavior. Use when a fix attempt has already failed. Use when the root cause is unclear."
---
# Systematic Debugging — 4-Phase Root-Cause Framework

> DanteForge skill module.

## Iron Law

**Never guess. Never apply random fixes. Follow the 4 phases in order.**

If 3+ fix attempts fail, stop and question the architecture — the bug may be a design flaw.

## Phase 1: Root Cause Investigation (NO fixes allowed)

1. **Read error messages thoroughly** — complete stack traces, not just the first line
2. **Reproduce consistently** — find the exact steps or input that trigger the bug
3. **Review recent changes** — `git diff`, new dependencies, config changes
4. **Instrument boundaries** — add logging at component boundaries to trace data flow
5. **Trace backward** — from the symptom, follow the data flow to find where bad values originate

### Root Cause Tracing (5 Steps)
1. Observe the symptom
2. Identify the immediate cause (what code produced the bad output?)
3. Ask: what called that code? What input did it receive?
4. Trace upward through the calling sequence
5. Find the original trigger (the real root cause)

## Phase 2: Pattern Analysis

1. **Find working examples** — locate similar working code in the same codebase
2. **Study completely** — read the working implementation end-to-end, not superficially
3. **List every difference** — between the working and broken code
4. **Document assumptions** — what does each implementation assume about its inputs?

## Phase 3: Hypothesis and Testing

1. **Form a specific hypothesis**: "I believe X causes Y because Z"
2. **Test with minimal change** — one variable at a time
3. **Verify results** — does the fix work? Does anything else break?
4. **If hypothesis fails** — form a new one based on what you learned (don't retry the same fix)

## Phase 4: Implementation

1. **Write a failing test** that reproduces the bug (TDD integration)
2. **Implement a single root-cause fix** — not a workaround
3. **Verify the test passes** without breaking other tests
4. **Document what you learned** — add a comment or update docs

## Escalation

If 3+ fixes fail:
- STOP fixing
- Question whether the architecture supports what you're trying to do
- Consider whether a redesign is needed
- Consult the brainstorming skill for alternative approaches

## Debugging Tips

- Use `console.error()` in tests (not loggers which may be suppressed)
- Capture stack traces with `new Error().stack`
- For async/timing bugs: add condition-based waiting, not arbitrary sleeps
- For test pollution: bisect with isolation to find the polluting test

## Red Flags
- "Let me just try this quick fix" — follow the phases
- "I think I know what's wrong" without evidence — gather evidence first
- Modifying tests to make them pass — tests define correct behavior
- Same fix attempted twice — it didn't work the first time, it won't work now
