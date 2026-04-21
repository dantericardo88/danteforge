// Drift Detector — detects AI-specific code quality issues
// Harvested from: Rigour (rigour-labs) — hallucinated imports, stub patterns, phantom APIs
// Uses regex + file system checks (zero AST dependencies)

import fs from 'fs/promises';
import path from 'path';
import type { Violation, ViolationSeverity } from './fix-packet.js';

// --- Patterns ----------------------------------------------------------------

const STUB_PATTERNS = [
  { pattern: /\bTODO\b/g, label: 'TODO marker' },
  { pattern: /\bFIXME\b/g, label: 'FIXME marker' },
  { pattern: /\bnot\s+implemented\b/i, label: 'Not implemented placeholder' },
  { pattern: /\bplaceholder\b/i, label: 'Placeholder text' },
  { pattern: /throw\s+new\s+Error\s*\(\s*['"`](?:TODO|not implemented|implement me)/i, label: 'Stub throw' },
];

const IMPORT_PATTERNS = [
  // ESM: import X from 'Y' or import { X } from 'Y'
  /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"./][^'"]*)['"]/g,
  // CJS: require('Y')
  /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
];

const PHANTOM_API_PATTERNS = [
  /fetch\s*\(\s*['"`](https?:\/\/[^'"` ]+)['"`]/g,
  /axios\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*['"`](https?:\/\/[^'"` ]+)['"`]/g,
];

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// --- Helpers -----------------------------------------------------------------

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isBuiltinOrScoped(pkg: string): Promise<boolean> {
  // Node.js builtins
  if (pkg.startsWith('node:') || ['fs', 'path', 'os', 'url', 'util', 'http', 'https',
    'crypto', 'stream', 'events', 'child_process', 'assert', 'buffer', 'querystring',
    'readline', 'zlib', 'net', 'tls', 'dns', 'dgram', 'cluster', 'worker_threads',
    'perf_hooks', 'test', 'v8', 'vm', 'tty'].includes(pkg)) {
    return true;
  }
  return false;
}

function extractPackageName(importPath: string): string {
  // @scoped/package → @scoped/package
  // package/subpath → package
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
  }
  return importPath.split('/')[0]!;
}

function stripCommentsForImportScan(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// --- Detectors ---------------------------------------------------------------

async function detectHallucinatedImports(
  filePath: string,
  content: string,
  cwd: string,
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const importScanContent = stripCommentsForImportScan(content);

  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(importScanContent)) !== null) {
      const rawImport = match[1]!;
      const pkgName = extractPackageName(rawImport);

      if (await isBuiltinOrScoped(pkgName)) continue;

      // Check node_modules
      const nodeModulePath = path.join(cwd, 'node_modules', pkgName);
      if (await fileExists(nodeModulePath)) continue;

      // Check if it's a project-relative path that got confused
      const projectPath = path.join(cwd, rawImport);
      if (await fileExists(projectPath) || await fileExists(`${projectPath}.ts`) || await fileExists(`${projectPath}.js`)) continue;

      const lineNumber = importScanContent.substring(0, match.index).split('\n').length;
      violations.push({
        type: 'ai-drift',
        severity: 'HIGH' as ViolationSeverity,
        file: filePath,
        line: lineNumber,
        message: `Hallucinated import: "${rawImport}" not found in node_modules or project`,
        evidence: match[0],
      });
    }
  }

  return violations;
}

function detectStubPatterns(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];

  for (const { pattern, label } of STUB_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      violations.push({
        type: 'stub-detected',
        severity: 'MEDIUM' as ViolationSeverity,
        file: filePath,
        line: lineNumber,
        message: `${label} found`,
        evidence: content.split('\n')[lineNumber - 1]?.trim(),
      });
    }
  }

  return violations;
}

function detectPhantomAPIs(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];

  for (const pattern of PHANTOM_API_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const url = match[1]!;
      // Skip well-known API bases
      if (/localhost|127\.0\.0\.1|example\.com|placeholder/i.test(url)) continue;

      const lineNumber = content.substring(0, match.index).split('\n').length;
      violations.push({
        type: 'ai-drift',
        severity: 'MEDIUM' as ViolationSeverity,
        file: filePath,
        line: lineNumber,
        message: `Hardcoded API URL: "${url}" — verify this endpoint exists`,
        evidence: match[0],
      });
    }
  }

  return violations;
}

// --- Public API --------------------------------------------------------------

export async function detectAIDrift(
  filesModified: string[],
  cwd = process.cwd(),
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const filePath of filesModified) {
    const ext = path.extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue; // File may have been deleted or moved
    }

    violations.push(
      ...await detectHallucinatedImports(filePath, content, cwd),
      ...detectStubPatterns(filePath, content),
      ...detectPhantomAPIs(filePath, content),
    );
  }

  return violations;
}
