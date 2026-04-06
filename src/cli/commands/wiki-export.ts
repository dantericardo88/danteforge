// wiki-export command — export wiki as Obsidian vault or static HTML
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { WIKI_DIR } from '../../core/wiki-schema.js';
import { parseFrontmatter, extractBody } from '../../core/wiki-indexer.js';

export type ExportFormat = 'obsidian' | 'html';

export interface WikiExportCommandOptions {
  format?: ExportFormat;
  out?: string;
  cwd?: string;
  _readDir?: (dir: string) => Promise<string[]>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, c: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  _copyFiles?: (srcDir: string, destDir: string, files: string[]) => Promise<void>;
}

async function defaultReadDir(dir: string): Promise<string[]> {
  const { default: fs } = await import('node:fs/promises');
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map(e => path.join(dir, e.name));
  } catch { return []; }
}

async function defaultReadFile(p: string): Promise<string> {
  const { default: fs } = await import('node:fs/promises');
  return fs.readFile(p, 'utf8');
}

async function defaultWriteFile(p: string, c: string): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.writeFile(p, c, 'utf8');
}

async function defaultMkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(p, opts);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToHtmlBasic(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[\[([^\]]+)\]\]/g, '<a href="$1.html">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => line.startsWith('<') ? line : line);
}

function buildHtmlPage(entityId: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(entityId)} — DanteForge Wiki</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    h1, h2, h3 { border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
    a { color: #0066cc; }
    nav { margin-bottom: 2rem; padding: 1rem; background: #f8f8f8; border-radius: 4px; }
  </style>
</head>
<body>
  <nav><a href="index.html">← Wiki Index</a></nav>
  <article>
    ${markdownToHtmlBasic(body)}
  </article>
</body>
</html>`;
}

export async function wikiExportCommand(options: WikiExportCommandOptions = {}): Promise<void> {
  return withErrorBoundary('wiki-export', async () => {
    const cwd = options.cwd ?? process.cwd();
    const format = options.format ?? 'obsidian';
    const outDir = options.out ?? path.join(cwd, `wiki-export-${format}`);

    const readDir = options._readDir ?? defaultReadDir;
    const readFile = options._readFile ?? defaultReadFile;
    const writeFile = options._writeFile ?? defaultWriteFile;
    const mkdir = options._mkdir ?? defaultMkdir;

    const wikiDir = path.join(cwd, WIKI_DIR);
    const files = await readDir(wikiDir);

    if (files.length === 0) {
      logger.warn('Wiki is empty. Run `danteforge wiki-ingest` first.');
      return;
    }

    await mkdir(outDir, { recursive: true });

    if (format === 'obsidian') {
      // Obsidian vault: copy .md files as-is (already uses [[wikilinks]] format)
      if (options._copyFiles) {
        await options._copyFiles(wikiDir, outDir, files);
      } else {
        for (const filePath of files) {
          try {
            const content = await readFile(filePath);
            const destPath = path.join(outDir, path.basename(filePath));
            await writeFile(destPath, content);
          } catch { /* skip */ }
        }
      }
      logger.success(`Exported ${files.length} pages to Obsidian vault: ${outDir}`);
      logger.info('Open the folder as a vault in Obsidian for graph view and backlinks.');
    } else {
      // HTML: render each page as static HTML
      const indexLines = ['<ul>'];
      let exported = 0;

      for (const filePath of files) {
        if (filePath.endsWith('LINT_REPORT.md') || filePath.endsWith('pdse-history.md')) continue;
        try {
          const content = await readFile(filePath);
          const fm = parseFrontmatter(content);
          const body = extractBody(content);
          const entityId = fm?.entity ?? path.basename(filePath, '.md');
          const html = buildHtmlPage(entityId, body);
          await writeFile(path.join(outDir, `${entityId}.html`), html);
          indexLines.push(`<li><a href="${entityId}.html">${entityId}</a> (${fm?.type ?? 'unknown'})</li>`);
          exported++;
        } catch { /* skip */ }
      }

      indexLines.push('</ul>');
      const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>DanteForge Wiki</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;}</style>
</head>
<body><h1>DanteForge Wiki</h1>${indexLines.join('\n')}</body>
</html>`;
      await writeFile(path.join(outDir, 'index.html'), indexHtml);
      logger.success(`Exported ${exported} pages to HTML: ${outDir}`);
    }
  });
}
