# Third-Party Notices

This file tracks provenance and license details for harvested/adapted code included in DanteForge.

## `src/harvested/gsd/`

- Upstream project: GSD (Get Shit Done)
- Upstream URL: https://github.com/gsd-build/get-shit-done
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `gsd-build`
- Local modifications:
  - Adapted into the DanteForge TypeScript monorepo under `src/harvested/gsd/`
  - Integrated with DanteForge state/handoff/verifier/logger modules
  - Wired into `danteforge forge` execution flow and shared CLI pipeline
  - Selected components only (agents/hooks/XML utilities), excluding upstream installer/test/CI surfaces

## `src/harvested/spec/`

- Upstream project: SPEC Kit
- Upstream URL: https://github.com/github/spec-kit
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `GitHub`
- Local modifications:
  - Templates/clarify patterns adapted for DanteForge artifact flow
  - Ported/integrated into the DanteForge TypeScript CLI and `.danteforge/` artifact convention
  - Command naming and workflow sequencing aligned to DanteForge (`constitution`, `specify`, `clarify`, `plan`, `tasks`)

## `src/harvested/dante-agents/`

- Upstream project: BMAD Method
- Upstream URL: https://github.com/bmad-code-org/BMAD-METHOD
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `bmad-code-org`
- Local modifications:
  - Rebranded/adapted as "Dante Agents" (trademark references stripped)
  - Selected agent roles, skills, workflows, help engine, and party-mode orchestration integrated into DanteForge
  - Interfaces and prompts adjusted to work with DanteForge wave execution and CLI command surfaces

## Imported skills under `src/harvested/dante-agents/skills/`

- Upstream project: Antigravity Awesome Skills
- Upstream URL: https://github.com/sickn33/antigravity-awesome-skills
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `Antigravity User`
- Local modifications:
  - Selected `SKILL.md` files are imported bundle-by-bundle via `danteforge skills import --from antigravity`
  - Imported skills are wrapped with DanteForge-specific constitution, gate, `STATE.yaml`, TDD, verify/build, party-mode, and worktree guidance
  - Destination directories may be sanitized to fit the packaged DanteForge skill layout
  - Phase 1 imports `SKILL.md` only; auxiliary upstream assets are not yet harvested automatically

## `src/harvested/gstack-harvest/`

- Upstream project: GStack Browser Automation
- Upstream URL: https://github.com/gstack/gstack
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `gstack`
- Local modifications:
  - Skills (browser-inspect, qa-lead, retro, ceo-review, paranoid-review) adapted for DanteForge v0.8.0
  - Integrated with DanteForge browse-adapter, qa-runner, retro-engine, ceo-review-engine, paranoid-review, and ship-engine
  - SKILL.md files wrapped with DanteForge-specific Iron Law, process, and constitution compliance sections
  - IMPORT_MANIFEST.yaml tracks provenance and integration touchpoints

## `src/harvested/openpencil/`

- Upstream project: OpenPencil
- Upstream URL: https://github.com/open-pencil/open-pencil
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `OpenPencil Contributors`
- Local modifications:
  - .op JSON codec (parse, validate, serialize, diff) adapted for DanteForge Design-as-Code pipeline
  - 86-tool registry adapted into DanteForge's tool-context and executor modules
  - Spatial decomposer, token extractor, and headless SVG renderer integrated with DanteForge CLI
  - Adapter bridges OpenPencil tools into DanteForge's MCP and prompt-builder infrastructure

## Notes

- DanteForge also contains original glue/orchestration code outside `src/harvested/`.
- See `NOTICE.md` for the high-level attribution summary.
