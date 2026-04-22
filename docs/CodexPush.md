Initial impression: the project is much more serious than a typical “agent wrapper.” It already has release thinking, packaging, registry setup, extension parity, and explicit operator workflows. The key question now is not vision; it is whether the runtime and release gates hold up under a fresh install and real end-to-end use.

First concrete issue: the repo cannot even begin verification on a fresh clone until dependencies are installed. That is normal by itself, but it means I cannot trust the project’s own readiness claims until I run the real gates from a clean install.

Thought for 9m 22s

My read: this is a strong power-user alpha, possibly a private beta, but not yet a clean public GA release.

It has real substance. It is not just a pile of prompts. The project already has:

a clear CLI workflow and command surface
first-class VS Code packaging
local/manual/live execution modes
release scripts and GitHub workflows
anti-stub discipline
a serious test surface
multi-assistant setup logic
design/QA/OSS/autoforge concepts that are meaningfully integrated

I was able to confirm in this environment that these pass:

npm run typecheck
npm run lint
npm run build
npm run check:anti-stub
npm run check:cli-smoke

I could not fully certify npm test or npm run release:check here because the sandbox kept resetting on heavier runs, so I will not pretend those are proven from my side.

Verdict

For internal use or a controlled developer preview: close.

For “release to the world”: not yet.

I would not call this fully shippable to the public until the trust gaps below are closed.

What is already strong

The architecture is thoughtful.

The best parts are:

Clear workflow spine
The CLI has a real pipeline, not just random commands. init -> constitution -> specify -> clarify -> plan -> tasks -> forge -> verify -> synthesize is coherent.
Good release instincts
You already have release scripts, VS Code packaging, smoke checks, live canary workflow, install-smoke logic, anti-stub checks, and repo hygiene checks.
Agent-agnostic positioning
The assistant installer and registry setup are a smart differentiator. The project is trying to meet users where they work instead of forcing one IDE or one model.
Local-first fallback
The fact that many commands can degrade to local or prompt mode is a real strength. That makes the tool more resilient and more usable.
Breadth with some actual implementation
This is not only docs. There is real code behind autoforge, QA, browsing, MCP, assistant setup, scoring, party mode, and design flows.
The biggest problems blocking public launch

These are the main reasons I would not call it “world-ready” yet.

1. There is a trust gap between claimed readiness and provable readiness

Your docs and state files still talk about 0.8.0, while the package and extension are 0.9.0.

That matters because public tools live or die on trust. When the README, release guide, operational-readiness doc, current-state doc, and package metadata do not all tell the same story, users stop believing the rest of the claims.

Concrete examples from the repo:

package.json is 0.9.0
vscode-extension/package.json is 0.9.0
README.md, RELEASE.md, docs/Operational-Readiness-v0.8.0.md, and .danteforge/CURRENT_STATE.md still present 0.8.0 language

That is not fatal, but it is a launch blocker.

2. Some “safety/enforcement” features are audit-only, not real enforcement

This is the biggest architectural honesty issue.

In src/core/safe-self-edit.ts, protected-path self-edits are auto-approved. The file even says the escalation gate is deferred. So today, “safe self-edit” is mostly logging plus warning, not true enforcement.

That means the project is stronger at tracking risky mutation than actually blocking it.

For a public agentic tool, that distinction is huge.

3. Verification/completion can overstate reality

In src/core/completion-tracker.ts, verification for non-web projects is basically driven by whether lastVerifiedAt exists. In other words, the readiness signal is timestamp-driven, not evidence-driven enough.

That makes the scoring layer easier to drift away from reality.

A public launch needs:

artifact-backed verification
test-result-backed verification
release-gate-backed verification
not just state-field-backed verification
4. The build path still contains local-machine assumptions

The postbuild sync script is a real concern.

scripts/sync-dantecode.mjs references:

C:/Projects/DanteForgeEngine
C:/Projects/DanteCode

It currently skips harmlessly when those paths do not exist, but that still means a normal public build path contains developer-machine assumptions and cross-project coupling.

That should be moved out of the standard build or made explicitly dev-only.

5. Advanced flows are not turnkey enough yet

A lot of the cooler functionality depends on external setup:

live providers
Ollama
browse daemon
Figma MCP
assistant registries
local binaries / host-specific config

That is fine for you.
That is not fine for the average public user unless the setup becomes extremely clear and deterministic.

Right now, the tool looks best suited for sophisticated users who already understand model setup, local runtimes, PATH issues, and IDE assistant registries.

6. The uploaded snapshot is noisy

The zip is full of generated and environment-specific content. Most of the uploaded entries are not source code.

Notably, the snapshot includes:

coverage/
dist/
a large .danteforge/ state/artifact area
vscode-extension/node_modules/

In fact, a huge portion of the zip is the vendored vscode-extension/node_modules tree.

That may just be your working snapshot and not your actual release branch, but public release artifacts need a much cleaner discipline.

Does it have everything needed to launch?

No.

It has most of the shape needed to launch, but not all of the proof.

The difference matters.

What you have:

a credible core concept
meaningful implementation
a differentiated workflow
a promising CLI/extension pairing
decent engineering discipline

What you still need before public launch:

hard proof of end-to-end success on clean machines
accurate and synchronized release truth
real enforcement where the product claims enforcement
cleaner packaging and build isolation
a simpler first-run experience
a narrower, more honest initial product promise
What I would improve first

