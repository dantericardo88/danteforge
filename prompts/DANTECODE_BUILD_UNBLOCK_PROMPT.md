# DanteCode Build-Unblock Prompt (paste verbatim into DanteCode's agent session)

You are a coding agent in the **DanteCode** monorepo (`x:/Projects/DanteCode`). A previous honest
DanteForge climb earned `latency_responsiveness` 5.0→7.0 (gate-confirmed) but **could not be
committed**: the pre-commit hook runs `turbo run test`, which builds first, and the package
`@dantecode/danteforge` fails its build with:

    SyntaxError: Unexpected end of JSON input

That one broken build fails the whole turbo run, so **every commit in the repo is blocked**. Your job:
**fix the broken build, land the queued honest earn, nothing more.** Do NOT use `--no-verify`. Do NOT
modify DanteForge tool logic — `@dantecode/danteforge` is a thin stub; fix only its broken build/JSON.

## 1. Reproduce + locate the exact failing file (don't guess)
- Run the package build directly to get the real stack trace:
  `pnpm --filter @dantecode/danteforge run build` (or `turbo run build --filter=@dantecode/danteforge`).
- `SyntaxError: Unexpected end of JSON input` means a `JSON.parse()` (or `require()/import` of a
  `.json`) hit an **empty or truncated** file. The stack trace names the file + line. If the trace is
  thin, grep the package's build script + sources for `JSON.parse(` / `readFileSync(...json` /
  `require('...json')` and check each referenced JSON file.
- Find the package dir first: it's wherever `name: "@dantecode/danteforge"` lives in a `package.json`
  (search `packages/*/package.json` and any `apps/*`). Inspect that package's `package.json` itself,
  its `build` script's inputs, and any `.json` it reads at build time (generated manifests,
  `tsconfig.json`, a `.danteforge/*.json`, a bundled stub data file).

## 2. Identify WHICH JSON is broken + WHY
For each candidate JSON file the build reads, check: is it **0 bytes**, **truncated mid-object**, or
**malformed**? `node -e "JSON.parse(require('fs').readFileSync('<path>','utf8'))"` will pinpoint the
bad one (it throws on the offender, exits clean on the good ones). The most likely culprit is an
empty/half-written generated file or a stub `package.json`/manifest that got truncated.

## 3. Fix the real cause (no stubs, no masking)
- If the file is a **generated artifact**, regenerate it via its real generator if one exists; else
  restore it to valid JSON that matches its schema (look at a sibling package's equivalent file or
  git history: `git show HEAD:<path>` may have the last-good content).
- If it's a **committed source JSON that got truncated**, restore the complete valid content.
- Do NOT "fix" it by wrapping `JSON.parse` in a try/catch that swallows the error — that hides a real
  breakage. Fix the data or the generator.
- After fixing: `pnpm --filter @dantecode/danteforge run build` must exit 0.

## 4. Verify the whole gate is unblocked
- `turbo run build` (or the repo's build) must pass for `@dantecode/danteforge`.
- Confirm the pre-commit hook now passes on a trivial staged change (it runs the turbo build+test).
- Do NOT run the full test suite manually if it stalls — the hook running clean is the proof.

## 5. Land the queued honest earn
- The prior run left a gate-confirmed `latency_responsiveness` test on disk (a seam-free test of the
  wired `LatencyTracker` in `packages/core/src/latency-tracker.ts`) plus its outcome declaration in
  the local `.danteforge/compete/matrix.json`. Re-confirm it: `node <danteforge>/dist/index.js
  validate latency_responsiveness --force-cold --json` → must show `allPassed:true`, no `integrityCap`.
- Commit on a dedicated branch (e.g. `danteforge/honest-climb-dantecode-20260609-01` if it exists, else
  a new `fix/build-unblock-<date>` branch). Stage by explicit path: the build-fix file(s) + the
  latency test file. **Never** stage `.danteforge/compete/matrix.json` (kernel-owned). **Never** push
  to main/master — push the branch only, or leave it local.

## REPORT BACK (paste to Richard)
- The exact broken file + why (empty/truncated/malformed) + how you fixed it (regenerated/restored).
- Confirmation `@dantecode/danteforge` builds clean + the pre-commit hook passes.
- The `latency_responsiveness` gate-confirm line + the commit sha (or "local-only / pushed branch").
- Any OTHER packages whose build was also broken (so we know if it's systemic).
- If the broken JSON turns out to be written by the DanteForge tool itself (a `.danteforge/*.json` the
  stub reads), say so explicitly — that's a DanteForge bug I need to fix at the source, not in DanteCode.
