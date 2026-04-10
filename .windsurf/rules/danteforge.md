# DanteForge Workflow Rules

Use `AGENTS.md` as the canonical instruction file when it exists.

When working in this repository:
- Prefer the DanteForge workflow artifacts under `.danteforge/`.
- Follow the pipeline order:
  `review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship`
- Use `danteforge <command>` for any workflow step. Key commands:
  - `danteforge review` - Scan repo, generate CURRENT_STATE.md
  - `danteforge constitution` - Define project principles
  - `danteforge specify <idea>` - Idea to spec artifacts
  - `danteforge clarify` - Q&A on spec, identify gaps
  - `danteforge tech-decide` - Guided tech stack selection
  - `danteforge plan` - Spec to implementation plan
  - `danteforge tasks` - Plan to executable task list
  - `danteforge design <prompt>` - Design artifacts via OpenPencil
  - `danteforge forge` - Execute development waves
  - `danteforge ux-refine` - Refine UI/UX after forge
  - `danteforge verify` - Run all verification checks
  - `danteforge synthesize` - Generate UPR.md
  - `danteforge spark [goal]` - Zero-token planning preset
  - `danteforge ember [goal]` - Very low-token preset for quick follow-up work
  - `danteforge canvas [goal]` - Design-first frontend preset
  - `danteforge magic [goal]` - Balanced default preset for daily gap-closing
  - `danteforge blaze [goal]` - High-power preset with full party escalation
  - `danteforge nova [goal]` - Very-high-power preset: planning prefix + deep execution (no OSS)
  - `danteforge inferno [goal]` - Maximum-power preset with OSS discovery and evolution
  - `danteforge party --isolation` - Multi-agent collaboration
  - `danteforge autoforge [goal] --dry-run` - Inspect deterministic next steps
  - `danteforge local-harvest [paths...]` - Harvest patterns from local repos and folders
  - `danteforge qa --url <url>` - Structured QA pass
  - `danteforge ship` - Release review and planning guidance
  - `danteforge retro` - Project retrospective
  - `danteforge maturity` - Assess code maturity level
  - `danteforge define-done` - Define what "9+" means for this project (interactive, saved)
  - `danteforge assess` - Harsh self-assessment: feature universe or 12 dimensions, gap masterplan
  - `danteforge self-improve` - Autonomous quality loop until completion target met
  - `danteforge universe` - View competitive feature universe: all unique capabilities scored
  - `danteforge lessons` - Capture corrections as rules
  - `danteforge debug <issue>` - 4-phase debugging
  - `danteforge browse` - Browser automation
  - `danteforge oss` - Discover OSS patterns with license gates
  - `danteforge oss-clean` - Remove cached OSS repos
  - `danteforge oss-learn` - Re-extract patterns from cached OSS repos
  - `danteforge harvest <system>` - Titan Harvest V2 pattern extraction
  - `danteforge awesome-scan` - Discover and import skills
  - `danteforge wiki-ingest` - Ingest sources into three-tier knowledge wiki
  - `danteforge wiki-lint` - Lint wiki: contradictions, staleness, link integrity
  - `danteforge wiki-query <topic>` - Query wiki for relevant knowledge
  - `danteforge wiki-status` - View wiki health metrics
  - `danteforge wiki-export` - Export wiki as Obsidian vault or HTML
  - `danteforge resume` - Resume a paused autoforge loop from checkpoint
  - `danteforge danteforge` - Maximum-power all-in-one execution preset
- Preset usage rule:
  `danteforge inferno [goal]` for first-pass matrix expansion, `danteforge magic [goal]` for follow-up gap closing.
- Use `--light` to bypass gates for simple changes.
- Before claiming release readiness, run `npm run verify`, `npm run check:cli-smoke`, and `npm run release:check`.
- For design-heavy work, use `danteforge design` and `danteforge ux-refine --openpencil`.
