import path from 'path';
import fs from 'fs/promises';
import { estimateTokens } from './token-estimator.js';

export type PackFormat = 'xml' | 'markdown' | 'plain';

export interface PackFileEntry {
  relativePath: string;
  content: string;
  tokens: number;
  sizeBytes: number;
  language: string;
  compressed?: boolean;
}

export interface PackResult {
  format: PackFormat;
  fileTree: string;
  files: PackFileEntry[];
  totalTokens: number;
  totalFiles: number;
  output: string;
  ignoredFiles: number;
}

export interface PackOptions {
  format?: PackFormat;
  include?: string[];
  exclude?: string[];
  respectGitignore?: boolean;
  maxTokensPerFile?: number;
  maxTotalTokens?: number;
  smartPriority?: boolean;
  compressLargeFiles?: boolean;
  generateIndex?: boolean;
  cwd?: string;
  _readFile?: (p: string) => Promise<string>;
  _readdir?: (p: string, opts: { withFileTypes: true }) => Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  _stat?: (p: string) => Promise<{ size: number }>;
  _exists?: (p: string) => Promise<boolean>;
}

type DirEntry = { name: string; isDirectory(): boolean; isFile(): boolean };

const DEFAULT_EXCLUDES = [
  'node_modules', '.git', 'dist', 'coverage', '.danteforge/plugin-modules',
  '.nyc_output', '.cache', 'build', '*.min.js', '*.map',
];

const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.exe', '.dll',
  '.pdf',
  '.mp4', '.mp3', '.webm',
];

export function inferLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.sh': 'shell', '.bash': 'shell',
    '.yml': 'yaml', '.yaml': 'yaml',
    '.json': 'json',
    '.md': 'markdown',
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'css', '.sass': 'css',
    '.sql': 'sql',
    '.toml': 'toml',
    '.env': 'env', '.envrc': 'env',
  };
  return map[ext] ?? 'text';
}

export function parseGitignore(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

export function matchesGitignore(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const base = path.basename(normalizedPath);

  for (const pattern of patterns) {
    // Skip negation patterns
    if (pattern.startsWith('!')) continue;

    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Directory pattern (ends with /)
    if (normalizedPattern.endsWith('/')) {
      const dirPart = normalizedPattern.slice(0, -1);
      if (normalizedPath.includes(dirPart + '/') || normalizedPath.startsWith(dirPart + '/')) {
        return true;
      }
      continue;
    }

    // Wildcard prefix (e.g., *.log)
    if (normalizedPattern.startsWith('*')) {
      const suffix = normalizedPattern.slice(1);
      if (base.endsWith(suffix)) return true;
      continue;
    }

    // Wildcard suffix (e.g., build*)
    if (normalizedPattern.endsWith('*')) {
      const prefix = normalizedPattern.slice(0, -1);
      if (base.startsWith(prefix)) return true;
      continue;
    }

    // Plain match: path component or basename equals pattern OR path includes it as a segment
    if (base === normalizedPattern) return true;
    if (normalizedPath === normalizedPattern) return true;
    // Match as path segment (e.g., "dist" matches "dist/bundle.js")
    if (normalizedPath.startsWith(normalizedPattern + '/')) return true;
    if (normalizedPath.includes('/' + normalizedPattern + '/')) return true;
    if (normalizedPath.includes('/' + normalizedPattern) && normalizedPath.endsWith('/' + normalizedPattern)) return true;
  }

  return false;
}

export function buildFileTree(relativePaths: string[]): string {
  if (relativePaths.length === 0) return '';

  // Sort paths
  const sorted = [...relativePaths].sort();

  // Build a tree structure
  type TreeNode = { children: Map<string, TreeNode>; isFile: boolean };
  const root: TreeNode = { children: new Map(), isFile: false };

  for (const filePath of sorted) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map(), isFile: i === parts.length - 1 });
      }
      node = node.children.get(part)!;
    }
  }

  const lines: string[] = [];

  function renderNode(node: TreeNode, prefix: string, name: string, isLast: boolean): void {
    const connector = isLast ? '└──' : '├──';
    const label = node.isFile ? name : name + '/';
    lines.push(prefix + connector + ' ' + label);
    if (!node.isFile && node.children.size > 0) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      const entries = Array.from(node.children.entries());
      entries.forEach(([childName, childNode], idx) => {
        renderNode(childNode, childPrefix, childName, idx === entries.length - 1);
      });
    }
  }

  const entries = Array.from(root.children.entries());
  entries.forEach(([name, node], idx) => {
    renderNode(node, '', name, idx === entries.length - 1);
  });

  return lines.join('\n');
}

