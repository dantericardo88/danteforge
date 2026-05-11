#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const INSTALLED_JSON = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  '.claude', 'plugins', 'installed_plugins.json',
);

const COMMANDS_SRC = path.join(ROOT, '.claude-plugin', 'commands');
const PACKAGE_JSON = path.join(ROOT, 'package.json');

async function findCacheDir() {
  if (!existsSync(INSTALLED_JSON)) {
    console.warn(`[sync-plugin-cache] installed_plugins.json not found at ${INSTALLED_JSON} - skipping`);
    return null;
  }
  const raw = await readFile(INSTALLED_JSON, 'utf8');
  const meta = JSON.parse(raw);
  const entries = meta?.plugins?.['danteforge@danteforge-dev'];
  if (!Array.isArray(entries) || entries.length === 0) {
    console.warn('[sync-plugin-cache] No danteforge@danteforge-dev entry in installed_plugins.json - skipping');
    return null;
  }
  const sorted = [...entries].sort(
    (a, b) => new Date(b.lastUpdated ?? 0).getTime() - new Date(a.lastUpdated ?? 0).getTime(),
  );
  return sorted[0].installPath;
}

async function syncPackagedFiles(dest) {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
  for (const entry of pkg.files ?? []) {
    const srcPath = path.join(ROOT, entry);
    const destPath = path.join(dest, entry);
    if (!existsSync(srcPath)) continue;
    await cp(srcPath, destPath, { recursive: true, force: true });
  }
  await cp(PACKAGE_JSON, path.join(dest, 'package.json'), { force: true });
}

async function syncPluginCommands(dest) {
  await mkdir(path.join(dest, 'commands'), { recursive: true });
  const files = (await readdir(COMMANDS_SRC)).filter(f => f.endsWith('.md'));
  let synced = 0;
  for (const file of files) {
    const srcPath = path.join(COMMANDS_SRC, file);
    const destPath = path.join(dest, 'commands', file);
    const content = await readFile(srcPath, 'utf8');
    await writeFile(destPath, content, 'utf8');
    synced++;
  }
  return synced;
}

async function main() {
  const dest = await findCacheDir();
  if (!dest) return;

  if (!existsSync(dest)) {
    console.warn(`[sync-plugin-cache] Cache dir does not exist: ${dest} - skipping`);
    return;
  }

  await syncPackagedFiles(dest);
  const commandCount = await syncPluginCommands(dest);
  console.log(`[sync-plugin-cache] Synced package files and ${commandCount} command file(s) -> ${dest}`);
  console.log('[sync-plugin-cache] Restart Claude Code to pick up the updated commands.');
}

main().catch(err => {
  console.error('[sync-plugin-cache] Error:', err.message);
  process.exit(1);
});
