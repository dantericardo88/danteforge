---
name: wiki-ingest
description: "Ingest raw source files into compiled wiki entity pages. Use --bootstrap to seed from existing .danteforge/ artifacts."
---

# /wiki-ingest — Wiki Ingest Pipeline

When the user invokes `/wiki-ingest`, follow this workflow:

1. **Initialize wiki directories**: Create `.danteforge/wiki/`, `.danteforge/raw/`, and `.danteforge/constitution/` if they do not exist.

2. **Bootstrap mode** (`--bootstrap`): Read existing `.danteforge/` artifacts (CONSTITUTION.md, SPEC.md, PLAN.md, TASKS.md, lessons.md) and promote them to wiki entity pages. This is the recommended first-time setup.

3. **Standard mode**: Scan `.danteforge/raw/` for new or changed files (hash-compared against `.manifest.json`). For each changed file, extract entities via LLM and upsert entity pages.

4. **Anti-stub enforcement**: Any generated wiki page is checked against `ANTI_STUB_PATTERNS` from PDSE config. Pages with TODO/FIXME/placeholder content are rejected.

5. **Rebuild index**: After ingestion, rebuild `wiki/index.md` with all entity cross-links.

6. **Audit entry**: Record the ingest event to `.danteforge/wiki/.audit-log.jsonl`.

7. **Constitutional integrity check**: Before any wiki write, verify SHA-256 hashes of Tier 1 constitutional documents. BLOCKED state if any violation detected.

CLI usage: `danteforge wiki-ingest [--bootstrap] [--prompt]`