export function renderPackMarkdown(result: Omit<PackResult, 'output'>): string {
  const ts = new Date().toISOString();
  const parts: string[] = [
    '# Workspace Pack',
    '',
    `Generated: ${ts}`,
    `Files: ${result.totalFiles} | Total tokens: ${result.totalTokens}`,
    '',
    '## File Tree',
    '',
    '```',
    result.fileTree,
    '```',
    '',
    '## Files',
    '',
  ];

  for (const file of result.files) {
    parts.push(`### ${file.relativePath}`);
    parts.push('');
    parts.push('```' + file.language);
    parts.push(file.content);
    parts.push('```');
    parts.push('');
  }

  return parts.join('\n');
}

export function renderPackXml(result: Omit<PackResult, 'output'>): string {
  const fileEntries = result.files.map(f =>
    `    <file path="${escapeXmlAttr(f.relativePath)}" language="${escapeXmlAttr(f.language)}" tokens="${f.tokens}" sizeBytes="${f.sizeBytes}">\n      <![CDATA[${f.content}]]>\n    </file>`
  ).join('\n');

  return [
    '<workspace>',
    `  <summary files="${result.totalFiles}" totalTokens="${result.totalTokens}" />`,
    `  <fileTree><![CDATA[${result.fileTree}]]></fileTree>`,
    '  <files>',
    fileEntries,
    '  </files>',
    '</workspace>',
  ].join('\n');
}

export function renderPackPlain(result: Omit<PackResult, 'output'>): string {
  const parts: string[] = [
    '=== WORKSPACE PACK ===',
    `Files: ${result.totalFiles} | Tokens: ${result.totalTokens}`,
    '',
    'FILE TREE:',
    result.fileTree,
    '',
  ];

  for (const file of result.files) {
    parts.push('================');
    parts.push(`FILE: ${file.relativePath} (${file.language}, ${file.tokens} tokens)`);
    parts.push('================');
    parts.push(file.content);
    parts.push('');
  }

  return parts.join('\n');
}

