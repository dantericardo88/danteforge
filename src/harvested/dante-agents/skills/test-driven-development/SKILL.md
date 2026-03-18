---
name: test-driven-development
description: "Use when writing new features or fixing bugs. Use when modifying production code. Use when the forge command is executing tasks."
---
# Test-Driven Development — RED-GREEN-REFACTOR

> DanteForge skill module.

## Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.** Zero exceptions.

Any code written before its corresponding test must be **deleted entirely** and reimplemented starting from the test.

## The Cycle

### 1. RED — Write a Failing Test
- Write a test that describes the expected behavior
- Run the test — it MUST fail
- Confirm it fails for the **correct reason** (feature missing, not syntax error)
- If the test passes immediately, the test is wrong — rewrite it

### 2. GREEN — Minimal Implementation
- Write the absolute minimum code to make the test pass
- Do NOT write extra code "while you're in there"
- Run all tests — the new test must pass AND all existing tests must still pass

### 3. REFACTOR — Clean Up
- Improve code quality while keeping all tests green
- Extract shared logic, rename for clarity, remove duplication
- Run tests after every change — stay green

## Rationalization Blocking

| Excuse | Counter |
|--------|---------|
| "I'll write tests after" | Tests passing immediately prove nothing was tested |
| "I already manually tested it" | Ad-hoc testing cannot replace systematic verification |
| "The existing code doesn't have tests" | That's technical debt — don't add more |
| "This is just a simple change" | Simple changes break things too |
| "Just this once" | Red flag — restart the TDD cycle immediately |

## Red Flags (Immediate Stop)
- Production code written before tests — DELETE IT, start over
- Test passes immediately on first run — test is wrong
- Modifying test to match broken implementation — tests define behavior, not the reverse
- Skipping refactor phase — technical debt accumulates

## Final Verification Checklist
- [ ] Test was written first
- [ ] Test failed for the expected reason (RED)
- [ ] Minimal code written to pass (GREEN)
- [ ] All other tests still pass
- [ ] Code was cleaned up (REFACTOR)
- [ ] No test modifications to accommodate implementation
- [ ] Tests run in isolation (no shared mutable state)
- [ ] Edge cases covered

See also: `testing-anti-patterns.md` in this skill folder.
