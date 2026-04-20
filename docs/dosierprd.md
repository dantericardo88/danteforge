# PRD: DanteForge Competitive Dossier System

**Status**: Implemented  
**Version**: 1.0  
**Date**: 2026-04-20  
**Sprint**: 51

---

## Problem

The current competitive matrix in `.danteforge/compete/matrix.json` is hand-scored. It becomes stale the moment a competitor ships. There is no provenance: no evidence, no quotes, no sources. Scores are vibes-based and cannot be audited or updated automatically.

This makes the matrix unreliable as a foundation for the autonomous improvement loop. If the competitive gaps are wrong, the ascend loop targets the wrong dimensions.

---

## Solution

Replace the hand-scored matrix with a **dossier system**: source-backed, rubric-locked, automatically refreshable competitor intelligence.

Three new concepts:

1. **Rubric** — frozen JSON that defines observable behaviors per score bracket (1/3/5/7/9). Once frozen, criteria cannot change. New dimensions can be added.
2. **Dossier** — structured JSON per competitor. Contains fetched source content, extracted verbatim evidence quotes, and LLM-derived scores per rubric dimension.
3. **Landscape** — assembled matrix derived from all dossiers. Never hand-edited.

---

## Goals

- Replace vibes-based scoring with evidence-backed, reproducible scores
- Enable automated refresh: `danteforge dossier build cursor --since 7d`
- Enable gap analysis: where is DanteCode behind the best competitor per dimension?
- Enable diff tracking: what changed between two builds of the same dossier?
- Enable self-scoring: DanteCode assessed against the same rubric using its own source files
- Provide 7 new MCP tools so Claude Code sessions can query the landscape programmatically

---

## Non-Goals

- Real-time monitoring (not a live dashboard)
- Automatic commit/push of dossier files (user controls git)
- Scoring non-competitor projects (rubric is AI coding assistant specific)
- Replacing the existing `matrix.json` immediately (coexistence during migration)

---

## System Architecture

```
.danteforge/
  rubric.json                    <- frozen, append-only
  competitor-registry.json       <- 11 competitors with source URLs
  dossiers/
    cursor.json                  <- Dossier
    dantescode.json              <- self-dossier (from source files)
    aider.json
    ...
  dossier-cache/
    cursor/
      <sha256-of-url>.txt        <- 24h cached source content
  landscape.json                 <- LandscapeMatrix
  COMPETITIVE_LANDSCAPE.md       <- human-readable ranking table
```

### Module map

```
src/dossier/
  types.ts         <- all TypeScript interfaces
  rubric.ts        <- getRubric, getDimCriteria, validateFrozenAt
  registry.ts      <- loadRegistry, getCompetitor
  fetcher.ts       <- fetchSource (HTTP + 24h cache + rate limiter)
  extractor.ts     <- extractEvidence (LLM per dimension+source chunk)
  scorer.ts        <- scoreDimension (LLM from evidence array)
  builder.ts       <- buildDossier, buildAllDossiers, computeComposite
  self-scorer.ts   <- buildSelfDossier (reads local TS files instead of URLs)
  landscape.ts     <- buildLandscape, isLandscapeStale, loadLandscape
  diff.ts          <- diffDossiers, formatDeltaReport
```

---

## Data Schemas

### `EvidenceItem`
```typescript
{
  claim: string;   // one-sentence claim about the competitor
  quote: string;   // verbatim quote from source (non-empty to count as verified)
  source: string;  // URL or "filePath#symbolName" for self-dossier
  dim: number;     // rubric dimension number
}
```

### `DossierDimension`
```typescript
{
  score: number;                // 1-10
  scoreJustification: string;   // one sentence citing evidence
  evidence: EvidenceItem[];
  humanOverride: number | null;
  humanOverrideReason: string | null;
  unverified?: boolean;         // true if no evidence with non-empty quote
}
```

### `Dossier`
```typescript
{
  competitor: string;           // id e.g. "cursor"
  displayName: string;          // e.g. "Cursor"
  type: 'closed-source' | 'open-source';
  lastBuilt: string;            // ISO 8601
  sources: DossierSource[];
  dimensions: Record<string, DossierDimension>;  // "1"-"28"
  composite: number;            // mean of all dim scores
  compositeMethod: string;      // "mean_28_dims"
  rubricVersion: number;
}
```

