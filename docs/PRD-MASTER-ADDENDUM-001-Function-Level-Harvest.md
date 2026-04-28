# Phase 2 Harvest Specification: Per-Skill Logic Comparison

**Purpose**: This document specifies the exact files Claude Code must read, the exact logic Claude Code must extract, and the exact decision criteria Claude Code must apply when building the five Dante-native skills in Phase 2 of PRD-MASTER. It is the founder's correction to my prior specification, which leaned on stars-as-quality-proxy. Stars are popularity. Function-level logic is quality. This document specifies the function-level harvest.

**Scope**: Five Dante-native skills (`/dante-to-prd`, `/dante-grill-me`, `/dante-tdd`, `/dante-triage-issue`, `/dante-design-an-interface`). Three primary harvest sources (Superpowers, OpenSpec, mattpocock/skills). Per-skill source-file comparison required before any Dante-native version is written.

**Discipline**: Read all source files for each skill before writing the Dante-native version. Compare logic across all three sources. Pick the best per-function approach. Cite source for every decision in the resulting `.danteforge/OSS_HARVEST/<skill>_function_comparison.md` document. No clean-room implementation begins until the function comparison document is complete and three-way-gate signed off.

---

## Per-Skill Harvest Targets

### Skill 1: `/dante-to-prd` (PRD generation from conversation)

**Files to read in full before writing Dante-native version**:

- `superpowers/skills/brainstorming/SKILL.md` — Superpowers' Socratic design refinement
- `superpowers/skills/writing-plans/SKILL.md` — Superpowers' implementation plan generation
- `OpenSpec/openspec/AGENTS.md` — OpenSpec's spec authoring agent instructions
- `OpenSpec/src/commands/proposal.ts` (or equivalent) — OpenSpec's `/opsx:propose` command implementation
- `OpenSpec/openspec/changes/<example>/proposal.md` — example proposal artifact
- `OpenSpec/openspec/changes/<example>/specs/<spec>.md` — example specs structure
- `OpenSpec/openspec/changes/<example>/design.md` — example design document
- `OpenSpec/openspec/changes/<example>/tasks.md` — example task breakdown
- `mattpocock/skills/to-prd/SKILL.md` — Matt's to-prd skill content

**Functions to compare across sources**:

| Function | Compare What | Decision Criterion |
|----------|--------------|-------------------|
| Conversation-to-spec extraction | How does each tool turn ambient conversation into structured spec? | Pick the approach that best preserves founder intent without over-structuring |
| Question generation for spec gaps | What questions does each tool generate when the user's input is ambiguous? | Pick the approach with most rigorous gap detection |
| Spec format and structure | Single document vs. folder-with-multiple-files? Headers, sections, frontmatter conventions? | OpenSpec's per-change folder is likely better than flat PRD; verify by reading example proposals |
| Task breakdown granularity | How does each tool break a spec into actionable tasks? | Pick the granularity that aligns with KiloCode discipline (small enough, testable) |
| Acceptance criteria authoring | How does each tool generate acceptance criteria? | Pick the approach that produces measurable, falsifiable criteria |
| Linking implementation to spec | How does each tool track which tasks map to which spec sections? | Pick the approach that supports Dante's evidence chain integration |
| GitHub issue filing | Does the tool file as a GitHub issue or another format? | Optional integration; Dante version emits to `.danteforge/PRDs/` first, GitHub issue secondary |

**Dante-native additions required regardless of source comparison**:

1. Emit PRD into `.danteforge/PRDs/` matching the truth-loop schema (Run, Artifact, Evidence chain)
2. Run harsh double scoring matrix against all 18 dimensions before committing the PRD
3. Three-way promotion gate sign-off before GitHub issue creation
4. Constitutional checklist section: KiloCode discipline confirmation, fail-closed semantics specification, evidence emission specification, sacred content type identification, expected context footprint
5. Adopt OpenSpec's per-change folder convention for PRDs going forward (one folder per change with proposal/specs/design/tasks/archive lifecycle) if function comparison confirms it's superior to flat PRDs

**Output document**: `.danteforge/OSS_HARVEST/dante_to_prd_function_comparison.md` documenting every function compared, the choice made per function, the source attribution, and the constitutional additions.

