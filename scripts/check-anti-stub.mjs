import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);

function getArgValue(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const rootDir = path.resolve(getArgValue('--root', process.cwd()));
const targetDirs = [
  'src/cli',
  'src/core',
  'src/utils',
  'hooks',
  'lib',
  'vscode-extension/src',
];

const allowedExtensions = new Set(['.ts', '.js', '.mjs', '.cjs']);
const blockedCommentPatterns = [
  /(?:\/\/|\/\*|\*)\s*.*\b(?:TODO|FIXME|TBD|stub|placeholder|dummy|fake|not implemented|coming soon)\b/i,
];
const blockedCodePatterns = [
  /\bthrow new Error\((['"`]).*\b(?:TODO|FIXME|TBD|stub|placeholder|not implemented|coming soon)\b.*\1\)/i,
];
// v0.8.1 expanded patterns — aligned with ANTI_STUB_PATTERNS in pdse-config.ts
const expandedPatterns = [
  /\bas\s+any\b/,                             // TypeScript type escape
  /@ts-ignore/,                               // TypeScript suppression
  /@ts-expect-error/,                         // TypeScript suppression
  /NotImplementedError/,                      // unfinished implementation
  /\bnot\s+implemented\b/i,                   // unfinished implementation
  /\bcoming\s+soon\b/i,                       // placeholder text
  /throw new Error\(['"]TODO/,                // TODO errors
  /\bxxx\b/i,                                 // placeholder marker
  /\bhack\b/i,                                // code smell
  /\bworkaround\b/i,                          // code smell
  /\btemporary\b/i,                            // transient code
  /\bunfinished\b/i,                          // incomplete code
  /\breturn\s+null\s*;?\s*\/\/\s*TODO/i,     // null return with TODO
  /console\.log\(['"]debug/i,                // debug logging
];

// Files fully exempt from ALL anti-stub checks (they define or reference patterns by design)
const fullyExemptFiles = [
  'pdse-config.ts',        // defines the anti-stub patterns themselves
  'check-anti-stub.mjs',   // this script references patterns by design
  'drift-detector.ts',     // defines stub-detection regex patterns by design
  'premium.ts',            // license validation stub is intentional (future implementation)
  'harsh-scorer.ts',       // stub detection engine — references patterns by design
];

// Files exempt from expanded pattern checks only (config, doctrine, docs, code-review tools)
const expandedExemptFiles = [
  'CONSTITUTION.md',
  'AGENTS.md',
  'CLAUDE.md',
  'paranoid-review.ts',    // code review tool that describes code smells (references "hack", etc.)
  'llm-stream.ts',         // legitimate `as any` type cast for provider override
  'prompt-builder.ts',     // CSS example templates contain `#xxx` placeholders
];

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dirPath, files = []) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files);
      continue;
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isViolation(line, { useExpanded = false } = {}) {
  if (/\banti-stub\b/i.test(line)) {
    return false;
  }

  if (blockedCommentPatterns.some(pattern => pattern.test(line))) return true;
  if (blockedCodePatterns.some(pattern => pattern.test(line))) return true;
  if (useExpanded && expandedPatterns.some(pattern => pattern.test(line))) return true;
  return false;
}

const violations = [];

for (const relativeDir of targetDirs) {
  const scanRoot = path.join(rootDir, relativeDir);
  if (!await exists(scanRoot)) {
    continue;
  }

  const files = await collectFiles(scanRoot);
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const fileName = path.basename(filePath);
    if (fullyExemptFiles.includes(fileName)) continue;
    const useExpanded = !expandedExemptFiles.includes(fileName);

    lines.forEach((line, index) => {
      if (!isViolation(line, { useExpanded })) {
        return;
      }

      violations.push({
        file: path.relative(rootDir, filePath) || path.basename(filePath),
        line: index + 1,
        text: line.trim(),
      });
    });
  }
}

if (violations.length > 0) {
  console.error('Anti-stub scan failed. Remove placeholder markers from shipped implementation files.');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.text}`);
  }
  process.exit(1);
}

console.log('Anti-stub scan passed.');
