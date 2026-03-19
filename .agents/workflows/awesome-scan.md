---
name: awesome-scan
description: "Discover, classify, and import skills — scan all sources for compatible skill catalogs"
---

# /awesome-scan — Skill Discovery

When the user invokes `/awesome-scan`, follow this workflow:

1. **Scan sources**: Search for skills across:
   - Packaged DanteForge skills
   - Personal skill directories (~/.claude/skills, ~/.codex/skills, etc.)
   - External source (if `--source` provided)
2. **Classify**: Auto-classify each skill by domain (security, fullstack, devops, ux, backend, frontend, data, testing, architecture, general)
3. **Report**: Show total skills found, by domain, compatibility status
4. **Import**: If `--install` flag, import compatible external skills into the packaged catalog

Options:
- `--source <path>` — Scan an external directory for skills
- `--domain <type>` — Filter by domain
- `--install` — Import compatible external skills

CLI fallback: `danteforge awesome-scan`
