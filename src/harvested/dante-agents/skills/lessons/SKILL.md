---
name: lessons
description: "Use after any user correction, failed verification, or mistake during forge/party/verify. Automatically captures lessons learned into .danteforge/lessons.md so the same mistake never happens again. Use when the agent makes errors, when naming conventions are wrong, when tests fail repeatedly, or when workflow patterns need refinement."
---
# Lessons Self-Improvement

> DanteForge skill module — captures corrections and mistakes into persistent lessons so they never recur.

## When to Use

- After any user correction ("that's wrong", "use X instead of Y")
- After failed verification checks (verify command detects failures)
- After forge/party wave failures (tasks that didn't pass)
- After naming convention mistakes (wrong casing, bad variable names)
- After workflow missteps (wrong command order, missing gates)
- When `tech-decide` reveals naming style preferences

## Iron Law

**After every fix, add a rule so it never happens again.** Zero exceptions.

## Process

### 1. Detect Correction

Trigger sources:
- User explicitly corrects output ("use snake_case, not camelCase")
- `verify` reports failures or warnings
- `forge` wave tasks fail verification
- `party` agents report errors
- Manual `danteforge lessons` invocation with correction text

### 2. Extract Lesson

From the correction, extract:
- **What went wrong** — the specific mistake
- **Why it was wrong** — the root cause or convention violated
- **The rule** — a concrete, actionable rule to prevent recurrence
- **Category** — naming, workflow, testing, architecture, style, etc.

### 3. Record Lesson

Append to `.danteforge/lessons.md` with timestamp and category:

```markdown
## [Category] Rule Title
_Added: 2025-02-26T10:30:00Z_
_Source: user correction | verify failure | forge failure_

**Mistake:** What went wrong
**Rule:** The concrete rule to follow going forward
```

### 4. Auto-Compact

When `lessons.md` exceeds 2000 lines:
- Group related lessons by category
- Merge duplicate or overlapping rules
- Remove outdated lessons (superseded by newer rules)
- Keep the file actionable and concise

### 5. Feed Forward

Lessons are injected into:
- `forge` task prompts — "Follow these learned rules: ..."
- `party` agent context — agents see all lessons
- `tech-decide` naming analysis — "Past lesson: team prefers snake_case"
- `verify` checks — validate lessons compliance

## Integration Points

- `danteforge lessons` — view, add, or compact lessons
- `danteforge lessons "Use snake_case for all variables"` — add a lesson directly
- `danteforge lessons --compact` — force compaction of lessons file
- `danteforge lessons --prompt` — generate prompt for manual lesson extraction
- `danteforge forge` — auto-triggers lesson capture on task failures
- `danteforge party` — auto-triggers lesson capture on agent errors
- `danteforge verify` — auto-triggers lesson capture on verification failures
- `danteforge tech-decide` — reads lessons for naming convention history

## Example Lessons

```markdown
## [Naming] Use snake_case for Python variables
_Added: 2025-02-26T10:30:00Z_
_Source: user correction_

**Mistake:** Used camelCase for Python function parameters
**Rule:** All Python code must use snake_case for variables, functions, and parameters. Reserve camelCase for JavaScript/TypeScript only.

## [Testing] Always mock external API calls
_Added: 2025-02-26T11:00:00Z_
_Source: forge failure_

**Mistake:** Test hit real API endpoint, causing flaky failures
**Rule:** Every test that touches an external API must use a mock/stub. No real HTTP calls in test suites.

## [Workflow] Run verify before synthesize
_Added: 2025-02-26T12:00:00Z_
_Source: verify failure_

**Mistake:** Synthesized UPR.md without verifying artifacts first
**Rule:** Always run danteforge verify before danteforge synthesize. Fix all failures before proceeding.
```