function priorityScore(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = path.basename(normalized);

  if (/^(src|lib)\//.test(normalized)) return 4;
  if (/^(tests?|spec)\//.test(normalized)) return 3;
  if (/^docs\//.test(normalized) || base.endsWith('.md') || base.startsWith('README')) return 3;
  if (/\.(config\.[^/]+|json|ya?ml)$/.test(normalized) && base !== 'package.json') return 1;
  return 2;
}

export function prioritizeFiles(files: PackFileEntry[]): PackFileEntry[] {
  // Stable sort: use index to preserve order within same tier
  return files.map((f, i) => ({ f, i, score: priorityScore(f.relativePath) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ f }) => f);
}

export function compressFileContent(entry: PackFileEntry, maxTokens: number): PackFileEntry {
  const estimatedTokens = Math.ceil(entry.content.length / 4);
  if (estimatedTokens <= maxTokens) return entry;

  const lines = entry.content.split('\n');
  const last50 = lines.slice(-50);
  const firstLine = lines[0] ?? '';
  const compressed = firstLine + '\n... [truncated — showing last 50 lines] ...\n' + last50.join('\n');
  return { ...entry, content: compressed, compressed: true };
}

export function buildProjectIndex(result: Omit<PackResult, 'output'>): string {
  const topFiles = prioritizeFiles(result.files).slice(0, 10);
  const fileLines = topFiles.map(f => {
    const firstNonEmpty = f.content.split('\n').find(l => l.trim().length > 0) ?? '';
    return `  ${f.relativePath} — ${firstNonEmpty.trim().slice(0, 80)}`;
  });

  return [
    '=== PROJECT INDEX ===',
    `Total files: ${result.totalFiles} | Estimated tokens: ${result.totalTokens}`,
    'Key files (top 10 by priority):',
    ...fileLines,
    '=====================',
    '',
  ].join('\n');
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function matchesDefaultExclude(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');

  for (const exclude of DEFAULT_EXCLUDES) {
    if (exclude.startsWith('*')) {
      const suffix = exclude.slice(1);
      const base = path.basename(normalizedPath);
      if (base.endsWith(suffix)) return true;
    } else {
      // Check if any path component matches
      if (parts.includes(exclude)) return true;
      // Also check path prefix for multi-segment excludes like '.danteforge/plugin-modules'
      if (normalizedPath === exclude || normalizedPath.startsWith(exclude + '/')) return true;
    }
  }
  return false;
}

export async function packWorkspace(options?: PackOptions): Promise<PackResult> {
  const cwd = options?.cwd ?? process.cwd();
  const format = options?.format ?? 'markdown';

  const readFile = options?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const readdir = options?._readdir ?? ((p: string, opts: { withFileTypes: true }) =>
    fs.readdir(p, opts) as Promise<Array<DirEntry>>
  );
  const stat = options?._stat ?? ((p: string) => fs.stat(p));
  const exists = options?._exists ?? ((p: string) => fs.access(p).then(() => true, () => false));

  // Load .gitignore
  let gitignorePatterns: string[] = [];
  if (options?.respectGitignore !== false) {
    const gitignorePath = path.join(cwd, '.gitignore');
    const hasGitignore = await exists(gitignorePath);
    if (hasGitignore) {
      try {
        const content = await readFile(gitignorePath);
        gitignorePatterns = parseGitignore(content);
      } catch {
        // ignore
      }
    }
  }

  // Recursively collect all files
  const allRelativePaths: string[] = [];

  async function collectFiles(dirRelative: string): Promise<void> {
    const dirAbsolute = dirRelative ? path.join(cwd, dirRelative) : cwd;
    let entries: Array<DirEntry>;
    try {
      entries = await readdir(dirAbsolute, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = dirRelative ? `${dirRelative}/${entry.name}` : entry.name;

      if (matchesDefaultExclude(relativePath)) continue;

      if (entry.isDirectory()) {
        await collectFiles(relativePath);
      } else if (entry.isFile()) {
        allRelativePaths.push(relativePath);
      }
    }
  }

  await collectFiles('');

  // Filter out binary extensions
  const textPaths = allRelativePaths.filter(p => {
    const ext = path.extname(p).toLowerCase();
    return !BINARY_EXTENSIONS.includes(ext);
  });

  // Apply gitignore
  const afterGitignore = gitignorePatterns.length > 0
    ? textPaths.filter(p => !matchesGitignore(p, gitignorePatterns))
    : textPaths;

  // Apply user include filter
  const afterInclude = options?.include && options.include.length > 0
    ? afterGitignore.filter(p => {
        const inc = options.include!;
        return inc.some(pattern => {
          if (pattern.startsWith('*')) {
            return p.endsWith(pattern.slice(1));
          }
          return p === pattern || p.startsWith(pattern + '/') || p.includes('/' + pattern);
        });
      })
    : afterGitignore;

  // Apply user exclude filter
  const afterExclude = options?.exclude && options.exclude.length > 0
    ? afterInclude.filter(p => {
        const exc = options.exclude!;
        return !exc.some(pattern => {
          if (pattern.startsWith('*')) {
            return p.endsWith(pattern.slice(1));
          }
          return p === pattern || p.startsWith(pattern + '/') || p.includes('/' + pattern);
        });
      })
    : afterInclude;

  // Process files
  const fileEntries: PackFileEntry[] = [];
  let ignoredFiles = 0;

  for (const relativePath of afterExclude) {
    const absolutePath = path.join(cwd, relativePath);
    let content: string;
    let sizeBytes: number;

    try {
      content = await readFile(absolutePath);
      const info = await stat(absolutePath);
      sizeBytes = info.size;
    } catch {
      ignoredFiles++;
      continue;
    }

    const tokens = estimateTokens(content);

    if (options?.maxTokensPerFile !== undefined && tokens > options.maxTokensPerFile) {
      ignoredFiles++;
      continue;
    }

    const language = inferLanguage(relativePath);

    fileEntries.push({ relativePath, content, tokens, sizeBytes, language });
  }

  // Smart priority sort
  let processedEntries = options?.smartPriority ? prioritizeFiles(fileEntries) : fileEntries;

  // Compress large files
  if (options?.compressLargeFiles) {
    const compressLimit = options.maxTokensPerFile ?? 2000;
    processedEntries = processedEntries.map(e => compressFileContent(e, compressLimit));
  }

  // Apply total token budget
  if (options?.maxTotalTokens !== undefined) {
    const budget = options.maxTotalTokens;
    let accumulated = 0;
    const withinBudget: PackFileEntry[] = [];
    for (const entry of processedEntries) {
      if (accumulated + entry.tokens > budget) {
        ignoredFiles++;
      } else {
        accumulated += entry.tokens;
        withinBudget.push(entry);
      }
    }
    processedEntries = withinBudget;
  }

  const totalTokens = processedEntries.reduce((sum, f) => sum + f.tokens, 0);
  const fileTree = buildFileTree(processedEntries.map(f => f.relativePath));

  const resultWithoutOutput: Omit<PackResult, 'output'> = {
    format,
    fileTree,
    files: processedEntries,
    totalTokens,
    totalFiles: processedEntries.length,
    ignoredFiles,
  };

  let output: string;
  if (format === 'xml') {
    output = renderPackXml(resultWithoutOutput);
  } else if (format === 'plain') {
    output = renderPackPlain(resultWithoutOutput);
  } else {
    output = renderPackMarkdown(resultWithoutOutput);
  }

  if (options?.generateIndex) {
    output = buildProjectIndex(resultWithoutOutput) + output;
  }

  return { ...resultWithoutOutput, output };
}