### `LandscapeMatrix`
```typescript
{
  generatedAt: string;          // ISO 8601
  rubricVersion: number;
  competitors: string[];
  rankings: Array<{ competitor: string; composite: number; type: string }>;
  dimScores: Record<string, Record<string, number>>;  // dim -> competitor -> score
  gapAnalysis?: Array<{
    dim: string;
    dcScore: number;
    leader: string;
    leaderScore: number;
    gap: number;
  }>;
}
```

### `DossierDelta`
```typescript
{
  competitor: string;
  previousBuilt: string;
  currentBuilt: string;
  dimensionDeltas: Array<{
    dim: string;
    before: number;
    after: number;
    delta: number;
    newEvidence: EvidenceItem[];
  }>;
  compositeChange: number;
}
```

---

## Rubric Design

### Format

```json
{
  "version": 1,
  "frozenAt": "2026-04-20",
  "dimensions": {
    "1": {
      "name": "Ghost text / inline completions",
      "scoreCriteria": {
        "9": ["Sub-100ms P50 TTFB", "Multi-line Tab accepts"],
        "7": ["Inline completions present and fast"],
        "5": ["Single-token completions only"],
        "3": ["Manual trigger required"],
        "1": ["No completions"]
      }
    }
  }
}
```

### 28 Dimensions

| # | Dimension |
|---|-----------|
| 1 | Ghost text / inline completions |
| 2 | Chat interface UX |
| 3 | Semantic codebase search |
| 4 | Agentic code editing |
| 5 | Multi-file editing |
| 6 | Terminal / shell integration |
| 7 | Test generation |
| 8 | Error diagnosis & auto-repair |
| 9 | Code review assistance |
| 10 | Refactoring tools |
| 11 | Spec / planning pipeline |
| 12 | Autonomous improvement loop |
| 13 | Multi-agent orchestration |
| 14 | OSS pattern harvesting |
| 15 | LLM routing & cost management |
| 16 | IDE integration depth |
| 17 | Streaming output quality |
| 18 | Context window management |
| 19 | MCP / plugin ecosystem |
| 20 | Documentation generation |
| 21 | Security awareness |
| 22 | Self-improvement / lessons |
| 23 | Onboarding experience (first 5 min) |
| 24 | Configuration simplicity |
| 25 | Enterprise features (audit, RBAC) |
| 26 | Performance (latency, throughput) |
| 27 | Reliability (error recovery, circuit breakers) |
| 28 | Open source quality / community |

### Frozen-at invariant

Once `frozenAt` is set, existing `scoreCriteria` entries cannot be changed. `validateFrozenAt(rubric, existing)` throws:
```
rubric is frozen at 2026-04-20, criteria for dim 3 cannot be changed
```
New dimensions can be appended (append-only extension).

---

## Competitor Registry

11 competitors tracked at launch:

| ID | Display Name | Type |
|----|-------------|------|
| cursor | Cursor | closed-source |
| openai-codex | OpenAI Codex | closed-source |
| claude-code | Claude Code (Anthropic) | closed-source |
| github-copilot | GitHub Copilot | closed-source |
| windsurf | Windsurf (Codeium) | closed-source |
| devin | Devin (Cognition) | closed-source |
| aider | Aider | open-source |
| openhands | OpenHands | open-source |
| cline | Cline | open-source |
| continue | Continue.dev | open-source |
| tabby | Tabby | open-source |

Self-competitor: `dantescode` (DanteCode/DanteForge itself)

---

## Module Specifications

### `fetcher.ts`

**Cache**: `.danteforge/dossier-cache/<competitor>/<sha256-of-url>.txt`
**TTL**: 24 hours (check file mtime)
**Rate limit**: per-domain `Map<domain, lastFetchTime>`. If `now - lastFetch < 2000ms`, sleep 2000ms.
**HTML stripping pipeline**:
1. Remove `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>` blocks
2. Strip all remaining HTML tags
3. Decode common HTML entities (`&amp;` to `&`, `&lt;` to `<`, etc.)
4. Collapse whitespace runs to single spaces
5. Truncate to 50,000 characters

**Injection seams**: `_fetch`, `_writeFile`, `_readFile`, `_stat`, `_sleep`, `_mkdir`

### `extractor.ts`

**Chunking**: 3,000-char chunks of source content (to stay within LLM context budget)
**LLM call**: `callLLM(prompt, 'claude')` with extraction prompt per chunk
**Output**: JSON array of `EvidenceItem[]` -- each must have `claim`, `quote`, `source`
**Fallback**: empty array on LLM failure or invalid JSON
**Code fences**: stripped before JSON parse

