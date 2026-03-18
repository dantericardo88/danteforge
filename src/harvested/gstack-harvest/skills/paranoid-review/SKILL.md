---
name: paranoid-review
domain: security
source: gstack-harvest
version: 0.8.0
integrates:
  - ship
  - code-reviewer
  - autoforge-loop
---

# Paranoid Review Skill

## Iron Law
Every ship command runs a two-pass security and quality audit. CRITICAL findings block ship unless explicitly acknowledged with audit trail.

## Process — Pass 1: CRITICAL
1. SQL injection risks (template literals in queries)
2. Hardcoded secrets and credentials
3. eval() and code injection vectors
4. innerHTML XSS vulnerabilities
5. Unvalidated user input
6. .env in git operations

## Process — Pass 2: INFORMATIONAL
1. N+1 query patterns (await in loops)
2. Empty catch blocks (error swallowing)
3. setTimeout(fn, 0) race conditions
4. TypeScript `any` type usage
5. console.log debug artifacts
