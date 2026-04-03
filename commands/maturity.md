---
name: maturity
description: Analyze current code maturity level and provide founder-friendly quality report
category: quality
---

# maturity

Analyze current code maturity level and provide founder-friendly quality report.

## Usage

```bash
danteforge maturity [options]
```

## Description

The `maturity` command analyzes your codebase across 8 quality dimensions and assigns it a maturity level (1-6). It then compares your current level to a target level (based on the chosen preset or a default of Beta/level 4) and provides actionable recommendations.

This command answers the question: **"Is my code ready for what I want to use it for?"**

## Quality Dimensions

The maturity system scores your code across 8 dimensions:

1. **Functionality** (20% weight) — PDSE completeness + integration fitness
2. **Testing** (15% weight) — Coverage, test files, E2E tests
3. **Error Handling** (10% weight) — Try/catch, custom errors, ratio to functions
4. **Security** (15% weight) — Secrets management, npm audit, dangerous patterns
5. **UX Polish** (10% weight) — Loading states, accessibility, responsive design (web only)
6. **Documentation** (10% weight) — PDSE clarity + freshness
7. **Performance** (10% weight) — Nested loops, O(n²) patterns, profiling
8. **Maintainability** (10% weight) — PDSE testability + constitution + function size

Each dimension is scored 0-100, then weighted to produce an overall score (0-100) which maps to a maturity level (1-6).

## Maturity Levels

| Level | Name | Score Range | Use Case |
| --- | --- | --- | --- |
| 1 | Sketch | 0-20 | Demo to co-founder |
| 2 | Prototype | 21-40 | Show investors |
| 3 | Alpha | 41-60 | Internal team use |
| 4 | Beta | 61-75 | Paid beta customers |
| 5 | Customer-Ready | 76-88 | Production launch |
| 6 | Enterprise-Grade | 89-100 | Fortune 500 contracts |

See `docs/MATURITY-SYSTEM.md` for detailed explanations of each level.

## Options

### `--preset <level>`

Set the target maturity level based on a magic preset.

Valid values: `spark`, `ember`, `canvas`, `magic`, `blaze`, `nova`, `inferno`

Each preset targets a specific maturity level:
- `spark` → Level 1 (Sketch)
- `ember` → Level 2 (Prototype)
- `canvas` → Level 3 (Alpha)
- `magic` → Level 4 (Beta) — **default**
- `blaze` → Level 5 (Customer-Ready)
- `nova` → Level 6 (Enterprise-Grade)
- `inferno` → Level 6 (Enterprise-Grade)

**Example:**
```bash
danteforge maturity --preset blaze
```

If not specified, defaults to Level 4 (Beta).

### `--json`

Output the maturity assessment in JSON format instead of the default founder-friendly plain text report.

Useful for:
- CI/CD pipelines
- Integration with other tools
- Automated quality gates

**Example:**
```bash
danteforge maturity --json > maturity-report.json
```

**JSON Output Structure:**
```json
{
  "currentLevel": 4,
  "targetLevel": 5,
  "overallScore": 68,
  "dimensions": {
    "functionality": 75,
    "testing": 82,
    "errorHandling": 65,
    "security": 70,
    "uxPolish": 60,
    "documentation": 55,
    "performance": 70,
    "maintainability": 68
  },
  "gaps": [
    {
      "dimension": "documentation",
      "currentScore": 55,
      "targetScore": 70,
      "gapSize": 15,
      "severity": "major",
      "recommendation": "Improve clarity and update stale documentation"
    }
  ],
  "founderExplanation": "Your code is at Beta level (68/100)...",
  "recommendation": "refine",
  "timestamp": "2026-04-02T10:30:00.000Z"
}
```

### `--cwd <directory>`

Specify the working directory. Defaults to current directory.

**Example:**
```bash
danteforge maturity --cwd /path/to/project
```

## Examples

### Basic Usage (Default: Beta Target)

```bash
danteforge maturity
```

Output:
```
════════════════════════════════════════════════════════════
  DanteForge Maturity Assessment
════════════════════════════════════════════════════════════

Current Level: Alpha (3/6)
Target Level:  Beta (4/6)
Overall Score: 58/100
Use Case:      Internal team use

Quality Dimensions:
  ✅ Functionality        75/100
  ✅ Testing              82/100
  ⚠️  Error Handling      65/100
  ⚠️  Security            70/100
  ⚠️  UX Polish           60/100
  ❌ Documentation        55/100
  ⚠️  Performance         70/100
  ⚠️  Maintainability     68/100

Major Gaps (1):
  - Documentation: 55/100 (need 70+)
    → Improve clarity and update stale documentation

What This Means:
  Your code is at Alpha level (58/100).

  Your code is ready for your team to use daily. Internal release quality.

  Target: Beta level (4/6).

Next Steps:
  1. Improve clarity and update stale documentation

Recommendation: ⚠️  Refine — address gaps before shipping

════════════════════════════════════════════════════════════
```

