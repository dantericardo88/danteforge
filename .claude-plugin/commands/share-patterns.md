---
name: danteforge-share-patterns
description: "Export your pattern bundle — anonymized attribution log for sharing with other DanteForge projects"
---

# /share-patterns — Export Pattern Bundle

When the user invokes `/share-patterns`, create an anonymized pattern bundle from the
current project's attribution log for sharing with other DanteForge projects.

1. **Load attribution log**: Read records from `.danteforge/attribution-log.json`
2. **Filter**: Only include patterns with `verifyStatus: 'pass'` and positive score delta
3. **Anonymize**: SHA-256 hash the project path — no project name or file paths exposed
4. **Include refused list**: Add refused pattern names so importers know what NOT to adopt
5. **Export**: Write bundle to `.danteforge/pattern-bundle.json`

The bundle uses Bayesian shrinkage on import — high-delta claims with small sample counts
will be automatically discounted by the importing project.

## When to use this
- After running `/outcome-check` to validate your patterns are real
- When collaborating across multiple codebases that share a tech stack
- After a successful `/inferno` or `/magic` run with validated outcomes

## Output
- Patterns exported: N (with avg delta and sample count)
- Refused pattern names included: N
- Bundle path: `.danteforge/pattern-bundle.json`

CLI parity: `danteforge share-patterns [--output <path>]`