---

### Skill 2: `/dante-grill-me` (Interview-driven plan refinement)

**Files to read in full before writing Dante-native version**:

- `superpowers/skills/brainstorming/SKILL.md` — Superpowers' Socratic refinement (already read for skill 1; re-read for grill-me lens)
- `superpowers/skills/requesting-code-review/SKILL.md` — Superpowers' adversarial review pattern
- `mattpocock/skills/grill-me/SKILL.md` — Matt's grill-me skill content
- `mattpocock/skills/request-refactor-plan/SKILL.md` — Matt's interview-driven refactor planning
- `hex/claude-council/commands/ask.md` (or equivalent) — claude-council's debate mode prompt structure
- `hex/claude-council/scripts/query-council.sh` — claude-council's role assignment logic

**Functions to compare across sources**:

| Function | Compare What | Decision Criterion |
|----------|--------------|-------------------|
| Question depth escalation | How does each tool decide when to dig deeper vs. accept an answer? | Pick the approach that catches hidden assumptions reliably |
| Assumption surfacing | How does each tool detect implicit assumptions in user statements? | Pick the approach with strongest pattern library for assumption detection |
| Disagreement handling | When the interviewer challenges and the user pushes back, how does the tool resolve? | claude-council's debate mode protocol (Round 1 independent, Round 2 critique) is likely strongest; verify |
| Stopping criteria | How does each tool know when interview is complete? | Pick the approach with measurable completion criteria, not vibe-based |
| Output format | Refined plan, decision log, both? | Pick the output that integrates with Dante evidence chain |
| Role assignment | Single-perspective vs. multi-perspective grilling? | claude-council's role taxonomy (security, performance, devil, simplicity, etc.) likely strongest; adopt with attribution |
| Time-boxing | Does the tool prevent infinite loops? | Pick the approach with explicit budget/turn limits |

**Dante-native additions required regardless of source comparison**:

1. Integrate truth-loop disagreement protocol from PRD-26 (evidence settles it / evidence partially settles it / evidence does not settle it / opinion-only / high-risk)
2. Emit each interview turn as Evidence into `.danteforge/grill-sessions/<sessionId>/`
3. Apply unresolved-disagreement protocol when interviewer and interviewee hit irreconcilable positions
4. Score final plan on Planning Quality dimension before declaring complete (9.0+ required)
5. Optional `--roles=balanced` flag using claude-council role taxonomy

**Output document**: `.danteforge/OSS_HARVEST/dante_grill_me_function_comparison.md`

---

### Skill 3: `/dante-tdd` (Red-green-refactor TDD loop)

**Files to read in full before writing Dante-native version**:

- `superpowers/skills/test-driven-development/SKILL.md` — Superpowers' TDD skill (most detailed of the three sources)
- `superpowers/skills/verification-before-completion/SKILL.md` — Superpowers' anti-stub verification
- `superpowers/skills/systematic-debugging/SKILL.md` — Superpowers' 4-phase root cause process
- `mattpocock/skills/tdd/SKILL.md` — Matt's TDD skill content

**Functions to compare across sources**:

| Function | Compare What | Decision Criterion |
|----------|--------------|-------------------|
| Red phase: failing test authoring | How does each tool ensure the test actually fails for the right reason? | Pick the approach with strongest "why is this red" verification |
| Red verification | How does each tool prevent false-red (test fails for wrong reason like syntax error)? | Critical anti-stub check; pick the strongest |
| Green phase: minimal implementation | How does each tool prevent over-implementation in green phase? | Pick the approach with explicit YAGNI enforcement |
| Green verification | How does each tool confirm the test now passes for the right reason? | Pick the approach that verifies test name matches behavior |
| Refactor phase: extraction | How does each tool decide when refactoring is appropriate vs. premature? | Pick the approach aligned with KiloCode discipline (file >500 LOC triggers extraction) |
| Refactor verification | How does each tool confirm refactoring didn't change behavior? | Pick the approach that runs full suite, not just touched tests |
| Commit cadence | When does each tool commit during the cycle? | Pick the approach that produces auditable evidence trail |
| Anti-stub enforcement | How does each tool detect mock implementations passing for real ones? | Superpowers' verification-before-completion is likely strongest; verify |

