# DanteForge v0.17.0 Operational Readiness

Version: 0.17.0
Current Git SHA: 2bbb0f499556c0ace876603dbaa4cc2d005339b0

Generated on 2026-04-27T01:52:57.962Z from the latest local receipt snapshots.

This guide is evidence-backed on purpose. It summarizes the latest local `verify`, `release:proof`, and `verify:live` receipts instead of hard-coding green claims into the docs.
Anti-stub enforcement remains part of the readiness story: shipped implementation is expected to clear `npm run check:anti-stub` before release claims are treated as trustworthy.

## Canonical Pipeline

```text
review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship
```

## Receipt Snapshot

| Surface | Status | Version | Timestamp | Git SHA | Receipt |
| --- | --- | --- | --- | --- | --- |
| Repo verify | PASS | 0.17.0 | 2026-04-27T01:48:51.974Z | 2bbb0f499556c0ace876603dbaa4cc2d005339b0 | .danteforge/evidence/verify/latest.json |
| Release proof | PASS | 0.17.0 | 2026-04-27T01:42:05.567Z | 2bbb0f499556c0ace876603dbaa4cc2d005339b0 | .danteforge/evidence/release/latest.json |
| Live verification | PASS | 0.9.2 | 2026-03-25T23:47:37.672Z | 1e67861e711487c8b4263dffccaf16fdacd12559 | .danteforge/evidence/live/latest.json |

## Receipt Details

### Repo verify

- Command: `npm run verify`
- Receipt: `.danteforge/evidence/verify/latest.json`
- Status: PASS
- Timestamp: 2026-04-27T01:48:51.974Z
- Version: 0.17.0
- Git SHA: 2bbb0f499556c0ace876603dbaa4cc2d005339b0

### Release proof

- Command: `npm run release:proof`
- Receipt: `.danteforge/evidence/release/latest.json`
- Status: PASS
- Timestamp: 2026-04-27T01:42:05.567Z
- Version: 0.17.0
- Git SHA: 2bbb0f499556c0ace876603dbaa4cc2d005339b0
- Recorded release checks: 9.

### Live verification

- Command: `npm run verify:live`
- Receipt: `.danteforge/evidence/live/latest.json`
- Status: PASS
- Timestamp: 2026-03-25T23:47:37.672Z
- Version: 0.9.2
- Git SHA: 1e67861e711487c8b4263dffccaf16fdacd12559
- Receipt version 0.9.2 does not match the current package version 0.17.0.
- Receipt git SHA 1e67861e711487c8b4263dffccaf16fdacd12559 does not match the current workspace SHA 2bbb0f499556c0ace876603dbaa4cc2d005339b0.
- Recorded live providers: 1.

## Supported Surfaces

| ID | Surface | Status | Proof |
| --- | --- | --- | --- |
| local-cli | local-only CLI | PASS | .github/workflows/ci.yml<br />scripts/check-cli-smoke.mjs<br />scripts/check-package-install-smoke.mjs |
| codex-local | local Codex install contract | PASS | docs/Codex-Install.md<br />docs/Standalone-Assistant-Setup.md<br />scripts/check-package-install-smoke.mjs |
| live-cli | live-provider CLI | PASS | .github/workflows/live-canary.yml<br />.danteforge/evidence/live/latest.json<br />.danteforge/evidence/live/latest.md |
| vscode-extension | VS Code extension | PASS | .github/workflows/release.yml<br />vscode-extension/README.md<br />vscode-extension\.artifacts\danteforge.vsix |

## Known Outstanding Work

- Live verification receipt targets version 0.9.2, not the current package version 0.17.0.
- Live verification receipt was captured at 1e67861e711487c8b4263dffccaf16fdacd12559, not the current workspace SHA 2bbb0f499556c0ace876603dbaa4cc2d005339b0.

## Regeneration

- Refresh verify evidence with `npm run verify`.
- Refresh release proof with `npm run release:proof`.
- Refresh live proof with `npm run verify:live` when the live environment is available.
- Regenerate this guide with `npm run sync:readiness-doc`.
