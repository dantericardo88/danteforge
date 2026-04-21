# Case Study: Internal Self-Hosting

This case study is grounded in a real sibling workspace that used DanteForge as its verification backbone: `DanteCode`.

## Environment

- Author-maintained sibling repo available locally as `../DanteCode`
- Windows author machine snapshot captured on 2026-04-14
- Internal/self-hosted evidence, not a public CI artifact
- DanteForge receipts and state files already present in the sibling repo

## Commands

Historical commands visible in the captured audit trail:

```bash
cd ../DanteCode
danteforge verify
danteforge score
danteforge lessons
```

Current evidence inspection path:

```bash
cd ../DanteCode
type .danteforge\\STATE.yaml
type .danteforge\\evidence\\verify\\latest.json
```

## What This Proves

- DanteForge has been used on a real multi-package codebase, not only on a toy example.
- Verify failures fed directly into lessons capture and audit history instead of being hidden.
- The repo state includes a persistent receipt path (`lastVerifyReceiptPath`) rather than a hand-waved success claim.

## Receipts

- `../DanteCode/.danteforge/STATE.yaml`
- `../DanteCode/.danteforge/evidence/verify/latest.json`
- `../DanteCode/.danteforge/evidence/verify/latest.md`

The captured verify receipt is intentionally not flattering: it records `4 passed, 0 warnings, 9 failures` and lists the exact missing workflow artifacts.

## Known Limitations

- This is internal evidence from a sibling workspace, so it is not reproducible from a fresh public checkout of DanteForge alone.
- The receipt shows a failing verify run, which proves real usage and real correction pressure, not final launch readiness.
- This case study demonstrates self-hosted adoption and truthfulness, not a polished public success story.
