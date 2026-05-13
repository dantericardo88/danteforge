import path from 'path';
import type { TimeMachineContentType } from './time-machine.js';

export function normalizeRelativePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'trace';
}

export function detectContentType(filePath: string): TimeMachineContentType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.mdx') return 'markdown';
  if (['.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.yaml', '.yml', '.xml', '.csv'].includes(ext)) return 'text';
  return 'binary';
}