I would improve this in this order.

Phase 1 — Make the project honest
Unify versioning and release truth
Update all docs and state templates to 0.9.0 or whatever the real target is.
Remove stale “validated locally” claims unless they are regenerated from actual checks.
Separate developer-only scripts from public build
Move the DanteCode sync out of postbuild.
Make it an explicit dev script like build:local-sync.
Stop using state-only readiness as proof
Change completion/verification logic so “tests passing” comes from real evidence:
stored verification artifact
parsed test output
release-check receipt
exact command status
Phase 2 — Make enforcement real
Replace auto-approved self-edit with real policy
Protected paths should require one of:
explicit CLI flag
interactive confirm
signed policy file
CI allowlist
or fail closed

Make verify evidence-driven
verify should emit a structured receipt such as:

command
timestamp
git SHA
node version
platform
test result
build result
lint result
release-check result
live-check result

Then the completion tracker should consume that, not just lastVerifiedAt.

Phase 3 — Prove the golden paths

Define 3 official golden paths
Public users need clarity. I would explicitly support only these at launch:

CLI local-only path
CLI with live provider path
VS Code extension path

Everything else can be experimental.

Create a clean smoke repo and run real end-to-end
Add a tiny sample repo and prove:

install
init
specify
plan
tasks
forge in prompt mode
verify
synthesize

Then separately prove:

live provider execution
extension install and command launch
assistant setup on a clean machine

Add cross-platform matrix
Test on:

Windows
macOS
Linux

This tool is too environment-sensitive to launch without that.

Phase 4 — Improve product usability
Make first-run onboarding much simpler
The tool should answer, immediately:
what mode am I in
what works without keys
what optional dependencies are missing
what exact next command should I run
Upgrade the VS Code extension from terminal launcher to guided UI
Right now it looks useful, but still thin. For a public release, I would want:
status panel
detected install mode
current project stage
artifact quick-open
verification summary
setup diagnostics
Mark unstable features explicitly
Things like browse/Figma/live canary/autoforge should be labeled:
stable
beta
experimental
My launch recommendation

I would not launch this to the whole world as “finished.”

I would launch it in stages:

Private alpha
Trusted technical users only. Focus on install friction, broken flows, missing assumptions.
Power-user beta
Developers already using Codex/Claude/OpenCode/Cursor. Narrow promise: “structured local-first agent workflow CLI.”
Public GA
Only after the core promise is dead simple and reproducible.
My scoring matrix

For the repo you uploaded, based on code inspection plus the checks I could run:

Area	Score / 10	Notes
Vision / product idea	9.0	Strong and differentiated
Core CLI architecture	8.2	Real system, not just prompt glue
Release engineering intent	7.8	Good scripts/workflows, but trust gaps remain
Documentation honesty / consistency	5.2	Version drift and stale readiness narrative
Real enforcement / safety	4.8	Audit is ahead of enforcement
End-to-end proof	5.8	Some proof exists, not enough certified from my side
Cross-platform readiness	5.5	Local assumptions still visible
VS Code product polish	6.2	Useful, but still thin
Public launch readiness	5.9	Not ready for broad release
Private beta readiness	7.4	Reasonable target now
Bottom line

This is a good project.

More than that, it is a serious project.

But the next leap is not adding more features. The next leap is converting the current system from “impressive and ambitious” into “boringly trustworthy.”

That means:

less narrative drift
less hidden machine-specific behavior
more evidence-backed verification
more real enforcement
fewer experimental promises in the public launch surface

Once those are fixed, this becomes much more dangerous in a good way.

If you want, I’ll turn this directly into a launch-closing V+E-style implementation master plan with workstreams, gates, acceptance criteria, and release sequence.

Please create the V+E Style Masterplan to close all the gaps

I’m basing this on the actual repo shape, not just the earlier verdict. I’m checking the planning docs, release scaffolding, and the parts that most often create false confidence so the masterplan closes real gaps instead of generic ones.

I’ve identified the core closure tracks. The good news is the project does not need a conceptual rewrite; it needs a release-hardening program that converts “advanced alpha” into “provable product.”

Thought for 2m 15s
DanteForge — Launch Closure V+E Masterplan
0. Executive verdict

DanteForge does not need a vision rewrite. It needs a ship-readiness hardening program.

The repo already has the bones of a real product:

a meaningful CLI workflow
packaging and release intent
a VS Code surface
multi-assistant integration
local-first execution paths
quality gates and anti-stub discipline

The gaps are not “missing imagination.”
They are:

release truth drift
enforcement that is logged but not truly enforced
verification signals that can overstate reality
build/release paths polluted by local-machine assumptions
advanced features not yet narrowed into a clean GA promise
insufficient end-to-end proof on clean machines

This masterplan is designed to close those gaps and get DanteForge to a credible public beta / GA bar.

1. Mission

Convert DanteForge from:

“advanced alpha with strong architecture”

into:

“boringly trustworthy, reproducible, installable, evidence-backed product.”

2. Ship bar

DanteForge is only considered shippable when all of the following are true:

V — Verification
clean clone install passes on Windows, macOS, Linux
local-only golden path passes end to end
live-provider golden path passes end to end
VS Code extension path passes end to end
release package installs from tarball and from registry
verification output is artifact-backed, not timestamp-backed
current-state and readiness docs are generated from actual results, not hand-maintained claims
E — Enforcement
protected self-edit is fail-closed by default
release readiness cannot be claimed from stale docs or stale state
completion scoring cannot show green unless backed by a real verify receipt for the current SHA
public build cannot depend on local hardcoded paths or sibling repos
experimental features cannot silently appear as stable
3. Concrete repo truths this plan is closing

These are the specific fault lines visible in the snapshot.

A. Version / readiness truth drift

The repo is split between 0.9.0 and 0.8.0 narratives:

package.json = 0.9.0
vscode-extension/package.json = 0.9.0
README.md still presents 0.8.0
.danteforge/CURRENT_STATE.md still presents 0.8.0
docs/Operational-Readiness-v0.8.0.md still anchors active readiness language

That is a trust problem.

B. Public build path still contains local-machine coupling

scripts/sync-dantecode.mjs is wired into postbuild and references local Windows paths and a sibling DanteCode environment.

That script may skip harmlessly, but it does not belong in the default public build path.

C. “Safe self-edit” is not yet true enforcement

src/core/safe-self-edit.ts currently auto-approves protected-path edits and explicitly says the escalation gate is deferred.

That is audit-first, not fail-closed enforcement.

D. Verification/completion can overstate reality

src/core/completion-tracker.ts treats lastVerifiedAt as “tests passing.”

That is too weak.
A timestamp is not evidence.

E. Verify writes state, but not a real receipt spine

src/cli/commands/verify.ts runs useful checks, but the repo still needs a stronger receipt model:

current SHA
platform
node version
exact command set
pass/fail by gate
durable evidence artifact
machine-readable output
F. Public promise surface is too wide for current proof

The README positions a broad capability set. The product should launch on a narrower, proven surface:

local-only pipeline
live-provider pipeline
VS Code workflow surface

Everything else should be explicitly marked beta or experimental.

4. Constitutional launch rules

These rules should govern the entire hardening effort.

Rule 1 — No new feature expansion until the spine is honest

No major new commands or showcase features until:

version truth is aligned
build is self-contained
verification is evidence-backed
self-edit enforcement is real
Rule 2 — Evidence outranks narrative

No file in the repo may claim:

“validated”
“ready”
“passed”
“GA hardening complete”
unless generated from a real gate or evidence artifact.
Rule 3 — Fail closed on protected mutation

Protected core files must not be auto-approved for self-edit in public mode.

Rule 4 — One source of release truth

Version, readiness, stability level, and supported golden paths must come from one canonical source and be rendered outward from there.

Rule 5 — Stable, beta, experimental must be explicit

The product must stop implying that every advanced path is equally production-ready.

5. Workstream plan
WS-1 — Release Truth Normalization
Objective

Remove version drift, stale readiness language, and hand-maintained release claims.

Required changes
Create a canonical release metadata source, for example:
src/core/release-manifest.ts or
release/release-manifest.json
Drive all outward version/readiness references from that source:
README.md
.danteforge/CURRENT_STATE.md
operational-readiness doc
extension display/version text
package tarball examples
Replace static “CURRENT_STATE” hand-editing with a generated artifact flow.
Archive old readiness docs instead of allowing them to read as current truth.
Add a guard that fails CI if repo-facing current docs mention a version different from the package version unless explicitly marked archive/history.
Files to touch
README.md
.danteforge/CURRENT_STATE.md
docs/Operational-Readiness-v0.8.0.md
package.json
vscode-extension/package.json
release scripts/docs
new canonical release manifest file
Acceptance
no active doc presents 0.8.0 as current release truth
CURRENT_STATE is generated, not hand-curated
CI fails on version drift across root package, extension, README current status, and active readiness docs
Score impact
documentation honesty: 5.2 → 9.5
WS-2 — Build Isolation & Reproducibility
Objective

Make public build and release checks self-contained and machine-agnostic.

Required changes
Remove scripts/sync-dantecode.mjs from the default postbuild path.
Create separate scripts:
build
build:public
build:dev-sync
Public build must never assume:
sibling repos
hardcoded Windows paths
local plugin cache paths
Add a release gate that scans scripts for disallowed absolute path assumptions in public build flow.
Ensure tarball content and release packlist exclude noisy/non-product artifacts:
coverage outputs
session state
extension vendored dependencies unless intentionally packaged
local caches
Files to touch
package.json
scripts/sync-dantecode.mjs
release scripts
packlist / ignore files
repo hygiene checks
Acceptance
npm run build succeeds on a clean clone without DanteCode or DanteForgeEngine present
npm run release:check does not rely on any local-machine path or sibling project
tarball contains only intended runtime assets
Score impact
cross-platform readiness: 5.5 → 8.8
release engineering: 7.8 → 9.2
WS-3 — Real Enforcement for Protected Self-Edit
Objective

Convert audit-only protected self-edit into actual enforcement.

