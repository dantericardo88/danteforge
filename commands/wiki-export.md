---
name: wiki-export
description: "Export the compiled wiki as an Obsidian-compatible vault or static HTML site."
---

# /wiki-export — Wiki Export

When the user invokes `/wiki-export`, export the compiled wiki in the requested format:

1. **Obsidian vault** (`--format obsidian`, default): Copy all `.md` files from `wiki/` to the output directory. The `[[wikilinks]]` format is already Obsidian-compatible. Open the folder as a vault for graph view and backlink navigation.

2. **Static HTML** (`--format html`): Render each entity page as a standalone HTML file with inter-page links. Generates an `index.html` with a full entity listing.

3. **Output directory**: Default is `wiki-export-<format>` in the current working directory. Override with `--out <dir>`.

Options:
- `--format obsidian|html`: Export format (default: obsidian)
- `--out <dir>`: Output directory path

CLI usage: `danteforge wiki-export [--format obsidian|html] [--out <dir>]`

Note: Export is read-only — no wiki files are modified during export.
