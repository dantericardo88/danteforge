// Matrix Kernel — Shared state I/O (Phase 13a)
//
// Centralizes "read/write the JSON file for graph X" so CLI commands don't
// re-implement fs.readFile + JSON.parse + path resolution per call.
import fs from 'node:fs/promises';
import path from 'node:path';
import { MATRIX_REPORT_PATHS, MATRIX_DIR } from '../types/index.js';
import type { MatrixReportName } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load a Matrix graph/report by canonical name. Returns null if the file
 * doesn't exist yet (caller decides whether absence is an error).
 */
export async function loadGraph<T>(cwd: string, reportName: MatrixReportName): Promise<T | null> {
  const filePath = path.join(cwd, MATRIX_REPORT_PATHS[reportName]);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Save a Matrix graph/report. Creates the matrix directory if missing.
 * Returns the absolute path written.
 */
export async function saveGraph<T>(
  cwd: string,
  reportName: MatrixReportName,
  data: T,
): Promise<string> {
  const filePath = path.join(cwd, MATRIX_REPORT_PATHS[reportName]);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

/**
 * Append an item to a collection inside a graph JSON. The graph file shape
 * is expected to be `{ [collectionKey]: T[], generatedAt: string, ...rest }`.
 * Creates the file with an empty collection if missing.
 */
export async function appendToCollection<T>(
  cwd: string,
  reportName: MatrixReportName,
  collectionKey: string,
  item: T,
): Promise<void> {
  const existing = (await loadGraph<Record<string, unknown>>(cwd, reportName)) ?? {};
  const arr = (existing[collectionKey] as T[] | undefined) ?? [];
  arr.push(item);
  existing[collectionKey] = arr;
  existing.generatedAt = new Date().toISOString();
  await saveGraph(cwd, reportName, existing);
}

/**
 * Patch one or more top-level fields of a graph JSON in place. If the file
 * doesn't exist yet, creates it with just the patched fields.
 */
export async function patchGraph<T extends Record<string, unknown>>(
  cwd: string,
  reportName: MatrixReportName,
  patch: Partial<T>,
): Promise<void> {
  const existing = (await loadGraph<Record<string, unknown>>(cwd, reportName)) ?? {};
  for (const [k, v] of Object.entries(patch)) existing[k] = v as unknown;
  existing.generatedAt = new Date().toISOString();
  await saveGraph(cwd, reportName, existing);
}

/**
 * Ensure the matrix kernel scaffolding directory exists.
 */
export async function ensureMatrixDir(cwd: string): Promise<string> {
  const dir = path.join(cwd, MATRIX_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'mailbox'), { recursive: true });
  await fs.mkdir(path.join(dir, 'leases'), { recursive: true });
  return dir;
}
