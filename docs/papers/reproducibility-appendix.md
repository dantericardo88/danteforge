# Reproducibility Appendix — Time Machine Empirical Validation v1

**Companion to:** [time-machine-empirical-validation-v1.md](time-machine-empirical-validation-v1.md)
**Date:** 2026-04-29
**Repository:** https://github.com/realempanada/DanteForge

This appendix provides the exact CLI commands, version hashes, and reproducibility artifacts referenced by §10 of the comparison document. Every number in §5 of the paper traces to a local proof-anchored manifest under `.danteforge/evidence/` and is independently re-verifiable via `npm run check:proof-integrity`. Generated `.danteforge` artifacts are not committed to the source tree; selected receipts must be exported into a publication archive before external submission.

## A.1 Environment

| Component | Version / Hash |
|---|---|
| Node.js | ≥ 20.x (tested on 22.x) |
| npm | ≥ 10.x |
| OS (publication runs) | Windows 11 24H2 |
| DanteForge git SHA at run | `f19e1d7d` (Pass 22 anchor; current HEAD will differ) |
| `@danteforge/evidence-chain` | package `v1.1.0`, schema `evidence-chain.v1` |
| Time Machine schema | `v0.1` (frozen for v1 publication) |
| DELEGATE-52 dataset SHA-256 | `5618f5ab6394e1d2…` (full hash in `.danteforge/datasets/delegate52-public.jsonl.sha256`) |

## A.2 One-command setup

```bash
git clone https://github.com/realempanada/DanteForge.git
cd DanteForge
npm ci
npm run build
npm run verify          # typecheck + lint + tests
npm run check:proof-integrity   # 15+ verified, CLEAN
```

## A.3 Reproducing each result table

### §5.1 Class A — Tamper-evidence (1000 commits)

```bash
node dist/index.js time-machine validate --class A --scale prd-real --json
```

Expected: `status: passed`, `7/7 detected`, `0 false positives in 100 runs`, `max detection 617ms`.

### §5.2 Class B — Reversibility (1000 commits)

```bash
node dist/index.js time-machine validate --class B --scale prd-real --json
```

Expected: `status: passed`, `6/6 byte-identical`.

### §5.3 Class C — Causal completeness (100 decisions)

```bash
node dist/index.js time-machine validate --class C --scale prd-real --json
```

Expected: `status: passed`, `7/7 queries`, `0 gaps`.

### §5.4.1 Class D — Dataset import

```bash
# Fetch the dataset (one-time)
mkdir -p .danteforge/datasets
curl -L "https://huggingface.co/datasets/microsoft/delegate52/resolve/main/delegate52.jsonl" \
  -o .danteforge/datasets/delegate52-public.jsonl

# Validate import
node dist/index.js time-machine validate --class D --delegate52-mode import \
  --delegate52-dataset .danteforge/datasets/delegate52-public.jsonl \
  --max-domains 48 --json
```

Expected: `status: imported_results_evaluated`, `48 distinct domains`, `234 rows`.

### §5.4.2 Class D — **Live round-trip [GATE-1]**

This command requires founder budget authorization and is NOT executed by default.

```bash
# Set provider credential
export ANTHROPIC_API_KEY=sk-ant-...

# Pin the model SKU explicitly (see §A.3 cost-envelope note below)
export ANTHROPIC_MODEL=claude-sonnet-4-5-20260101

# Authorize live mode
export DANTEFORGE_DELEGATE52_LIVE=1

# Run with explicit budget cap
node dist/index.js time-machine validate \
  --class D \
  --delegate52-mode live \
  --budget-usd 160 \
  --max-domains 48 \
  --round-trips 10 \
  --mitigate-divergence \
  --retries-on-divergence 3 \
  --delegate52-dataset .danteforge/datasets/delegate52-public.jsonl \
  --json > .danteforge/evidence/delegate52-live-results.json
```

Expected wall-time: 4–6 hours for 48 domains × 10 round-trips × 2 interactions = 960 baseline LLM calls, plus retry calls when mitigation detects divergence.

**Cost envelope note (post-Pass-23 review).** The conservative estimator in `src/core/time-machine-validation.ts` uses 4 chars/token and $3/M input + $15/M output. Real Anthropic tokenization averages ~3.5 chars/token in English; 1M-context Sonnet variants price at $6/M input + $22.50/M output. Realistic envelope: **$10–160** depending on (a) the resolved model SKU at run time and (b) document length distribution from the imported dataset. The CLI hard-stops at the `--budget-usd` ceiling, so over-runs are impossible by design — but a half-completed run (24 of 48 domains) is possible if the envelope is too tight. Pin `ANTHROPIC_MODEL` to a non-1M SKU to stay near the lower bound.

Real billed cost may differ from the `costUsd` field by up to 10%; reconcile against provider billing afterward.

**Dry-run alternative (no $ spent):**

```bash
DANTEFORGE_DELEGATE52_DRY_RUN=1 \
  node dist/index.js time-machine validate \
    --class D --delegate52-mode live --budget-usd 80 \
    --max-domains 4 --json
```

Expected: `status: live_dry_run`, `totalCostUsd: 0`, `4/4 byte-identical (identity simulator)`.

Tiny live preflight smoke (Pass 44; optional, not GATE-1):

