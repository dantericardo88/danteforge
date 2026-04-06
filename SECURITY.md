# Security Policy

## Threat Model

DanteForge is a developer CLI that executes code generation and testing workflows. It interacts with:

- **Local filesystem**: Reads/writes project files in the working directory
- **LLM APIs**: Sends prompts to external AI providers (Ollama, OpenAI, Claude, Grok, Gemini)
- **Git**: Creates branches, commits, and worktrees
- **Child processes**: Spawns subprocesses for test runners and build tools

## Security Controls

### Input Validation
- All file paths are sanitized to prevent directory traversal (`src/core/input-validation.ts`)
- CLI arguments are validated against known providers and subcommand lists
- LLM responses are parsed with error boundaries — malformed JSON does not crash

### Secret Management
- API keys are stored in `~/.danteforge/config.yaml` (user home, not project directory)
- Keys are NEVER committed to `.danteforge/STATE.yaml` or any project-level file
- Environment variables (`OLLAMA_HOST`, etc.) override config file values

### Safe Self-Edit
- The `safe-self-edit.ts` module enforces a **deny-by-default** policy
- Any code modifications to the DanteForge source itself require explicit policy override
- All self-edit operations are logged to the audit trail in `STATE.yaml`

### Audit Trail
- Every command execution is logged in `.danteforge/STATE.yaml` audit log
- Verify receipts are stored in `.danteforge/evidence/verify/`
- Assessment history is persisted in `.danteforge/assessment-history.json`

### Sandboxing
- Git worktree isolation prevents concurrent operations from interfering
- Headless agent spawning uses child processes with no shared state
- MCP server handlers resolve all paths relative to a configurable `cwd`

## Reporting Vulnerabilities

If you discover a security issue, please report it responsibly:
1. Open a GitHub issue (for non-sensitive issues)
2. Email the maintainers directly (for sensitive issues)

## Workspace Isolation

When `DANTEFORGE_WORKSPACE` is set, DanteForge enforces role-based access:
- **owner**: full access including config changes and license activation
- **editor**: can forge, verify, and assess; cannot change workspace config
- **reviewer**: read-only access (assess, maturity, workflow, universe)

In single-user mode (no workspace set), all commands are permitted.

### Data Locality
All workspace data stays local:
- Workspace config: `~/.danteforge/workspaces/{id}/config.yaml`
- Project state: `.danteforge/STATE.yaml` (per-project)
- API keys: `~/.danteforge/config.yaml` (per-user, mode 0600)

No data is synced to external servers without explicit configuration.

### API Key Recommendations for Teams
Use environment variables in CI/CD rather than shared config files:
```
DANTEFORGE_CLAUDE_API_KEY=sk-...
DANTEFORGE_OPENAI_API_KEY=sk-...
DANTEFORGE_LICENSE_KEY=DF-PRO-20261231-...
```

## Known Limitations

- Workspace identity is based on `os.userInfo().username` or `DANTEFORGE_USER` env var — not cryptographically verified (v0.11.0 will add signed tokens)
- No SOC 2 certification — internal tool, not a SaaS offering
- LLM prompts may contain project source code — ensure API provider data policies are acceptable
- `--light` flag bypasses hard gates, including security checks