Required changes
Replace auto-approve behavior in src/core/safe-self-edit.ts with policy-driven enforcement.
Introduce explicit policy modes:
deny (default for public/stable)
confirm
allow-with-audit
Require one of the following for protected edits:
explicit CLI flag
interactive approval
policy file allowlist
CI-authorized automation context
Add backout metadata:
before hash
after hash
file snapshot or reverse patch
Log both denied and approved attempts.
Surface protected-edit denials in verify and doctor flows.
Files to touch
src/core/safe-self-edit.ts
src/core/state.ts
src/cli/commands/verify.ts
doctor / diagnostics flow
tests for protected mutation paths
Acceptance
protected core paths are denied by default
approved protected edits leave a durable audit trail with hashes and recovery data
tests cover deny / confirm / allow-with-audit / rollback metadata
Score impact
real enforcement: 4.8 → 9.0
WS-4 — Evidence-Backed Verification Spine
Objective

Replace timestamp-based verification confidence with durable machine-readable receipts.

Required changes
Introduce a verify receipt artifact, for example:
.danteforge/evidence/verify/<timestamp>.json
.danteforge/evidence/verify/latest.json
Receipt must include:
git SHA
version
platform
node version
cwd
project type
command set run
pass/warn/fail counts
per-gate results
release-check result
live-check result when used
artifact freshness result
protected-mutation status
Add human-readable summary artifact:
.danteforge/evidence/verify/latest.md
verify should support --json
completion-tracker must read receipt status, not just lastVerifiedAt
state should track:
lastVerifyReceiptPath
lastVerifySha
lastVerifyStatus
Files to touch
src/cli/commands/verify.ts
src/core/completion-tracker.ts
src/core/state.ts
evidence helpers
tests
Acceptance
a green completion score is impossible without a green receipt for the current SHA
verify receipts are durable and machine-readable
stale verify results are detected and surfaced
Score impact
end-to-end proof: 5.8 → 9.0
WS-5 — Golden Path E2E Proof
Objective

Prove DanteForge works from clean setup to verified completion in official supported modes.

