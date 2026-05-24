// export — bundle project state for sharing
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  output?: string;
  includeHistory?: boolean;
  cwd?: string;
  /** Injectable file reader for testing */
  _readFile?: (filePath: string) => Promise<string | null>;
  /** Injectable file writer for testing */
  _writeFile?: (filePath: string, content: string) => Promise<void>;
}

export interface ExportResult {
  outputPath: string;
  includedFiles: string[];
  excludedFiles: string[];
  timestamp: string;
}

export interface ExportBundle {
  version: string;
  exportedAt: string;
  project: string;
  files: Record<string, string>;
  snapshots: string[];
}

// ---------------------------------------------------------------------------
// File collection helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to read a file. Returns null if the file does not exist.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Read the last N snapshot files from a directory, sorted by name descending.
 */
async function readSnapshots(dir: string, limit: number): Promise<Array<{ name: string; content: string }>> {
  try {
    const entries = await fs.readdir(dir);
    const sorted = entries
      .filter(e => e.endsWith('.yaml') || e.endsWith('.json') || e.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit);

    const results: Array<{ name: string; content: string }> = [];
    for (const entry of sorted) {
      try {
        const content = await fs.readFile(path.join(dir, entry), 'utf8');
        results.push({ name: entry, content });
      } catch {
        // individual snapshot read failed — skip
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Extract the project name from STATE.yaml content, or default to the cwd basename.
 */
function extractProjectName(stateContent: string | null, cwd: string): string {
  if (stateContent) {
    const m = stateContent.match(/^project:\s*["']?(.+?)["']?\s*$/m);
    if (m) return m[1].trim();
  }
  return path.basename(cwd);
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Export project state as a JSON bundle for sharing.
 *
 * Collects:
 *   - .danteforge/STATE.yaml
 *   - .danteforge/compete/matrix.json
 *   - .danteforge/GUIDE.md (if exists)
 *   - .danteforge/SPEC.md (if exists)
 *   - .danteforge/snapshots/ (last 3 if --include-history)
 *
 * Output: .danteforge/export-<timestamp>.json
 */
export async function exportState(options: ExportOptions = {}): Promise<ExportResult> {
  const cwd = options.cwd ?? process.cwd();
  const danteDir = path.join(cwd, '.danteforge');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = options.output ?? path.join(danteDir, `export-${timestamp}.json`);

  const readFile = options._readFile ?? tryReadFile;
  const writeFile = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  const includedFiles: string[] = [];
  const excludedFiles: string[] = [];
  const files: Record<string, string> = {};

  // Ensure .danteforge directory exists before writing
  try {
    await fs.mkdir(danteDir, { recursive: true });
  } catch {
    // already exists
  }

  // --- Core files ---
  const coreFiles: Array<{ key: string; absPath: string }> = [
    { key: 'STATE.yaml', absPath: path.join(danteDir, 'STATE.yaml') },
    { key: 'compete/matrix.json', absPath: path.join(danteDir, 'compete', 'matrix.json') },
    { key: 'GUIDE.md', absPath: path.join(danteDir, 'GUIDE.md') },
    { key: 'SPEC.md', absPath: path.join(danteDir, 'SPEC.md') },
  ];

  for (const { key, absPath } of coreFiles) {
    const content = await readFile(absPath);
    if (content !== null) {
      files[key] = content;
      includedFiles.push(key);
    } else {
      excludedFiles.push(key);
    }
  }

  // --- Snapshots ---
  const snapshots: string[] = [];
  if (options.includeHistory) {
    const snapshotDir = path.join(danteDir, 'snapshots');
    const found = await readSnapshots(snapshotDir, 3);
    for (const snap of found) {
      const key = `snapshots/${snap.name}`;
      files[key] = snap.content;
      snapshots.push(key);
      includedFiles.push(key);
    }
  }

  const stateContent = files['STATE.yaml'] ?? null;
  const project = extractProjectName(stateContent, cwd);

  const bundle: ExportBundle = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    project,
    files,
    snapshots,
  };

  await writeFile(outputPath, JSON.stringify(bundle, null, 2));

  process.stdout.write(`[export] Bundle written to: ${outputPath}\n`);
  process.stdout.write(`[export] Included: ${includedFiles.join(', ') || 'none'}\n`);
  if (excludedFiles.length > 0) {
    process.stdout.write(`[export] Excluded (not found): ${excludedFiles.join(', ')}\n`);
  }

  return { outputPath, includedFiles, excludedFiles, timestamp };
}
