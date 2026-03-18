# Paranoid Review Checklist

## Pass 1 — CRITICAL (Blocks Ship)
- [ ] No SQL injection via string interpolation
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] No eval() usage
- [ ] No innerHTML direct assignment
- [ ] No unvalidated user input
- [ ] No .env files in git operations
- [ ] Auth bypass risks reviewed
- [ ] LLM output trust boundaries enforced

## Pass 2 — INFORMATIONAL
- [ ] No N+1 query patterns (await in loops)
- [ ] No empty catch blocks
- [ ] No setTimeout(fn, 0) race condition hacks
- [ ] TypeScript `any` minimized
- [ ] No console.log in production code
- [ ] Error boundaries present for UI components
- [ ] Missing error boundaries identified

## Resolution Options
- **Fix now**: Apply the fix immediately
- **Acknowledge**: Ship with known issue, add to PR body
- **False positive**: Skip finding, log to audit trail