Supported GA golden paths
CLI local-only
CLI live-provider
VS Code extension using workspace/global CLI
Required changes
Create fixture repos for E2E tests:
minimal CLI repo
minimal web repo
Add E2E scripts that execute:
init
constitution
specify
clarify
plan
tasks
forge --prompt or live equivalent
verify
synthesize
Add install-smoke on:
clean temp directory
tarball install
global install
Prove assistant setup installs safely and explicitly.
Validate fallback behavior when keys/providers are absent.
Files to touch
new tests/e2e/*
fixture repos
release/install smoke scripts
docs for supported paths
Acceptance
clean-clone E2E passes in CI for the supported golden paths
failure messages are actionable when prerequisites are absent
E2E outputs produce verify receipts and final synthesis artifacts
Score impact
public launch readiness: 5.9 → 9.0
WS-6 — First-Run Onboarding & Diagnostics
Objective

Make the product understandable to non-authors on day one.

Required changes
Upgrade danteforge init into a true environment/status primer:
detected mode
project type
stable/beta/experimental features available
provider status
Ollama status
browse status
assistant registry status
next exact recommended command
Upgrade doctor to produce:
concise human summary
--json machine output
Introduce explicit capability matrix:
works offline
needs provider key
needs Ollama
needs browse
experimental
Prevent silent degradation when dependencies are missing; print exact mode shift.
Files to touch
init command
doctor command
diagnostics helpers
README / quickstart / standalone setup docs
Acceptance
fresh user can determine in under 60 seconds:
what works now
what is missing
what next command to run
no major command silently drops into a weaker mode without telling the user
Score impact
usability: 6.x → 9.0
WS-7 — VS Code Extension Parity Hardening
Objective

Make the extension a trustworthy operator surface, not just a launcher.

Required changes
Add a project status panel showing:
detected binary path
workspace/global mode
current workflow stage
last verify receipt status
next recommended action
missing prerequisites
Surface verify receipts and doctor diagnostics directly in the extension.
Clearly mark commands/features as stable/beta/experimental.
Ensure extension messaging matches CLI truth exactly.
Add extension integration tests for:
workspace-local binary
global fallback
missing binary
stale verify receipt
command failure display
Files to touch
vscode-extension/src/*
extension package metadata
extension tests
shared diagnostics interface if needed
Acceptance
extension can show live project health without requiring user to open raw .danteforge files
extension never reports green when CLI truth is red or stale
Score impact
VS Code polish: 6.2 → 8.8+
WS-8 — Stability Matrix & Public Promise Narrowing
Objective

Stop overpromising. Launch only what is proven.

Required changes
Add a canonical stability manifest for every major command/capability:
stable
beta
experimental
Narrow the README promise to supported GA surface only.
Move advanced/unproven features into clearly labeled sections:
live canary
browse integrations
Figma / design refinement
OSS harvest/autoresearch if not yet E2E-proven
Reduce comparative claims unless directly supported by shipped proof.
Files to touch
README
quickstart docs
command docs
help output
stability manifest source
Acceptance
no public doc implies stable support for a flow not covered by tests/gates
every command shown in help can be mapped to a stability tier
Score impact
trustworthiness: major improvement
WS-9 — CI / Release Promotion Ladder
Objective

Create a release system that promotes builds through evidence, not optimism.

Required changes
Add CI matrix:
Windows
macOS
Linux
Node supported versions
Required release gates:
typecheck
lint
anti-stub
tests
build
CLI smoke
repo hygiene
plugin manifest checks
install smoke
pack dry-run
extension verify
E2E golden paths
verify receipt integrity test
Add release promotion ladder:
dev snapshot
internal alpha
private beta
RC
GA
Generate release evidence bundle:
release summary
test matrix summary
install smoke summary
tarball manifest
verify receipts
known limitations
Files to touch
.github/workflows/*
release scripts
evidence generation scripts
documentation
Acceptance
a release tag cannot be produced without a full evidence bundle
CI matrix is green on supported platforms
public RC and GA releases have attached evidence summary
Score impact
release confidence: 9+
6. Implementation order
Phase 1 — Trust spine

Do these first and do not skip them.

WS-1 Release Truth Normalization
WS-2 Build Isolation & Reproducibility
WS-3 Real Enforcement for Protected Self-Edit
WS-4 Evidence-Backed Verification Spine

This is the minimum needed to make the project honest.

Phase 2 — Product proof
WS-5 Golden Path E2E Proof
WS-6 First-Run Onboarding & Diagnostics
WS-7 VS Code Extension Parity Hardening

This is what makes the project usable by someone who did not build it.

Phase 3 — Public launch shaping
WS-8 Stability Matrix & Public Promise Narrowing
WS-9 CI / Release Promotion Ladder

This is what makes the release credible to the world.

7. Hard acceptance gates

These are the non-negotiable ship gates.

Gate G1 — Truth Gate
no active version drift
no stale readiness claims
CURRENT_STATE generated from actual data
Gate G2 — Enforcement Gate
protected self-edit is fail-closed by default
deny/approve actions are audited with hashes
verify surfaces protected-edit violations
Gate G3 — Evidence Gate
verify produces durable JSON + markdown receipts
completion tracker uses receipt status tied to current SHA
stale receipts fail readiness
Gate G4 — Repro Gate
public build works from clean clone with no sibling repos
no hardcoded local-machine assumptions in public build path
Gate G5 — Golden Path Gate
local-only E2E passes
live-provider E2E passes
VS Code path passes
Gate G6 — Launch Honesty Gate
every public feature is labeled stable/beta/experimental
README/quickstart only sell what is proven
Gate G7 — Promotion Gate
CI matrix green
release evidence bundle generated
tarball install proven
extension verify proven
8. Specific file-level actions

These are the highest-leverage edits.

Immediate edits
README.md
remove stale 0.8.0 active-status language
narrow public promise
add stability tier references
.danteforge/CURRENT_STATE.md
stop treating this as hand-authored truth
replace with generated output or template + generated artifact path
docs/Operational-Readiness-v0.8.0.md
archive or replace with current versioned readiness doc
strip “current shipped state” language if no longer current
package.json
remove postbuild dependence on local sync
split public build from dev-only sync build
scripts/sync-dantecode.mjs
dev-only
never invoked by default public build
src/core/safe-self-edit.ts
remove auto-approve default
add policy-controlled deny/confirm/allow-with-audit
src/core/completion-tracker.ts
replace lastVerifiedAt = tests passing logic
require verify receipt
src/cli/commands/verify.ts
emit evidence receipts
expose machine-readable output
write current SHA/status/version
fail on stale CURRENT_STATE and stale receipts
vscode-extension/src/*
add status/health surface tied to CLI truth
9. Release ladder recommendation
Stage 1 — Internal alpha

Audience: you and a few technical users
Goal: remove truth drift, make build self-contained, harden verify receipts

Stage 2 — Private beta

Audience: power users already comfortable with Codex / Claude / local tooling
Goal: prove clean install, golden paths, extension parity

Stage 3 — Public beta

Audience: developer public
Goal: ship only stable supported flows; advanced capabilities remain beta/experimental

Stage 4 — GA

Only after:

clean CI matrix
strong evidence bundle
trustworthy onboarding
no stale status files
real enforcement
documented golden paths
10. Final blunt verdict

No, the current snapshot does not have everything needed to launch to the world.

But it does have enough to become shippable without a rewrite.

The path is:

make the repo honest
make enforcement real
make verification evidence-backed
prove the three golden paths
narrow the public promise to what is actually proven

That is how DanteForge becomes a real release instead of an impressive prototype.

If you want, I’ll turn this into the next layer: a Codex-ready V+E execution packet with ordered tasks, file targets, acceptance criteria, and command-by-command implementation steps.

Please create the Codex Ready V+E Execution Packet

I’m grounding this packet in the actual repo structure and command surface so it can be handed to Codex as an execution brief, not just a planning doc.

I have the concrete file targets now. The packet can be much tighter because the gaps map cleanly to a handful of files and release scripts rather than requiring a repo-wide rewrite.

Thought for 2m 0s
DanteForge — Codex-Ready V+E Execution Packet

This packet is grounded in the uploaded repo snapshot.

Baseline facts from the repo

These are the exact gaps this packet closes:

Root package.json is 0.9.0, but active docs still present 0.8.0 release truth.
README.md still says DanteForge 0.8.0 is in GA hardening.
.danteforge/CURRENT_STATE.md still says Version | 0.8.0 and claims local validation.
package.json runs postbuild: node scripts/sync-dantecode.mjs.
scripts/sync-dantecode.mjs is developer-coupling and should not sit on the public build path.
src/core/safe-self-edit.ts still auto-approves protected edits.
src/core/completion-tracker.ts treats lastVerifiedAt as tests-passing truth.
src/cli/commands/verify.ts writes state/audit, but does not emit a proper evidence receipt spine.
VS Code extension exists and packages, but the extension surface is still thinner than the CLI truth surface.
Root release gates already exist and should be hardened, not replaced:
verify
verify:all
release:check
release:check:strict
release:check:simulated-fresh
1. Mission

Take DanteForge from advanced alpha / private beta to credible public beta / GA candidate without widening scope.

The goal is not “more features.”
The goal is:

make release truth honest
make enforcement real
make verification evidence-backed
prove the supported golden paths
narrow the public promise to what is actually tested
2. Public launch scope

For this packet, DanteForge only needs to be publicly solid in 3 surfaces:

CLI local-first path
CLI live-provider path
VS Code extension path

Anything else must be labeled beta or experimental.

3. Non-negotiable Codex constraints

Paste these constraints into Codex before any work begins.

You are patching DanteForge toward a shippable public beta / GA candidate.

Non-negotiable rules:
1. Do not broaden product scope.
2. Do not add showcase features unrelated to ship readiness.
3. Prefer small, composable edits. One batch at a time.
4. Keep existing command names stable unless absolutely necessary.
5. No stubs, TODOs, placeholders, mocked success, or narrative claims without evidence.
6. Protected enforcement must fail closed by default.
7. Verification must become evidence-backed and SHA-aware.
8. Public build must not depend on local machine paths or sibling repos.
9. Any public-facing release/readiness/version text must be generated from one canonical source of truth.
10. Each batch must end with tests, commands run, and a concise delta summary.

Work in small batches:
- Prefer 1–4 source files plus tests/docs.
- Avoid introducing files >500 LOC unless modifying an existing file already above that size.
- Preserve backward compatibility where reasonable.
- Add tests for every logic change.
- Do not claim completion unless listed acceptance checks pass.
4. Definition of done

DanteForge is considered shippable for this packet only when all are true:

no active 0.8.0 release truth remains in current docs/artifacts
public build works without DanteCode/DanteForgeEngine sibling assumptions
protected self-edit is deny-by-default or confirm-by-policy
verify emits durable JSON/MD receipts
completion tracking uses verify receipts, not just lastVerifiedAt
stale receipts fail readiness
supported golden paths pass on clean checkout
README/extension/help clearly separate stable vs beta vs experimental
release evidence bundle can be produced from repo scripts
5. Execution order

Do these in order. Do not skip ahead.

Batch 0 — Freeze release truth and scope
Goal

Stop drift before touching logic.

Files
README.md
.danteforge/CURRENT_STATE.md
docs/Operational-Readiness-v0.8.0.md
RELEASE.md
Implement
Mark docs/Operational-Readiness-v0.8.0.md as archived or historical if it is no longer current.
Remove active-current wording that implies 0.8.0 is the live release.
Replace current-state/readiness claims with language that points to generated verification artifacts.
Narrow public promise to the 3 supported surfaces only.
Add explicit stability framing:
Stable: CLI local-first, CLI live-provider, VS Code extension packaging path
Beta/Experimental: anything beyond those if not proven end-to-end
Acceptance
No active current doc presents 0.8.0 as current release truth.
No doc claims “validated locally” unless the claim points to a generated artifact path.
Public README language matches actual target scope.
Commands
npm run lint
npm run typecheck
Batch 1 — Create canonical release truth source
Goal

One source of truth for version, stability, and supported surfaces.

Files
src/core/release-manifest.ts or src/core/release-manifest.json
src/cli/commands/verify.ts
README.md
RELEASE.md
Implement

Create a canonical release manifest that includes:

package version
extension version
supported surfaces
stability tiers
evidence artifact locations
current release phase

Use this manifest as the only source for outward “current release” truth.
Do not hand-maintain version strings in multiple places.

At minimum:

root package version must match manifest
extension version must match manifest or be explicitly derived/validated
verify should compare current docs/artifacts against manifest where applicable
Acceptance
One canonical manifest exists.
Active docs reference the manifest-driven release truth.
Verify can flag drift between manifest and package version/docs.
Tests

Add or extend:

tests/cli-release-readiness.test.ts
new tests/release-manifest.test.ts
Commands
npm test -- tests/cli-release-readiness.test.ts tests/release-manifest.test.ts
npm run lint
npm run typecheck
Batch 2 — Remove public build coupling to local machine paths
Goal

Make the public build self-contained.

Files
package.json
scripts/sync-dantecode.mjs
any release script invoking build behavior
Implement
Remove scripts/sync-dantecode.mjs from default postbuild.
Replace with explicit separation:
build or build:public
build:dev-sync
Ensure public build path never assumes:
sibling DanteCode repo
sibling DanteForgeEngine repo
hardcoded Windows paths
author workstation layout

If sync logic is still useful for you personally, keep it behind an explicit opt-in dev script.

Acceptance
npm run build works as public build with no local sync assumptions.
Local sync remains available only as explicit dev command if retained.
prepublishOnly uses public-safe build path only.
Tests

Add or extend:

tests/cli-release-readiness.test.ts
tests/local-artifacts.test.ts if relevant
Commands
npm run build
npm run pack:dry-run
npm run lint
npm run typecheck
Batch 3 — Replace auto-approved self-edit with real enforcement
Goal

Protected mutation must fail closed by default.

Files
src/core/safe-self-edit.ts
src/core/state.ts
src/cli/commands/verify.ts
Implement

Add explicit self-edit policy modes:

deny (default public/stable)
confirm
allow-with-audit

Minimum requirements:

protected paths must not auto-approve by default
approval decision must be explicit
audit entry must include:
timestamp
file path
action
reason
approved true/false
before hash if available
after hash if available
policy mode used
denied attempts must also be logged
verify must surface recent denied/approved protected mutations in a meaningful way

State additions to consider:

selfEditPolicy?: 'deny' | 'confirm' | 'allow-with-audit'
lastProtectedEditAt?: string
lastProtectedEditDecision?: 'approved' | 'denied'

Do not build an interactive UX unless it already fits current command patterns. A deterministic policy gate is enough for now.

Acceptance
protected paths are denied by default
no code path auto-approves protected edits in public mode
audit log contains both denied and approved events
verify can report protected-edit enforcement state
Tests

Add or extend:

new tests/safe-self-edit.test.ts
extend any existing escalation/enforcement tests
Commands
npm test -- tests/safe-self-edit.test.ts tests/escalation.test.ts
npm run lint
npm run typecheck
Batch 4 — Add evidence-backed verify receipts
Goal

verify must produce durable evidence artifacts.

Files
src/cli/commands/verify.ts
src/core/state.ts
new helper file if needed, e.g. src/core/verify-receipts.ts
Implement

Add durable verify artifacts under a stable path, for example:

.danteforge/evidence/verify/latest.json
.danteforge/evidence/verify/latest.md
optionally timestamped historical receipts as well

Each receipt must include:

repo name / project name
package version
git SHA if available
timestamp
platform
node version
cwd
project type
command mode (--release, --live, etc.)
passed/warnings/failures arrays
counts
workflow stage
whether release verification ran
whether live verification ran
whether current-state freshness passed
whether protected-edit policy is fail-closed
final status: pass | warn | fail

Add --json output mode for CLI consumption if not present.

State additions:

lastVerifyReceiptPath?: string
lastVerifySha?: string
lastVerifyStatus?: 'pass' | 'warn' | 'fail'
Acceptance
verify emits receipt artifacts on every run
state records latest receipt path and status
latest receipt is machine-readable and human-readable
receipt status is not silently green if warnings/failures exist
Tests

Add or extend:

new tests/verify-receipt.test.ts
extend tests/e2e-workflow.test.ts or tests/e2e-pipeline-integration.test.ts
Commands
npm test -- tests/verify-receipt.test.ts tests/e2e-workflow.test.ts
npm run lint
npm run typecheck
Batch 5 — Make completion tracking receipt-based and SHA-aware
Goal

Stop using lastVerifiedAt as proof of tests passing.

Files
src/core/completion-tracker.ts
src/core/state.ts
src/cli/commands/verify.ts
Implement

Change verification logic so VerificationPhaseTracking.testsPassing only becomes true when:

latest verify receipt exists
receipt status is pass
receipt SHA matches current repo SHA, or a safe fallback policy is explicitly documented for non-git environments
receipt is not stale relative to workspace changes

For non-git environments:

define a deterministic fallback, such as checking receipt cwd + package version + timestamp + no newer tracked artifacts
do not silently treat non-git as green without clear basis

Keep lastVerifiedAt as informational only, not as the source of truth.

Acceptance
green completion cannot be achieved from timestamp alone
stale receipt or SHA mismatch prevents green verification completion
projected completion output remains human-readable
Tests

Extend:

tests/completion-tracker.test.ts
new tests/verify-freshness.test.ts if useful
Commands
npm test -- tests/completion-tracker.test.ts tests/verify-receipt.test.ts
npm run lint
npm run typecheck
Batch 6 — Strengthen init/doctor to expose real runtime truth
Goal

Fresh users should know exactly what works now.

Files
src/cli/commands/init.ts
src/cli/commands/doctor.ts
optionally shared helper, e.g. src/core/runtime-status.ts
Implement

Upgrade init and doctor to clearly report:

detected project type
stable/beta/experimental capability map
provider availability
local-only fallback mode
browse availability
assistant setup status
verify receipt status
next recommended command

Add explicit wording when commands are degrading to local/prompt mode.

Add doctor output for:

release manifest status
receipt freshness
protected self-edit policy
build/public-release readiness summary

Prefer structured internal helper(s) instead of duplicating logic.

Acceptance
fresh user can tell in one run of init or doctor:
what mode they are in
what is missing
what next command to run
no silent downgrade without telling the user
Tests

Extend:

tests/init.test.ts
add/extend tests/config-cli.test.ts or diagnostics tests
Commands
npm test -- tests/init.test.ts tests/config-cli.test.ts
npm run lint
npm run typecheck
Batch 7 — VS Code extension truth parity
Goal

The extension must reflect CLI truth, not marketing truth.

Files
vscode-extension/src/extension.ts
vscode-extension/src/runtime.ts
vscode-extension/src/cli-discovery.ts
vscode-extension/src/shell-safety.ts
Implement

Add extension-side status surfacing for:

detected CLI path
workspace/global resolution
last verify receipt status
release/stability tier summary
recommended next action
failure to find CLI or stale verify receipt

Do not build a big UI. Lightweight command/status surface is enough.
The point is parity and truth, not polish theater.

At minimum, the extension should:

detect missing CLI cleanly
surface stale receipt or failed verify status
not imply the workspace is green if CLI truth is stale/red
Acceptance
extension status matches CLI truth
missing CLI is clearly reported
stale receipt is clearly reported
extension verify still packages successfully
Commands
npm --prefix vscode-extension run build
npm --prefix vscode-extension run verify
Batch 8 — Golden path E2E hardening
Goal

Prove the 3 supported launch paths.

Files
tests/e2e-workflow.test.ts
tests/e2e-pipeline-integration.test.ts
tests/cli-release-readiness.test.ts
create new focused E2E tests if cleaner than overloading existing ones
Implement

Ensure automated E2E coverage exists for:

Path A — CLI local-first
init
constitution
specify
clarify
plan
tasks
forge in local/prompt-safe mode
verify
synthesize
Path B — CLI release verification
public-safe build
release check
install smoke
pack dry run
verify receipt produced
Path C — VS Code packaging path
extension build
extension package
CLI discovery fallback behavior validated where feasible

Use fixture repos if needed. Keep them small.

Acceptance
golden paths pass on clean workspace assumptions
failing prerequisites produce actionable errors
verify receipt is part of E2E assertions
Commands
npm test -- tests/e2e-workflow.test.ts tests/e2e-pipeline-integration.test.ts tests/cli-release-readiness.test.ts
npm run verify:all
npm run release:check
npm run release:check:strict
npm run release:check:simulated-fresh
Batch 9 — Final public promise tightening
Goal

Do not oversell what has not been proven.

Files
README.md
RELEASE.md
command docs under commands/ where needed
extension/package-facing copy where needed
Implement

Update public copy to reflect:

3 supported surfaces
stable/beta/experimental boundaries
evidence-backed release truth
exact install paths that are actually proven

Remove or soften any claim that implies:

all advanced features are equally mature
all assistant integrations are equally battle-tested
all live paths are GA if only some are proven
Acceptance
public docs now match what tests/gates prove
no “all strengths, no weaknesses” language in release-facing surfaces
docs reflect reality without underselling core strengths
Commands
npm run lint
npm run typecheck
npm run verify:all
6. Final release gate Codex must satisfy

Before calling this complete, Codex must be able to report all of the following as true:

[ ] Active docs no longer present stale 0.8.0 release truth
[ ] Canonical release manifest exists and governs current release truth
[ ] Public build path is self-contained and no longer runs dev sync by default
[ ] Protected self-edit is fail-closed by default
[ ] Verify emits durable JSON + MD receipts
[ ] State records receipt path/status/SHA
[ ] Completion tracking uses receipt truth, not just lastVerifiedAt
[ ] Init/doctor expose real runtime and release status
[ ] VS Code extension reflects CLI truth for status/discovery
[ ] Golden path tests pass
[ ] release:check passes
[ ] release:check:strict passes
[ ] release:check:simulated-fresh passes
7. Required evidence bundle at the end

Codex should finish by producing this summary in its final response:

Files changed

Exact list.

New tests added

Exact list.

Commands run

Exact commands and whether they passed.

Remaining known risks

Only real unresolved items.

Why this is now more shippable

Must map directly to:

truth
enforcement
receipts
golden paths
promise narrowing
8. Single master prompt to paste into Codex
Patch DanteForge toward a shippable public beta / GA candidate using the following ordered execution packet.

Mission:
- make release truth honest
- make enforcement real
- make verification evidence-backed
- prove golden paths
- narrow public promise to what is actually supported

Do not add unrelated features.

Repo truths to fix:
- root package is 0.9.0 while README and CURRENT_STATE still present 0.8.0 release truth
- package.json runs postbuild sync-dantecode dev coupling
- safe-self-edit auto-approves protected mutations
- completion-tracker treats lastVerifiedAt as tests-passing truth
- verify does not emit durable receipt artifacts
- extension surface must reflect CLI truth

Execution order:
1. Freeze release truth and scope in docs
2. Add canonical release manifest
3. Remove public build coupling from postbuild
4. Replace auto-approved self-edit with fail-closed policy
5. Add verify receipts (JSON + MD) and state wiring
6. Make completion tracking receipt-based and SHA-aware
7. Strengthen init/doctor runtime truth
8. Add extension truth parity
9. Harden golden path E2E coverage
10. Tighten final public promise

Rules:
- one batch at a time
- small edits
- no stubs/TODOs
- preserve command names where possible
- add tests with each logic change
- end each batch with files changed, commands run, and acceptance result

Definition of done:
- no active stale 0.8.0 release truth
- public build is self-contained
- protected self-edit fail-closed by default
- verify emits durable receipts
- completion tracker uses receipts, not timestamps
- golden path checks pass
- extension reflects CLI truth
- public docs match proven scope

Start with Batch 0 + Batch 1 only. After completing them, summarize:
- files changed
- tests added/updated
- commands run
- acceptance checks passed
- any blockers
9. Best execution strategy

Do not ask Codex to do this all in one shot.

Use this cadence:

Batch 0 + Batch 1
Batch 2
Batch 3
Batch 4 + Batch 5
Batch 6 + Batch 7
Batch 8 + Batch 9
Final release sweep

That keeps each run small enough to stay precise and testable.

If you want, I can turn this into the next layer as a Gen-by-Gen Mitosis packet with one Codex prompt per batch, already prewritten for copy/paste.