# DanteForge API Stability Policy

**Version:** 1.0.0  
**Last Updated:** 2026-04-01  
**Status:** Official Policy

## Overview

This document defines DanteForge's API stability guarantees, deprecation process, and breaking change policy. It ensures predictable upgrades for users and extensions while allowing the project to evolve.

---

## Semantic Versioning

DanteForge follows [Semantic Versioning 2.0.0](https://semver.org/):

- **Major (1.0.0 → 2.0.0)**: Breaking changes to public APIs
- **Minor (1.0.0 → 1.1.0)**: New features, backward compatible
- **Patch (1.0.0 → 1.0.1)**: Bug fixes only, no new features

### Pre-1.0 Versioning

During the 0.x series (current: 0.9.x):
- **Minor bumps (0.9 → 0.10)** MAY include breaking changes
- **Patch bumps (0.9.2 → 0.9.3)** are always backward compatible
- Breaking changes are documented in [MIGRATION.md](../MIGRATION.md)

---

## Public API Surface

### Stable APIs (Guaranteed Backward Compatibility)

These modules constitute the **public API** with strong stability guarantees:

#### Core Configuration & State
- `src/core/config.ts`
  - `loadConfig(): Promise<Config>`
  - `saveConfig(config: Config): Promise<void>`
  - `setApiKey(provider: string, key: string): Promise<void>`
  - `getApiKey(provider: string): string | undefined`

- `src/core/state.ts`
  - `loadState(cwd?: string): Promise<ProjectState>`
  - `saveState(state: ProjectState, cwd?: string): Promise<void>`
  - `updateState(updates: Partial<ProjectState>): Promise<void>`

#### LLM Integration
- `src/core/llm.ts`
  - `callLLM(prompt: string, provider?: string, options?: CallLLMOptions): Promise<string>`
  - `isLLMAvailable(provider?: string): Promise<boolean>`
  - `probeLLMProvider(provider: string): Promise<ProbeResult>`

#### Gates & Verification
- `src/core/gates.ts`
  - `checkGate(gate: GateType, cwd?: string): Promise<GateResult>`
  - `requireConstitution(cwd?: string): Promise<void>`
  - `requireSpec(cwd?: string): Promise<void>`
  - `requirePlan(cwd?: string): Promise<void>`
  - `requireTests(cwd?: string): Promise<void>`

#### Skill System
- `src/core/skill-registry.ts`
  - `discoverSkills(searchPaths?: string[]): Promise<Skill[]>`
  - `loadSkill(skillPath: string): Promise<Skill>`
  - `resolveSkillSource(source: string): string`

#### Audit & Telemetry
- `src/core/execution-telemetry.ts`
  - `ExecutionTelemetry` interface
  - `recordToolCall(tool: string, args: unknown): void`
  - `recordBashCommand(command: string): void`
  - `recordFileModified(path: string): void`
  - `recordTokenUsage(tokens: number, cost?: number): void`

### Unstable APIs (May Change in Minor Versions)

These modules are **internal implementation details** and may change without notice:

- `src/core/*-engine.ts` internals (reflection, retro, PDSE, seven-levels)
- `src/core/autoforge-loop.ts` internals
- `src/core/party-mode.ts` internals
- `src/harvested/**` (harvested code subject to upstream changes)
- `src/utils/**` helper functions
- All test injection seams (parameters prefixed with `_`, e.g., `_llmCaller`, `_fsOps`)

### Plugin Contract (VS Code Extension, Claude Plugin)

**Current Version:** `0.9.0`

The plugin contract includes:
- CLI command signatures (all 29 commands)
- `.danteforge/` directory structure
- `STATE.yaml` schema
- Exit codes and error codes (see [error-catalog.ts](../src/core/error-catalog.ts))

**Versioning:** Plugin contract version bumps with major/minor releases. Extensions must declare compatible version range.

---

## Deprecation Policy

### Process

When deprecating a public API:

1. **Announce** (Version N):
   - Add `@deprecated` JSDoc tag with migration path
   - Add runtime warning (once per session, logged to audit trail)
   - Document in `MIGRATION.md` with before/after examples

2. **Grace Period** (Version N → N+1):
   - Deprecated API remains functional for **1 full major version**
   - Warnings continue to be logged
   - Documentation marks API as deprecated

3. **Remove** (Version N+2):
   - Deprecated API removed in next major version
   - Breaking change documented in changelog

### Example

```typescript
/**
 * @deprecated Since v1.2.0. Use `callLLM()` instead.
 * This method will be removed in v2.0.0.
 * 
 * Migration:
 * ```ts
 * // Before
 * const result = await invokeLLM(prompt);
 * 
 * // After
 * const result = await callLLM(prompt);
 * ```
 */
export async function invokeLLM(prompt: string): Promise<string> {
  logger.warn('invokeLLM() is deprecated. Use callLLM() instead. See docs/API_STABILITY.md');
  return callLLM(prompt);
}
```

### Runtime Warnings

Deprecation warnings are:
- Logged once per CLI invocation (not per call)
- Recorded in `.danteforge/audit-log.jsonl`
- Include link to migration guide
- Non-blocking (execution continues)

---

## Breaking Change Detection

### Automated Detection (CI)

We use [API Extractor](https://api-extractor.com/) to detect breaking changes:

```bash
npm run api:extract   # Generate API report
npm run api:check     # Verify no breaking changes (CI gate)
```

Breaking changes trigger CI failure on:
- Removed exports
- Changed function signatures (parameter types, return types)
- Removed class members
- Changed interface shapes

### Manual Review

All PRs with API changes require:
- [ ] API Extractor report reviewed
- [ ] `MIGRATION.md` updated if breaking
- [ ] Deprecation warnings added if applicable
- [ ] Version bump planned (major vs. minor)

---

## Experimental Features

Features marked as **experimental** may change without following deprecation policy:

- Documented with `@experimental` tag
- CLI flags use `--experimental-*` prefix
- Not subject to stability guarantees
- May be removed or changed in patch releases

Example:
```typescript
/**
 * @experimental This API is experimental and may change in future releases.
 */
export async function experimentalFeature(): Promise<void> {
  // ...
}
```

---

## TypeScript Support

### Type Stability

- Public API types are **stable** (follow semver)
- Internal types may change in minor releases
- Type-only breaking changes still require major version bump

### Type Exports

Stable types exported from:
- `src/core/types.ts` - Core type definitions
- `src/core/config.ts` - Configuration types
- `src/core/state.ts` - State types
- `src/core/skill-registry.ts` - Skill types

---

## Compatibility Matrix

### Node.js Versions

| DanteForge Version | Node.js Requirement | Status |
|--------------------|---------------------|--------|
| 0.9.x              | ≥ 18.0.0            | Current |
| 1.0.x (planned)    | ≥ 18.0.0            | Future |

### LLM Provider Support

| Provider | Minimum Version | Status |
|----------|----------------|--------|
| Ollama   | 0.1.0+         | Stable |
| Claude   | API v1         | Stable |
| OpenAI   | API v1         | Stable |
| Grok     | API v1         | Stable |
| Gemini   | API v1         | Stable |

Provider APIs are wrapped in `src/core/llm.ts` to isolate breaking changes from upstream providers.

---

## Migration Guides

Detailed migration guides for each major version:

- [0.8.x → 0.9.x](../MIGRATION.md#08x--09x)
- [0.9.x → 1.0.x](../MIGRATION.md#09x--10x) (future)

---

## Support Policy

### Long-Term Support (LTS)

- **Current major version**: Full support (features + bug fixes)
- **Previous major version**: Critical bug fixes + security patches for 6 months
- **Older versions**: Community support only

### Security Updates

Security vulnerabilities receive patches for:
- Current major version
- Previous major version (6 months after release)

---

## Changelog & Release Notes

All releases include:

- **Changelog** (`CHANGELOG.md`): All changes categorized (Added, Changed, Deprecated, Removed, Fixed, Security)
- **Migration Guide** (`MIGRATION.md`): Breaking changes with code examples
- **Release Notes** (GitHub Releases): High-level summary + upgrade instructions

---

## Feedback & Questions

Questions about API stability:
- GitHub Discussions: https://github.com/anthropics/danteforge/discussions
- Issues: https://github.com/anthropics/danteforge/issues

Requests for API stability guarantees:
- Open a GitHub issue with "API Stability" label
- Provide use case and why stability is needed

---

## Enforcement

This policy is enforced through:
- ✅ API Extractor in CI (automated breaking change detection)
- ✅ Manual PR review checklist
- ✅ Release proof verification (`npm run release:check:strict`)
- ✅ Semantic versioning compliance

**Last Review:** 2026-04-01  
**Next Review:** 2026-07-01 (quarterly)
