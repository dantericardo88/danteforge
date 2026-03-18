# DanteForge Quickstart

Three commands to go from idea to verified implementation.

## 1. Initialize

```bash
danteforge init
```

Sets up `.danteforge/` project state, detects your environment, and checks system health.

## 2. Build

```bash
danteforge magic "your idea here"
```

Runs the full pipeline automatically: constitution, spec, clarify, plan, tasks, and forge. Requires a configured LLM provider — run `danteforge config --set-key <provider:key>` first if you haven't.

No LLM? Use prompt mode:

```bash
danteforge magic "your idea here" --prompt
```

This generates copy-paste prompts for each stage instead of calling an API.

## 3. Verify

```bash
danteforge verify
```

Checks that all artifacts exist, gates pass, and the workflow is consistent.

## What Just Happened?

DanteForge ran a 12-stage pipeline:

1. **Constitution** — established project principles and constraints
2. **Specify** — turned your idea into a detailed spec with acceptance criteria
3. **Clarify** — found and resolved ambiguities in the spec
4. **Tech Decide** — selected technologies with trade-off analysis
5. **Plan** — created an architecture and implementation plan
6. **Tasks** — broke the plan into atomic, executable tasks
7. **Forge** — executed tasks in waves using LLM agents
8. **Verify** — confirmed everything passes

All artifacts are stored in `.danteforge/` as plain files you can read and edit.

## What's Next?

| Goal | Command |
|------|---------|
| Run another forge wave | `danteforge forge 2` |
| Multi-agent parallel work | `danteforge party` |
| Autonomous optimization | `danteforge autoforge` |
| Harvest OSS patterns | `danteforge oss` |
| Debug a specific issue | `danteforge debug "the issue"` |
| Generate design artifacts | `danteforge design "component"` |
| See all commands | `danteforge --help` |
| Get context-aware guidance | `danteforge help` |

## Advanced Workflows

**Party + AutoForge combo** — let multiple agents work in parallel while autoforge orchestrates the pipeline:

```bash
danteforge autoforge "build feature X"
danteforge party
```

**OSS-driven development** — discover and harvest patterns from open-source projects:

```bash
danteforge oss --max-repos 5
danteforge harvest <system>
```

**Prompt-only mode** — generate prompts without API calls (works offline):

```bash
danteforge specify "idea" --prompt
danteforge plan --prompt
danteforge forge 1 --prompt
```

See the full [command reference](ARCHITECTURE.md) and [README](../README.md) for details.
