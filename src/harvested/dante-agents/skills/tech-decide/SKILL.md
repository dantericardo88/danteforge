---
name: tech-decide
description: "Use when the user needs to choose a tech stack, framework, language, database, or deployment strategy. Use when starting a new project or pivoting technology. Use when SPEC exists and architecture decisions are needed before planning."
---
# Tech Stack Decision Framework

> DanteForge skill module — guided tech stack selection with structured pros/cons analysis.

## When to Use

- After `specify` (SPEC exists) but before `plan`
- When starting a new project and technology choices are open
- When comparing frameworks, languages, or infrastructure options
- When the team needs structured reasoning for architecture decisions

## Process

### 1. Context Gathering
- Read SPEC.md for project requirements
- Read CURRENT_STATE.md for existing codebase context
- Check constitution for constraints (e.g., "no vendor lock-in", "must be OSS")

### 2. Category Analysis
For each category (Language, Framework, Database, Deployment, Naming Style):
- Generate 3-5 tailored options based on project context
- For each option: 2-4 pros and 2-4 cons
- Mark one as "Recommended" with clear reasoning

### 3. Decision Criteria
Weight options by:
- **Team familiarity** — existing skills reduce ramp-up time
- **Ecosystem maturity** — community size, packages, documentation
- **Project fit** — scale requirements, performance needs, deployment target
- **Maintenance burden** — long-term cost of keeping the stack current
- **Constraint alignment** — respects constitution principles

### 4. Output
- Save structured decision to `.danteforge/TECH_STACK.md`
- Include rationale for recommended choices
- Feed into `plan` command for architecture-aware planning

## Integration Points

- `danteforge tech-decide` — interactive selection
- `danteforge tech-decide --auto` — accept all recommended defaults
- `danteforge tech-decide --prompt` — generate copy-paste prompt
- `danteforge plan` — reads TECH_STACK.md if present
- `danteforge forge` — respects selected stack conventions
