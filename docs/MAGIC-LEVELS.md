# Magic Levels

DanteForge Magic presets provide tiered intensity for agentic workflows, balancing token efficiency with depth.

## Preset Levels

- **/spark**: Zero-token planning — review + constitution + specify + clarify + tech-decide + plan + tasks. Start every new project here.
- **/ember**: Very low tokens — budget autoforge + lessons (~$0.15). Quick features and prototyping.
- **/canvas**: Design-first frontend — design → autoforge(6) → ux-refine → verify → lessons (~$0.75). Use when visual design should drive implementation.
- Follow-up PRD gap closing and daily work — **/magic**: autoforge + verify + lessons (~$0.50). Balanced default; 80% of all work.
- **/blaze**: High power — full party + autoforge + synthesize + retro + lessons (~$1.50). Big features needing real power.
- **/nova**: Very high power — planning prefix (constitution + plan + tasks) + blaze execution + polish, no OSS (~$3.00). Planned feature sprints.
- First-time new matrix dimension + fresh OSS discovery (full autoresearch harvest) — **/inferno**: Maximum power (~$5.00).

## Usage Rules

- Use `/canvas` for frontend-heavy features where visual design should drive implementation
- Use `/inferno` for the first big attack on a new matrix dimension (fresh OSS discovery)
- Use `/nova` for planned feature sprints needing planning + deep execution without OSS overhead
- Use `/magic` for all follow-up PRD gap closing
- Use `/spark` for every new idea or project start

Use `--magic-level <level>` or slash commands in supported hosts (Claude Code, Codex, Cursor).

For maximum token savings, start with `/ember` and escalate only on stalls.