### Check Against Production-Ready Standard

```bash
danteforge maturity --preset blaze
```

This checks if your code meets the Customer-Ready (level 5) standard required by the `blaze` preset.

### Check Against Enterprise Standard

```bash
danteforge maturity --preset nova
```

This checks if your code meets the Enterprise-Grade (level 6) standard required by the `nova` preset.

### CI/CD Pipeline Integration

```bash
# Exit code 1 if critical gaps exist (recommendation: blocked)
danteforge maturity --preset magic --json > maturity.json
if [ $? -ne 0 ]; then
  echo "Critical quality gaps detected. Fix before merging."
  exit 1
fi
```

### Quick Prototype Check

```bash
danteforge maturity --preset ember
```

This checks if your code meets the Prototype (level 2) standard — good for investor demos.

## Output Files

The command writes a detailed markdown report to:

```
.danteforge/evidence/maturity/latest.md
```

This report includes:
- Summary table (current/target level, overall score)
- Quality dimensions breakdown
- Grouped gaps (critical/major/minor)
- Founder explanation
- Next steps

Use this report for:
- Sharing with your team
- Tracking quality improvements over time
- Code review context

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Success — code meets target or has minor/major gaps only |
| 1 | Failure — critical gaps detected or command error |

## How It Works

1. **Load State** — Read `.danteforge/STATE.yaml`
2. **Score Artifacts** — Run PDSE scoring on all tracked artifacts (SPEC, PLAN, CONSTITUTION, etc.)
3. **Analyze Code** — Scan `src/` directory for:
   - Test coverage (`.c8rc.json`, `tests/`)
   - Security patterns (secrets, eval, npm audit)
   - Error handling (try/catch, custom errors)
   - UX polish (loading states, ARIA, Tailwind)
   - Performance (nested loops, await in loops)
   - Maintainability (function size, modularity)
4. **Compute Dimensions** — Score each of 8 dimensions (0-100)
5. **Weighted Average** — Combine with weights to get overall score (0-100)
6. **Map to Level** — Convert overall score to maturity level (1-6)
7. **Gap Analysis** — Compare current to target, identify critical/major/minor gaps
8. **Generate Report** — Output founder-friendly plain text or JSON

## Integration with Convergence Loops

When you run a magic preset (e.g., `danteforge magic`), the convergence loop uses this maturity assessment to decide if your code is "done":

1. Run verify (tests pass)
2. Run maturity assessment
3. If `currentLevel < targetLevel` and critical gaps exist:
   - Run 3 focused autoforge waves targeting gap dimensions
   - Re-run maturity assessment
4. Repeat up to `convergenceCycles` times

This prevents "premature done" — where tests pass but code isn't actually ready for your use case.

## Comparison to Other Commands

| Command | What It Checks |
| --- | --- |
| `verify` | Tests pass, builds succeed |
| `maturity` | Quality dimensions meet target level |
| `qa` | Baseline regression, health score |
| `review` | CURRENT_STATE.md generation |

Use them together:
```bash
danteforge verify && danteforge maturity --preset blaze
```

## Further Reading

- `docs/MATURITY-SYSTEM.md` — Comprehensive founder-friendly guide
- `docs/MAGIC-LEVELS.md` — Preset comparison table
- `.danteforge/evidence/maturity/latest.md` — Your latest report

## Troubleshooting

### "No PDSE scores found"

This means you haven't run any planning commands yet. Run:
```bash
danteforge spark  # Or ember, magic, etc.
```

This will generate SPEC, PLAN, and other artifacts that the maturity system uses for scoring.

### "Coverage summary not found"

The maturity system looks for `.danteforge/evidence/coverage-summary.json`. Run:
```bash
danteforge verify
```

This will generate the coverage summary.

### "All dimensions show 50/100 (neutral)"

This happens when:
- You're running maturity on a fresh project with no code yet
- The `src/` directory is missing or empty

Generate some code first:
```bash
danteforge ember  # Or magic, blaze, etc.
```

### "Security score is low but I don't see the issue"

Run with `--json` to see specific patterns detected:
```bash
danteforge maturity --json | jq '.gaps[] | select(.dimension == "security")'
```

Common culprits:
- Hardcoded API keys or secrets
- `eval()` usage
- `innerHTML` usage
- SQL queries without parameterization
- Missing `.env` file

## See Also

- `verify` — Run tests and builds
- `qa` — Structured QA pass with health scoring
- `autoforge` — Auto-orchestrated build with quality gates
- `magic` — Balanced preset with convergence loop
