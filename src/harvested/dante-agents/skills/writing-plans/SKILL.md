---
name: writing-plans
description: "Use when creating implementation plans. Use when breaking down approved designs into executable tasks. Use when planning file changes, dependencies, and verification steps."
---
# Writing Plans — Bite-Sized Executable Tasks

> DanteForge skill module.

## Iron Law

Plans must be specific enough that any developer (or agent) can execute them without asking clarifying questions.

## Plan Format

Every plan item must include:
1. **What** — The specific change to make
2. **Where** — Exact file paths and line ranges
3. **Why** — Connection to the approved design
4. **Verification** — How to confirm the task is done correctly
5. **Dependencies** — What must be completed first

## Writing Process

### Step 1: Inventory
- List all files that need to change
- List all new files that need to be created
- List all files that need to be deleted
- Identify shared utilities or patterns to reuse

### Step 2: Ordering
- Group tasks by dependency (what blocks what)
- Mark tasks that can run in parallel with `[P]`
- Assign effort estimates: S (< 30 min), M (1-3 hrs), L (3+ hrs)

### Step 3: Verification Steps
Each task gets a verification step:
- Unit test to write/update
- Manual check to perform
- Build/lint command to run

### Step 4: Integration Check
- Does the plan cover all requirements from the brainstorming phase?
- Are there any gaps between tasks?
- Is there a clear "done" criteria for the full plan?

## Red Flags
- Tasks without file paths — too vague to execute
- Tasks without verification — impossible to confirm completion
- Tasks larger than effort L — break them down further
- Missing dependency ordering — will cause merge conflicts