**Dante-native additions required regardless of source comparison**:

1. KiloCode discipline enforced during refactor: any file growing past 500 LOC triggers extraction, no exceptions
2. Harsh-scorer Testing dimension check on test suite after each cycle (9.0+ required to proceed to next cycle)
3. Evidence emission for each red-green-refactor transition as separate Artifacts
4. Sacred content preservation rule: test names and assertion messages never compressed by Article XIII Context Economy filters
5. Three-way promotion gate before any commit lands

**Output document**: `.danteforge/OSS_HARVEST/dante_tdd_function_comparison.md`

---

### Skill 4: `/dante-triage-issue` (Bug investigation with root-cause analysis)

**Files to read in full before writing Dante-native version**:

- `superpowers/skills/systematic-debugging/SKILL.md` — Superpowers' 4-phase root cause process (primary source — Superpowers is most disciplined here per CLAUDE.md)
- `superpowers/skills/verification-before-completion/SKILL.md` — Superpowers' verification step
- `mattpocock/skills/triage-issue/SKILL.md` — Matt's triage skill content
- Compare with Dante's existing patterns from earlier OSS harvest: AgentZero error recovery exponential backoff (already implemented in DanteAgents), Stagehand self-healing automation (already implemented)

**Functions to compare across sources**:

| Function | Compare What | Decision Criterion |
|----------|--------------|-------------------|
| Symptom capture | How does each tool capture the original bug report and reproduction steps? | Pick the approach with most rigorous symptom-vs-cause separation |
| Hypothesis generation | How does each tool generate candidate root causes? | Pick the approach that explicitly enumerates competing hypotheses |
| Hypothesis testing | How does each tool eliminate hypotheses? | Pick the approach with explicit falsification criteria |
| Root cause depth | How deep does each tool dig before declaring root cause? | Superpowers' 4-phase process likely strongest; verify against Matt's |
| Defense in depth | How does each tool ensure the fix doesn't just patch the symptom? | Superpowers' explicit defense-in-depth technique; adopt |
| Test creation for the bug | When does each tool require a regression test? | Pick the approach that mandates regression test before fix |
| Verification | How does each tool confirm the bug is actually fixed? | Pick the approach that verifies in production-equivalent conditions |
| Reporting | What does the final triage report contain? | Pick the format that integrates with Dante incident tracking |

**Dante-native additions required regardless of source comparison**:

1. SoulSeal receipt for the root-cause analysis itself (chain of reasoning is signed and auditable)
2. Three-way promotion gate before any proposed fix lands
3. Integration with `.danteforge/incidents/` for queryable triage history
4. Harsh-scorer Error Handling dimension check on proposed fix (9.0+ required)
5. Optional `--mode=adversarial` flag invokes claude-council-style debate mode on the root cause hypothesis

**Output document**: `.danteforge/OSS_HARVEST/dante_triage_issue_function_comparison.md`

---

### Skill 5: `/dante-design-an-interface` (Parallel design exploration)

**Files to read in full before writing Dante-native version**:

- `superpowers/skills/dispatching-parallel-agents/SKILL.md` — Superpowers' parallel subagent orchestration
- `superpowers/skills/subagent-driven-development/SKILL.md` — Superpowers' subagent dispatch pattern with two-stage review
- `mattpocock/skills/design-an-interface/SKILL.md` — Matt's parallel design skill
- `hex/claude-council/scripts/format-output.sh` — claude-council's debate synthesis output format

**Functions to compare across sources**:

| Function | Compare What | Decision Criterion |
|----------|--------------|-------------------|
| Sub-agent dispatch | How does each tool spawn parallel sub-agents? | Pick the approach respecting hardware ceiling (max 3 parallel per Dante constraint) |
| Sub-agent prompt diversity | How does each tool ensure sub-agents produce different solutions? | Pick the approach with explicit diversity enforcement |
| Sub-agent isolation | How does each tool prevent sub-agents from contaminating each other? | Superpowers' git-worktrees pattern likely strongest; verify |
| Synthesis: comparison | How does each tool compare the sub-agent outputs? | claude-council debate mode likely strongest; verify |
| Synthesis: selection | How does each tool select the winning approach? | Pick the approach with explicit decision criteria, not vibe-based |
| Two-stage review | Does the tool review sub-agent output for spec compliance separately from code quality? | Superpowers explicitly does this; adopt |
| Failure handling | What happens when no sub-agent produces acceptable output? | Pick the approach that triggers re-dispatch with refined prompt vs. escalates to human |

