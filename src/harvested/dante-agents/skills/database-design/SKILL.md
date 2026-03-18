---
name: database-design
description: Database design principles and decision-making. Schema design,
  indexing strategy, ORM selection, serverless databases.
risk: unknown
source: antigravity-awesome-skills
date_added: 2026-02-27
danteforge_enhanced: true
danteforge_bundle: Full-Stack Developer
upstream_repo: https://github.com/sickn33/antigravity-awesome-skills.git
upstream_skill_path: database-design
---

> Imported from Antigravity and wrapped for the DanteForge workflow.

## DanteForge Wrapper

- Constitution check: confirm the project constitution is active before applying this skill.
- Gate reminders: respect `specify -> clarify -> plan -> tasks -> forge`; use `--light` only when the scope is genuinely small.
- STATE.yaml integration: keep `.danteforge/STATE.yaml` aligned with the current phase, task list, and audit log while using this skill.
- TDD hook: start with a failing test and keep the change on the RED -> GREEN -> REFACTOR path.
- Verify hook: finish with `npm run verify` and `npm run build` before claiming completion.
- Party mode hook: if the work splits cleanly, prefer DanteForge party mode for parallel execution.
- Worktree note: risky or parallel work should run in an isolated git worktree.

## Upstream Skill

# Database Design

> **Learn to THINK, not copy SQL patterns.**

## 🎯 Selective Reading Rule

**Read ONLY files relevant to the request!** Check the content map, find what you need.

| File | Description | When to Read |
|------|-------------|--------------|
| `database-selection.md` | PostgreSQL vs Neon vs Turso vs SQLite | Choosing database |
| `orm-selection.md` | Drizzle vs Prisma vs Kysely | Choosing ORM |
| `schema-design.md` | Normalization, PKs, relationships | Designing schema |
| `indexing.md` | Index types, composite indexes | Performance tuning |
| `optimization.md` | N+1, EXPLAIN ANALYZE | Query optimization |
| `migrations.md` | Safe migrations, serverless DBs | Schema changes |

---

## ⚠️ Core Principle

- ASK user for database preferences when unclear
- Choose database/ORM based on CONTEXT
- Don't default to PostgreSQL for everything

---

## Decision Checklist

Before designing schema:

- [ ] Asked user about database preference?
- [ ] Chosen database for THIS context?
- [ ] Considered deployment environment?
- [ ] Planned index strategy?
- [ ] Defined relationship types?

---

## Anti-Patterns

❌ Default to PostgreSQL for simple apps (SQLite may suffice)
❌ Skip indexing
❌ Use SELECT * in production
❌ Store JSON when structured data is better
❌ Ignore N+1 queries

## When to Use
This skill is applicable to execute the workflow or actions described in the overview.
