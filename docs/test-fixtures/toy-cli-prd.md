# PRD: Quill — A Markdown TODO Tracker

**Version:** 1.0
**Status:** Test fixture for PRD-MATRIX-ORCHESTRATION-V1

> This is a synthetic PRD used as an end-to-end test fixture for
> `danteforge matrix`. The project is fictional. Competitors named are real.

## 1. Goal

Build Quill — a fast, keyboard-driven CLI for tracking TODO items written in
plain Markdown files. Engineers should be able to scan their repos for `TODO:`
and `FIXME:` markers, organize them into views, mark them done, and write
changes back to the source files without touching their editor.

## 2. Project Type

CLI tool. Single binary distributed as an npm package. No GUI, no server, no
web component.

## 3. Target User

Working software engineers who already track TODOs as comments in their code
and want one place to see all of them across a repo or set of repos. Not for
non-technical users.

## 4. Key Features

- Scan a directory tree for `TODO:` / `FIXME:` / `XXX:` / `HACK:` comments in
  source files and Markdown files.
- Index the findings into a queryable local store under `.quill/`.
- List, filter, sort, and tag the results from the command line.
- Mark items done; rewrite the source file to remove or comment out the marker.
- Export the open list to Markdown, JSON, or a simple HTML dashboard.
- Watch mode: re-scan on file save.

## 5. Constraints

- Performance critical: must scan a 100k-LOC monorepo in under 2 seconds on a
  modern laptop.
- No telemetry. Strictly local. No network calls in the default mode.
- Must work on Windows, macOS, and Linux without native build steps.

## 6. Non-Goals

- We will not build a web app, mobile app, or hosted service.
- We will not integrate with Jira, Linear, GitHub Issues, or any external
  task tracker (out of scope for v1).
- We will not generate TODOs or rewrite their bodies — only mark them done.

## 7. Competitive Boundaries

- **Direct competitors:** other CLI-based TODO trackers (e.g. `todo-cli`,
  `taskwarrior`, `dstask`, `topydo`, `tl;dr-todo`).
- **Adjacent:** code-comment scanners and search tools (`ripgrep`, `the_silver_searcher`,
  `git grep`, IDE-built-in TODO views).
- **Research-adjacent:** static-analysis tools that surface TODO-like markers
  (e.g. SonarQube TODO detection, GitHub's `# TODO` annotations).

## 8. Frontier Framing

- **Match the leader on:** scan speed, cross-platform availability, ergonomic
  CLI surface.
- **Exceed the leader on:** zero-config local indexing, repo-aware filtering,
  Markdown-native output.
- **Define new category on:** treating TODO markers as a first-class
  developer-workflow primitive rather than a debug artifact.

## 9. Success Criteria

- Quill scans a 100k-LOC repo in <2s, indexes the findings, and renders the
  default list view.
- Mark-done flow rewrites the source file correctly and leaves git status
  recoverable (no destructive edits).
- Cross-platform smoke test passes on Windows / macOS / Linux CI.
- Distributed as `npx quill` with no additional install steps.

---

*This PRD is intentionally small and tightly scoped — it is the dev-loop test
fixture for the orchestration pipeline. The competitive universe should be
discoverable in ~10 entries; dimension synthesis should produce ~50
dimensions across categories like scan-performance, cli-ergonomics,
cross-platform, indexing, output-formats, watch-mode, and integration-surface.*
