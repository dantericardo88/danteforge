# Browser Inspect Checklist

## Pre-Flight
- [ ] Browse binary is installed and accessible in PATH
- [ ] Target URL is accessible from localhost
- [ ] `.danteforge/evidence/` directory is writable

## Navigation
- [ ] `browse goto <url>` returns success
- [ ] Page loads within 5 seconds on cold start
- [ ] Subsequent navigations complete in < 500ms

## Evidence Collection
- [ ] Screenshot saved with ISO timestamp filename
- [ ] Accessibility tree captured as structured text
- [ ] Console output captured (errors + warnings)
- [ ] Network requests logged (status codes + timing)

## Multi-Workspace
- [ ] Concurrent party sessions use separate daemon ports
- [ ] Port derived from worktree context (9400–9499 range)
- [ ] No daemon port collisions between sessions

## Constitution Compliance
- [ ] Daemon binds to localhost only (127.0.0.1)
- [ ] No external telemetry or remote endpoints
- [ ] Bearer token stored in chmod 600 state file
- [ ] Evidence paths logged to audit trail