**Injection seams**: `_callLLM`

### `scorer.ts`

**Input**: evidence array + rubric dimension definition + competitor name
**No evidence guard**: if `evidence.length === 0`, return `{ score: 1, justification: 'no evidence found' }` without calling LLM
**LLM output**: `{ "score": N, "justification": "..." }`
**Validation**:
- Clamp score to [1, 10]
- Round to 1 decimal place
- On invalid JSON or LLM failure: `{ score: 1, justification: 'no evidence found' }`
- Strip markdown code fences before parse

**Injection seams**: `_callLLM`

### `builder.ts`

**Pipeline**:
1. `loadRegistry(cwd)` -> get competitor entry (throws if not found)
2. For each source URL: `fetchSource()` -> get content
3. For each rubric dimension:
   - For each source: `extractEvidence()` -- merge results across sources
   - `scoreDimension(mergedEvidence, dim, dimDef, competitor)`
4. Mark `unverified: true` if all evidence items have empty `quote`
5. `composite = mean(all dim effective scores)` -- uses `humanOverride` when set
6. Write `.danteforge/dossiers/<competitor>.json`

**`--since` filter**: if dossier exists and `isDossierFresh(dossier, parseSince(since))`, skip and return cached

**`parseSince` format**: `"7d"` -> 7 days in ms, `"24h"` -> 24 hours in ms, `"30m"` -> 30 minutes in ms

**Injection seams**: `_loadRubric`, `_loadRegistry`, `_fetchSource`, `_extractEvidence`, `_scoreDimension`, `_writeFile`, `_mkdir`, `_readExisting`

### `self-scorer.ts`

Same pipeline as `builder.ts` but:
- Reads source files with `fs.readFile` instead of HTTP fetch
- `source` field format: `"filePath#symbolName"` (e.g., `"src/core/llm.ts#callLLM"`)
- Extraction prompt is code-aware (understands TypeScript signatures, doc comments)
- Default competitor id: `"dantescode"`
- Default sources: 16 key TypeScript files discovered by Glob

### `landscape.ts`

**Assembly**:
1. Read all `.danteforge/dossiers/*.json`
2. Sort rankings by composite score (descending)
3. Build `dimScores` matrix: dim -> competitor -> score
4. Gap analysis: for each dim, find best competitor score; if DC score < best - 1.0, record gap
5. Write `landscape.json` + `COMPETITIVE_LANDSCAPE.md`

**Staleness**: `isLandscapeStale(landscape, maxAgeDays = 7)` -- compare `generatedAt` to now

**Injection seams**: `_loadDossiers`, `_writeFile`, `_mkdir`

### `diff.ts`

**Algorithm**:
1. Union of all dim keys from both dossiers
2. For each dim: compare `score` (or `humanOverride` if set), collect new evidence items
3. Only emit delta entry if score changed OR new evidence exists
4. Sort `dimensionDeltas` by `Math.abs(delta)` descending
5. `compositeChange = current.composite - previous.composite`

**`formatDeltaReport`**: uses triangle-up for positive delta, triangle-down for negative; shows `+N` / `-N` change

---

## CLI Commands

### `dossier` group

```bash
danteforge dossier build [competitor]
  --all                    rebuild all competitors
  --sources <urls>         comma-separated source URL overrides
  --since <duration>       skip if dossier built within duration (e.g. 7d)

danteforge dossier diff <competitor>
  # compares latest vs previous build

danteforge dossier show <competitor>
  --dim <n>                show single dimension detail

danteforge dossier list
  # table of all built dossiers with composite scores and lastBuilt
```

### `landscape` group

```bash
danteforge landscape
  # rebuild landscape from all dossiers

danteforge landscape diff
  # show what changed since last build

danteforge landscape ranking
  # sorted table by composite score

danteforge landscape gap
  --target <id>            target competitor for gap analysis (default: dantescode)
```

### `rubric` group

```bash
danteforge rubric show
  --dim <n>                show single dimension with all score criteria

danteforge rubric init
  # scaffold .danteforge/rubric.json if not present

danteforge rubric validate
  # validate frozenAt invariant, report unverified dimensions

danteforge rubric add-dim
  # interactive: add a new dimension (append-only)
```

---

## MCP Tools

7 new tools registered in `src/core/mcp-server.ts`:

