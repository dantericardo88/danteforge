---
name: api-patterns
description: API design principles and decision-making. REST vs GraphQL vs tRPC
  selection, response formats, versioning, pagination.
risk: unknown
source: antigravity-awesome-skills
date_added: 2026-02-27
danteforge_enhanced: true
danteforge_bundle: Full-Stack Developer
upstream_repo: https://github.com/sickn33/antigravity-awesome-skills.git
upstream_skill_path: api-patterns
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

# API Patterns

> API design principles and decision-making for 2025.
> **Learn to THINK, not copy fixed patterns.**

## 🎯 Selective Reading Rule

**Read ONLY files relevant to the request!** Check the content map, find what you need.

---

## 📑 Content Map

| File | Description | When to Read |
|------|-------------|--------------|
| `api-style.md` | REST vs GraphQL vs tRPC decision tree | Choosing API type |
| `rest.md` | Resource naming, HTTP methods, status codes | Designing REST API |
| `response.md` | Envelope pattern, error format, pagination | Response structure |
| `graphql.md` | Schema design, when to use, security | Considering GraphQL |
| `trpc.md` | TypeScript monorepo, type safety | TS fullstack projects |
| `versioning.md` | URI/Header/Query versioning | API evolution planning |
| `auth.md` | JWT, OAuth, Passkey, API Keys | Auth pattern selection |
| `rate-limiting.md` | Token bucket, sliding window | API protection |
| `documentation.md` | OpenAPI/Swagger best practices | Documentation |
| `security-testing.md` | OWASP API Top 10, auth/authz testing | Security audits |

---

## 🔗 Related Skills

| Need | Skill |
|------|-------|
| API implementation | `@[skills/backend-development]` |
| Data structure | `@[skills/database-design]` |
| Security details | `@[skills/security-hardening]` |

---

## ✅ Decision Checklist

Before designing an API:

- [ ] **Asked user about API consumers?**
- [ ] **Chosen API style for THIS context?** (REST/GraphQL/tRPC)
- [ ] **Defined consistent response format?**
- [ ] **Planned versioning strategy?**
- [ ] **Considered authentication needs?**
- [ ] **Planned rate limiting?**
- [ ] **Documentation approach defined?**

---

## ❌ Anti-Patterns

**DON'T:**
- Default to REST for everything
- Use verbs in REST endpoints (/getUsers)
- Return inconsistent response formats
- Expose internal errors to clients
- Skip rate limiting

**DO:**
- Choose API style based on context
- Ask about client requirements
- Document thoroughly
- Use appropriate status codes

---

## Script

| Script | Purpose | Command |
|--------|---------|---------|
| `scripts/api_validator.py` | API endpoint validation | `python scripts/api_validator.py <project_path>` |


## When to Use
This skill is applicable to execute the workflow or actions described in the overview.
