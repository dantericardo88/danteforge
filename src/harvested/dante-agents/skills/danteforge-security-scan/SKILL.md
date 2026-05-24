---
name: danteforge-security-scan
description: OWASP Top 10 static analysis scan against TypeScript/JavaScript source files. Detects injection, XSS, CSRF, auth failures, cryptographic weaknesses, SSRF, and more. Exits 1 on CRITICAL findings.
version: 1.0.0
risk: low
source: danteforge-native
importDate: 2026-05-15
---

# DanteForge Security Scan Skill

Use this skill when you need to check a project for known vulnerability patterns before merging, releasing, or reporting quality scores. Run after every forge wave that touches auth, input handling, API routes, or external calls.

## When to use this skill

- After any forge wave that touches auth, routing, input handling, or external calls
- Before cutting a release (`danteforge ship` calls this automatically)
- When investigating a security dimension score below 8.0
- As part of a security crusade cycle to verify progress

## The Command

```bash
# Human-readable report
danteforge security-scan

# Machine-readable JSON (for CI/automation)
danteforge security-scan --json

# Scan a specific project
danteforge security-scan --cwd /path/to/project
```

## OWASP Top 10 Coverage

| OWASP Category | Patterns Checked |
|---------------|-----------------|
| A01 Broken Access Control | Path traversal, missing auth middleware |
| A02 Cryptographic Failures | Hardcoded secrets, MD5/SHA1, HTTP URLs |
| A03 Injection | eval(), exec() command injection, SQL concatenation, NoSQL $where |
| A05 Security Misconfiguration | CORS *, debug:true, NODE_ENV bypass |
| A07 Auth Failures | JWT without expiry, weak session secrets |
| A08 Integrity Failures | Prototype pollution via user input |
| A09 Logging Failures | Sensitive fields in console.log |
| A10 SSRF | fetch/axios with user-controlled URLs |
| XSS | innerHTML/outerHTML/document.write |

## Risk Levels

- **CRITICAL** — Blocks merge via merge-court. Must fix before proceeding.
- **HIGH** — Warning in verify. Should fix before release.
- **MEDIUM** — Informational. Review and decide.

## Exit Codes

- `0` — No CRITICAL findings (HIGH/MEDIUM may still exist)
- `1` — CRITICAL findings detected

## Example Output

```
## DanteForge Security Scan
Files scanned: 42
Findings: CRITICAL=0 HIGH=2 MEDIUM=1

| File | Line | Risk | Pattern | Description |
|------|------|------|---------|-------------|
| src/routes/user.ts | 34 | HIGH | cors-wildcard | CORS origin set to * |
| src/auth/jwt.ts | 12 | HIGH | jwt-no-expiry | JWT signed without expiry |
```

## Integration with Merge Court

The security-red-team court in the matrix kernel runs these same checks on every agent-produced branch. A CRITICAL finding blocks the branch with `BLOCKED_BY_SECURITY`. You can run `danteforge security-scan` on staged files to preview what the court will see.

## Workflow Integration

```bash
# After a forge wave:
danteforge forge
danteforge security-scan          # check for new vulnerabilities
danteforge verify                 # full verification including security gate
```

## Notes

- Scans `src/**/*.ts` and `src/**/*.tsx` by default (excludes `dist/`, `node_modules/`, `.d.ts`)
- Comment lines are skipped (no false positives from commented-out code)
- The `--json` flag outputs structured JSON suitable for CI parsing or piping to other tools
