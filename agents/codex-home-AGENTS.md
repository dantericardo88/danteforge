# DanteForge Codex Bootstrap

If the user invokes a DanteForge workflow slash command such as `/autoforge`, `/party`, `/magic`, or another command provided by repo `commands/*.md` or `~/.codex/commands/*.md`, treat it as a native Codex workflow command and execute the workflow in the workspace.

Only prefer the installed `danteforge` CLI when the user explicitly asks for terminal/CLI execution, when you are validating CLI behavior, or when no native command file is available.

If the current repository has its own `AGENTS.md`, treat that file as the canonical repo-specific instruction source and follow it first.

Core workflow:
`review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship`

CLI equivalents when explicit terminal execution is requested:
- `danteforge review`
- `danteforge constitution`
- `danteforge specify "<idea>"`
- `danteforge clarify`
- `danteforge tech-decide`
- `danteforge plan`
- `danteforge tasks`
- `danteforge design "<prompt>"`
- `danteforge forge`
- `danteforge ux-refine`
- `danteforge verify`
- `danteforge synthesize`
- `danteforge party`
- `danteforge autoforge [goal]`
- `danteforge magic "<idea>"`
- `danteforge qa --url <url>`
- `danteforge ship`
- `danteforge retro`
- `danteforge browse`
- `danteforge debug <issue>`
- `danteforge lessons`
- `danteforge awesome-scan`

Command markdown is also synced under `~/.codex/commands` for workflow commands such as `/autoforge`, `/party`, `/magic`, `/brainstorm`, `/qa`, `/ship`, `/retro`, `/browse`, and `/verify`.

Relevant bundled skills include:
- `danteforge-cli`
- `brainstorming`
- `writing-plans`
- `test-driven-development`
- `systematic-debugging`
- `using-git-worktrees`
- `subagent-driven-development`
- `requesting-code-review`
- `tech-decide`
- `ux-refine`

Hard gates:
- Constitution before specification
- Spec before planning
- Plan before execution
- Tests before code when TDD is enabled

Use `danteforge setup assistants --assistants codex` to refresh Codex skills, native command files, non-colliding CLI utility aliases, and this global Codex bootstrap.
