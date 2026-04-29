#!/usr/bin/env node
// Pass 24 T3.1 — post-edit auto-commit hook.
//
// Reads a Claude Code PostToolUse payload from stdin. When the payload is for
// an Edit, Write, or NotebookEdit tool, snapshots the touched files into Time
// Machine via createTimeMachineCommit so every agent edit is reversible and
// causally anchored.
//
// HONEST SCOPE: This is *post*-edit, not *pre*-edit. Pre-edit interception
// (preventing the LLM from observing a corrupted intermediate state) requires
// Claude Code harness extensions that are not currently exposed; deferred to
// PRD Pass 27.
//
// Failures here are best-effort: the hook never blocks the editor, even if
// Time Machine itself errors. We always exit 0; diagnostic output goes to
// stderr.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
    if (process.stdin.isTTY) resolve('');
  });
}

function extractPaths(payload) {
  const tool = payload.tool_name ?? payload.toolName ?? payload.tool ?? '';
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return [];
  const input = payload.tool_input ?? payload.toolInput ?? payload.input ?? {};
  const single = input.file_path ?? input.filePath ?? input.path;
  if (typeof single === 'string' && single.length > 0) return [single];
  return [];
}

function relPath(cwd, abs) {
  try {
    const r = path.relative(cwd, path.resolve(abs));
    if (r.startsWith('..')) return null;
    return r.replace(/\\/g, '/');
  } catch {
    return null;
  }
}

async function main() {
  const cwd = process.cwd();
  const raw = await readStdin();
  if (!raw.trim()) return;
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  const abs = extractPaths(payload);
  if (abs.length === 0) return;
  const paths = abs.map(p => relPath(cwd, p)).filter(Boolean);
  if (paths.length === 0) return;

  // Skip if no .danteforge yet — TM commit would create state in a fresh repo.
  try {
    await readFile(path.join(cwd, '.danteforge', 'STATE.yaml'));
  } catch {
    return;
  }

  // Spawn `forge time-machine commit` non-blocking. Use detached so we don't
  // hold the editor's stdio.
  const args = ['time-machine', 'commit', '--label', 'post-edit-auto'];
  for (const p of paths) { args.push('--path', p); }

  const child = spawn('forge', args, {
    cwd,
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  });
  child.on('error', () => {
    // forge not on PATH (dev environment); silently no-op.
  });
  child.unref();
}

try {
  await main();
} catch (err) {
  process.stderr.write(`[post-tool-use] non-fatal: ${err instanceof Error ? err.message : String(err)}\n`);
}
process.exit(0);