| Tool | Description |
|------|-------------|
| `danteforge_dossier_build` | Build or refresh a competitor dossier |
| `danteforge_dossier_get` | Get a competitor dossier (optionally single dim) |
| `danteforge_dossier_list` | List all built dossiers |
| `danteforge_landscape_build` | Rebuild full competitive landscape from dossiers |
| `danteforge_landscape_diff` | Show what changed in landscape since last build |
| `danteforge_rubric_get` | Get rubric (optionally single dimension) |
| `danteforge_score_competitor` | Get composite score for a specific competitor |

---

## Integration Hooks

### `score.ts` -- stale landscape warning

After printing score output, best-effort check:
```
Warning: Competitive landscape is >7 days old. Run: danteforge landscape
```

### `assess.ts` -- self-dossier refresh

At top of `assess()`, best-effort call to `buildSelfDossier({ cwd })` so gap analysis uses fresh evidence. Never blocks assess if self-scorer fails.

---

## Test Coverage

7 test files, 6+ tests each, using Node.js built-in test runner with `_*` injection seams:

| File | Module | Key scenarios |
|------|--------|---------------|
| `tests/dossier-rubric.test.ts` | `rubric.ts` | getRubric, getDimCriteria, frozenAt validation, missing/malformed |
| `tests/dossier-fetcher.test.ts` | `fetcher.ts` | cache hit/miss, rate limiting, TTL expiry, HTML stripping |
| `tests/dossier-extractor.test.ts` | `extractor.ts` | evidence extraction, empty response, invalid JSON, chunking |
| `tests/dossier-scorer.test.ts` | `scorer.ts` | valid score, clamping 1-10, no evidence -> 1, invalid fallback |
| `tests/dossier-builder.test.ts` | `builder.ts` | full pipeline, --since, skip fresh, unverified flag |
| `tests/dossier-landscape.test.ts` | `landscape.ts` | assemble, rankings, gap analysis, rubricVersion, generatedAt |
| `tests/dossier-diff.test.ts` | `diff.ts` | no-change, score delta, new evidence, dimension add |

---

## Execution Order

```
Wave 1 - Types + rubric + registry (no LLM deps)
  types.ts -> rubric.ts -> registry.ts -> seed files

Wave 2 - IO layer
  fetcher.ts -> self-scorer helpers

Wave 3 - LLM layer
  extractor.ts -> scorer.ts

Wave 4 - Orchestration
  builder.ts -> self-scorer.ts -> landscape.ts -> diff.ts

Wave 5 - CLI + MCP
  dossier.ts -> landscape-cmd.ts -> rubric-cmd.ts
  src/cli/index.ts (register commands) -> mcp-server.ts (register tools)

Wave 6 - Integration hooks + tests
  score.ts hook -> assess.ts hook -> all 7 test files
```

---

## Verification Checklist

```bash
# 1. Typecheck - 0 errors
npm run typecheck

# 2. Full test suite - all pass, 0 fail
npm test

# 3. Dossier build works
node dist/index.js dossier build cursor --sources "https://cursor.com/changelog/3-0"
# -> .danteforge/dossiers/cursor.json written

# 4. Self-dossier
node dist/index.js dossier build dantescode
# -> .danteforge/dossiers/dantescode.json with file-path evidence

# 5. Landscape assembled
node dist/index.js landscape
# -> .danteforge/COMPETITIVE_LANDSCAPE.md updated

# 6. Rankings
node dist/index.js landscape ranking
# -> sorted table, DC position marked

# 7. Rubric validate
node dist/index.js rubric validate
# -> reports unverified dims

# 8. MCP tools appear
node dist/index.js mcp list | grep dossier
# -> 7 new tools listed

# 9. Score staleness warning
node dist/index.js score
# -> Warning: Competitive landscape is >7 days old (after landscape is stale)
```

---

## Success Criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` -- all tests pass, 0 failures
- [ ] `dossier build cursor` produces a valid `.json` with `composite > 0`
- [ ] `landscape ranking` shows a sorted table with dantescode included
- [ ] `landscape gap` shows dimension gaps where DC trails the leader
- [ ] `rubric validate` runs without crash on the seed rubric
- [ ] 7 new MCP tools visible in `danteforge mcp list`
- [ ] `score` command prints staleness warning when landscape is >7 days old
- [ ] `assess` command calls self-scorer without crashing (best-effort)
