#!/usr/bin/env node
// Installer: builds DanteForge + DanteForgeEngine, syncs to DanteCode, installs VS Code extension.
// Usage: node scripts/install-dantecode.mjs [--dantecode-path <path>] [--engine-path <path>]

import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DANTEFORGE_ROOT = resolve(__dirname, '..');

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.split('=').slice(1).join('=') : null;
}

function findDir(flagName, ...candidates) {
  const fromFlag = getArg(flagName);
  if (fromFlag) return resolve(fromFlag);
  for (const c of candidates) {
    const p = resolve(DANTEFORGE_ROOT, '..', c);
    if (existsSync(p)) return p;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, cwd = DANTEFORGE_ROOT, env = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd, env: { ...process.env, ...env } });
}

function tryRun(cmd, cwd = DANTEFORGE_ROOT, label = '', env = {}) {
  try { run(cmd, cwd, env); return true; }
  catch { console.warn(`  WARN: ${label || cmd} failed — skipping`); return false; }
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const DANTECODE_ROOT = findDir('--dantecode-path', 'DanteCode');
const ENGINE_ROOT = findDir('--engine-path', 'DanteForgeEngine');

if (!DANTECODE_ROOT) {
  console.error('ERROR: DanteCode not found. Pass --dantecode-path=<path> or place it at ../DanteCode');
  process.exit(1);
}

console.log('\n[install-dantecode] DanteForge → DanteCode installation\n');
console.log(`  DanteForge:       ${DANTEFORGE_ROOT}`);
console.log(`  DanteForgeEngine: ${ENGINE_ROOT ?? '(not found — skipping engine step)'}`);
console.log(`  DanteCode:        ${DANTECODE_ROOT}\n`);

// 1. Build DanteForge CLI
console.log('[1/6] Building DanteForge CLI...');
run('npm run build');

// 2. Sync context-economy into DanteForgeEngine and rebuild it
if (ENGINE_ROOT) {
  console.log('\n[2/6] Syncing Context Economy (PRD-26) → DanteForgeEngine...');
  const srcCE = join(DANTEFORGE_ROOT, 'src', 'core', 'context-economy');
  const destCE = join(ENGINE_ROOT, 'src', 'context-economy');
  if (existsSync(srcCE)) {
    copyDir(srcCE, destCE);
    console.log('  Synced context-economy source');
    const requiredCEFiles = [
      'runtime.ts',
      'pretool-adapter.ts',
      'economy-ledger.ts',
      'artifact-compressor.ts',
      'types.ts',
    ];
    const missingCEFiles = requiredCEFiles.filter((file) => !existsSync(join(destCE, file)));
    if (missingCEFiles.length > 0) {
      console.error(`  ERROR: Context Economy sync missing: ${missingCEFiles.join(', ')}`);
      process.exit(1);
    }
  }
  // Ensure token-estimator shim is present
  const shimSrc = join(ENGINE_ROOT, 'src', 'token-estimator.ts');
  if (!existsSync(shimSrc)) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(shimSrc, [
      "export type TokenEstimationStrategy = 'simple' | 'code-aware';",
      'export function estimateTokens(text: string, _strategy?: TokenEstimationStrategy): number {',
      '  return Math.ceil(text.length / 4);',
      '}',
    ].join('\n'));
    console.log('  Added token-estimator shim');
  }

  console.log('\n[3/6] Running sync:dantecode (builds DanteForgeEngine → DanteCode)...');
  run('npm run sync:dantecode', DANTEFORGE_ROOT, {
    DANTEFORGE_ENGINE_ROOT: ENGINE_ROOT,
    DANTECODE_ROOT,
  });
} else {
  console.log('\n[2/6] DanteForgeEngine not found — skipping engine sync');
  console.log('[3/6] Skipped (no engine)');
}

// 4. Build DanteCode VS Code extension
console.log('\n[4/6] Building DanteCode VS Code extension...');
const vscodePkg = join(DANTECODE_ROOT, 'packages', 'vscode');
let vsixBuilt = false;
if (existsSync(vscodePkg)) {
  tryRun('npm run build', vscodePkg, 'vscode extension build');
  const vsixOut = join(DANTECODE_ROOT, 'dantecode.vsix');
  vsixBuilt = tryRun(
    `npx --yes @vscode/vsce package --no-dependencies --out "${vsixOut}"`,
    vscodePkg,
    'vsce package',
  );
  if (vsixBuilt) console.log(`  Packaged: ${vsixOut}`);
} else {
  console.warn('  WARN: packages/vscode not found — skipping extension build');
}

// 5. Install .vsix into VS Code
console.log('\n[5/6] Installing DanteCode extension into VS Code...');
const vsixPath = join(DANTECODE_ROOT, 'dantecode.vsix');
if (existsSync(vsixPath)) {
  const installed = tryRun(`code --install-extension "${vsixPath}" --force`, DANTEFORGE_ROOT, 'code --install-extension');
  if (installed) console.log('  DanteCode extension installed');
  else console.log(`  Manual install: code --install-extension "${vsixPath}"`);
} else {
  console.warn('  WARN: dantecode.vsix not found — skipping VS Code install');
}

// 6. Verify DanteForge CLI still works
console.log('\n[6/6] Verifying DanteForge CLI...');
tryRun('danteforge --version', DANTEFORGE_ROOT, 'danteforge --version');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n[install-dantecode] Done.\n');
console.log('  Reload VS Code window (Ctrl+Shift+P → "Reload Window") to activate DanteCode');
console.log('  danteforge economy     — Context Economy token savings report');
console.log('  danteforge score       — Project quality score');
console.log('');