**Dante-native additions required regardless of source comparison**:

1. Each sub-agent emits its design as a separate Artifact with full evidence trail
2. Synthesis step runs through claude-council debate mode protocol to identify which design's tradeoffs win on which dimensions
3. Final selection emits a Verdict and NextAction matching truth loop schema
4. Maximum 3 parallel sub-agents per laptop hardware ceiling (not the 5+ that Superpowers or Matt's vanilla version may default to)
5. Harsh-scorer dimension check on each design before synthesis (9.0+ on relevant dimensions)

**Output document**: `.danteforge/OSS_HARVEST/dante_design_an_interface_function_comparison.md`

---

## Cross-Skill Patterns

These patterns appear across multiple skills and should be harvested once at the framework level rather than per-skill.

### Pattern A: Skill Auto-Triggering

Superpowers' "skills trigger automatically" is a meta-pattern. Read:

- `superpowers/hooks/SessionStart` (or equivalent) — how skills get loaded into context
- `superpowers/CLAUDE.md` — instructions about skill triggering
- `superpowers/skills/using-superpowers/SKILL.md` — meta-skill that explains the trigger system

**Decision criterion**: Adopt auto-triggering for Dante-native skills if and only if the trigger respects the three-way promotion gate. If a skill auto-triggers and writes to production state without gate sign-off, it violates the constitution. The Dante version of auto-triggering must include a "trigger detected, awaiting gate sign-off" intermediate state.

**Output**: `.danteforge/OSS_HARVEST/skill_auto_triggering_pattern.md`

### Pattern B: Adversarial Pressure Testing for Skills

Superpowers' CLAUDE.md states: "Skills are not prose — they are code that shapes agent behavior. Run adversarial pressure testing across multiple sessions. Show before/after eval results." Read:

- `superpowers/skills/writing-skills/SKILL.md` — meta-skill for skill authoring with eval methodology
- `superpowers/tests/` — test infrastructure for skills

**Decision criterion**: Adopt the pressure-testing methodology for all Dante-native skills. Every skill must have eval evidence before merge. This integrates naturally with the harsh double scoring matrix.

**Output**: `.danteforge/OSS_HARVEST/skill_adversarial_testing_pattern.md`

### Pattern C: Per-Change Folder Lifecycle

OpenSpec's per-change folder pattern (proposal/specs/design/tasks/archive) is a meta-pattern for PRD organization. Read:

- `OpenSpec/openspec/changes/` — example change folders
- `OpenSpec/openspec/AGENTS.md` — how OpenSpec instructs the agent to manage the lifecycle
- `OpenSpec/src/commands/archive.ts` — archive command implementation

**Decision criterion**: Adopt the per-change folder convention for Dante PRDs going forward, with a one-day refactor of existing flat `Docs/PRDs/` into the new structure. PRD-MASTER itself becomes the first artifact under the new convention. Attribution to OpenSpec for the structural pattern.

**Output**: `.danteforge/OSS_HARVEST/per_change_folder_lifecycle_pattern.md`

### Pattern D: Two-Stage Review (Spec Compliance, then Code Quality)

Superpowers' subagent-driven-development uses two-stage review: first verify spec compliance, then review code quality. This is more rigorous than Matt's single-pass review. Read:

- `superpowers/skills/subagent-driven-development/SKILL.md`
- `superpowers/skills/requesting-code-review/SKILL.md`

**Decision criterion**: Adopt two-stage review as the default for all Dante-native skills that produce committed artifacts. Spec compliance check uses the harsh-scorer dimensions for Spec-Driven Pipeline; code quality check uses dimensions for Maintainability, Testing, Error Handling.

**Output**: `.danteforge/OSS_HARVEST/two_stage_review_pattern.md`

### Pattern E: Severity-Graded Blocking

Superpowers' code review skill uses severity-graded blocking ("critical issues block progress"). This is explicit constitutional logic in skill form. Read:

- `superpowers/skills/requesting-code-review/SKILL.md`
- `superpowers/skills/receiving-code-review/SKILL.md`

**Decision criterion**: Adopt the severity taxonomy for Dante's three-way promotion gate. Map severity levels to the three gate components (Forge policy, evidence chain integrity, harsh score). Critical = blocks any of three gates failing. Major = blocks if two of three fail. Minor = warning only.

**Output**: `.danteforge/OSS_HARVEST/severity_graded_blocking_pattern.md`

---

## Harvest Discipline

### Required reading order

For each skill: read all source files listed for that skill before opening any text editor. Do not start writing the Dante-native version until the function comparison document is complete.

### Function comparison document format

Each function comparison document follows this structure:

```markdown
# <Skill Name> Function Comparison

## Sources read
- <file>: <brief summary of the logic in that file>
- <file>: <brief summary>
- ...

## Function-by-function comparison

### <Function name>
**Source A approach**: <description, paraphrased not quoted>
**Source B approach**: <description, paraphrased not quoted>
**Source C approach**: <description, paraphrased not quoted>
**Decision**: <which approach Dante adopts>
**Rationale**: <why>
**Attribution**: <which source the chosen approach is derived from>
**Constitutional integration**: <how the choice integrates with Dante substrate>

### <Next function>
...

## Synthesis
The Dante-native version of <skill> takes the following per-function approach:
- <function>: from <source>, modified by <Dante addition>
- <function>: from <source>, modified by <Dante addition>
- ...

## Constitutional additions (Dante-specific)
1. ...
2. ...

## Anti-stub verification
The following clean-room reimplementation tests confirm no verbatim copying:
- <test>
- <test>
```

### Three-way gate before implementation

Each function comparison document must score 9.0+ on the harsh double scoring matrix for completeness, attribution accuracy, and constitutional coherence before the Dante-native skill implementation begins.

### Anti-stub enforcement

Clean-room reimplementation discipline applies. Read the source. Write notes in your own words. Close the source. Implement from notes. Do not paste even small snippets. Verify by harsh-scorer anti-stub check.

### Time budget

Per skill: 4-6 hours of orchestrator time for source reading and function comparison, then 4-6 hours for Dante-native implementation. Total per skill: 8-12 hours. Five skills: 40-60 hours. At demonstrated build rate with 2-3 parallel instances: 3-4 calendar days.

This is longer than the original Phase 2 estimate of 3-4 days because the function comparison step is now mandatory and adds 4-6 hours per skill. The trade-off is that the resulting skills are demonstrably better than the originals on per-function logic, not just wrappers around them.

---

## What This Document Replaces

This document supersedes Phase 2 sections 7.2 and 7.3 of PRD-MASTER. The original sections specified Dante-native skills primarily by their constitutional additions. This document specifies them by function-level harvest from multiple sources, with constitutional additions as the second layer. The build is the same; the discipline of getting there is more rigorous.

PRD-MASTER v1.0 remains the canonical specification document. This document is `PRD-MASTER-ADDENDUM-001-Function-Level-Harvest.md` and lives alongside it.

---

## What This Document Cannot Replace

I (Claude, in this conversation) could not read the actual SKILL.md files of Superpowers or OpenSpec from this conversation environment. The function comparisons specified above are the comparisons Claude Code (in your local environment, with the access I lack) must perform. The decision criteria are mine; the actual function-level evidence must come from Claude Code reading the real files.

This is the limitation of the harvest specification. I am specifying the discipline; Claude Code executes the discipline against ground truth I cannot see.

If at any point Claude Code finds that the actual logic in a source file contradicts what this document assumes, Claude Code follows the actual logic and updates this document with a note explaining the divergence. The function comparison documents are the source of truth, not this specification.

---

**END OF ADDENDUM 001**

*The harvest begins when Claude Code is given PRD-MASTER plus this addendum and invokes `/oss-harvest --target=obra/superpowers --target=Fission-AI/OpenSpec --target=mattpocock/skills --mode=function-level-comparison`. Three-way gate enforced on each function comparison document. Anti-stub verification required. Constitutional additions mandatory.*