```bash
npm run build
npm run delegate52:preflight
```

Required local inputs: `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`, and `.danteforge/datasets/delegate52-public.jsonl`. This path caps spend at $2, runs 3 public domains x 1 round-trip, and records only smoke evidence. It must not populate the paper's live D1/D3/D4 table.

### §5.6 Class F — Scale (10K, 100K, 1M attempt)

```bash
node dist/index.js time-machine validate --class F --scale benchmark --json
```

Expected without overrides: `status: passed at 10K`, `passed at 100K`, 1M skipped.

Pass 44 compute-only 1M attempt:

```bash
node dist/index.js time-machine validate \
  --class F --scale benchmark \
  --max-commits 1000000 \
  --benchmark-time-budget-minutes 30 \
  --out .danteforge/time-machine/validation/pass-44-f1m \
  --json
```

Observed: structured partial result after 748,544/1,000,000 commits at the 30-minute budget. Artifact: `.danteforge/evidence/pass-44-runs/f1m-result.json`, anchored by `.danteforge/evidence/pass-44-prd-remainder-closure.json`. This is not a 1M pass.

### §5.7 Class G — Constitutional integration

```bash
# G1 substrate composability (synthetic, no email send)
node scripts/build-g1-substrate-validation.mjs

# G4 truth-loop causal recall ledger
node scripts/build-g4-truth-loop-ledger.mjs

# Full Class G report
node dist/index.js time-machine validate --class G --scale prd --json
```

Expected: G1 staged, G3 passed, G4 100% completeness, G2 out-of-scope.

## A.4 Proof-integrity verification

After running the commands above, verify that every manifest under `.danteforge/evidence/` re-derives its proof bundle byte-identically:

```bash
npm run check:proof-integrity
```

Expected: `CLEAN  scanned=N  verified=15+  failed=0`. Any non-zero `failed` count blocks the run.

## A.5 Evidence index

Per-pass proof-anchored manifests:

| Pass | Manifest | Hash file (truncated) |
|---|---|---|
| 18.5 — git binding | `.danteforge/evidence/pass-18-5-git-binding.json` | n/a |
| 19 — live executor | `.danteforge/evidence/pass-19-live-delegate52.json` | n/a |
| 20 — dataset + real-fs | `.danteforge/evidence/pass-20-real-fs-import.json` | n/a |
| 20 — combined run | `.danteforge/evidence/pass-20-runs/abcd-prd-real-import.json` | n/a |
| 21 — Class G | `.danteforge/evidence/pass-21-class-g.json` | n/a |
| 22 — comparison doc | `.danteforge/evidence/pass-22-comparison-document.json` | doc hash `239dfad9a3c0f7a9…` |
| 24 — product polish | `.danteforge/evidence/pass-24-product-polish.json` | n/a |
| 27 — verify optimization | `.danteforge/evidence/pass-27-verify-optimization.json` | n/a |
| 28 — v1.1 closure | `.danteforge/evidence/pass-28-v1-1-closure.json` | n/a |
| 36 — hybrid compute closure | `.danteforge/evidence/pass-36-hybrid-compute-closure.json` | Class F 1M timeout + live DELEGATE blockers |
| 44 — PRD remainder closure | `.danteforge/evidence/pass-44-prd-remainder-closure.json` | Class F optimized partial 1M result + DELEGATE-52 preflight path |

All manifests use `evidence-chain.v1` schema and are created via `createEvidenceBundle` from `@danteforge/evidence-chain`.

## A.6 Deviations from Microsoft methodology

| Microsoft DELEGATE-52 | DanteForge replication | Reason |
|---|---|---|
| 124 domains (48 public + 76 withheld) | 48 public only | License (CDLA Permissive 2.0 covers public release only) |
| Frontier LLM corruption rate | Substrate-on rate (D4) | Different question: does the substrate mitigate? |
| Byte-level corruption metric | Byte-level (same) | Methodology alignment |
| Multi-turn delegation | Multi-turn (10 round-trips × 48 domains) | Matched per PRD §3.4 |
| Provider mix | Configurable; default Claude Sonnet | Open to user choice |

## A.7 Building the LaTeX preprint

```bash
cd docs/papers
pdflatex time-machine-empirical-validation-v1.tex
bibtex time-machine-empirical-validation-v1
pdflatex time-machine-empirical-validation-v1.tex
pdflatex time-machine-empirical-validation-v1.tex
```

If `pdflatex` is not available locally (publication preparation environment may differ), the `.tex` and `.bib` are sufficient for the founder to compile in any TeX Live distribution.

**arXiv submission is GATE-5: founder reviews the compiled PDF before any public submission. Agents do NOT submit.**

## A.8 Founder gates summary

| Gate | What it controls | How to invoke |
|---|---|---|
| GATE-1 | Live DELEGATE-52 LLM run ($30–80 budget) | §A.3 §5.4.2 command |
| GATE-3 | F 1M scale benchmark | Pass 44 optimized attempt reached 748,544 commits in 30 min but did not pass; future invocation requires more optimization or longer compute window |
| GATE-5 | arXiv submission of preprint PDF | founder action; not in CLI |
| GATE-6 | Outreach email send to Microsoft authors | founder action; not in CLI |

All four gates are preserved in v1. The agent prepares; the founder triggers.
