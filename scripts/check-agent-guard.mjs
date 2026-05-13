#!/usr/bin/env node
/**
 * Tool-agnostic guard for parallel agent work.
 *
 * This catches the failure mode where many agents improve separate dimensions
 * by repeatedly editing the same shared files until they become unreviewable.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DEFAULT_CONFIG = '.danteforge/agent-guard.json';
const DEFAULT_OWNERSHIP = '.danteforge/agent-ownership.json';

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    ownership: DEFAULT_OWNERSHIP,
    workstream: process.env.DANTEFORGE_WORKSTREAM,
    base: undefined,
    staged: false,
    changed: undefined,
    allowFrozen: process.env.DANTEFORGE_ALLOW_FROZEN === '1',
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') args.config = argv[++i];
    else if (arg === '--ownership') args.ownership = argv[++i];
    else if (arg === '--workstream') args.workstream = argv[++i];
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--staged') args.staged = true;
    else if (arg === '--changed') args.changed = argv[++i];
    else if (arg === '--allow-frozen') args.allowFrozen = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`DanteForge agent guard

Usage:
  node scripts/check-agent-guard.mjs
  node scripts/check-agent-guard.mjs --staged --workstream docs
  node scripts/check-agent-guard.mjs --base origin/main --workstream dim-17
  node scripts/check-agent-guard.mjs --changed src/a.ts,docs/b.md

Environment:
  DANTEFORGE_WORKSTREAM=<id>     Applies ownership checks for one workstream
  DANTEFORGE_ALLOW_FROZEN=1      Platform-maintainer escape hatch
`);
}

function readJson(relPath, fallback) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return fallback;
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function normalizePath(file) {
  return file.replace(/\\/g, '/').replace(/^"\s*/, '').replace(/\s*"$/, '');
}

function listChangedFiles(args) {
  if (args.changed) {
    return args.changed.split(',').map(s => normalizePath(s.trim())).filter(Boolean);
  }

  let output = '';
  if (args.staged) {
    output = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
    return output ? output.split(/\r?\n/).map(normalizePath).filter(Boolean) : [];
  }

  if (args.base) {
    output = git(['diff', '--name-only', '--diff-filter=ACMR', args.base]);
    return output ? output.split(/\r?\n/).map(normalizePath).filter(Boolean) : [];
  }

  output = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (!output) return [];

  return output
    .split(/\r?\n/)
    .map(line => line.slice(3).replace(/^.* -> /, ''))
    .map(normalizePath)
    .filter(Boolean);
}

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      out += '.*';
      i++;
    } else if (char === '*') {
      out += '[^/]*';
    } else {
      out += escapeRegex(char);
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(file, patterns = []) {
  return patterns.some(pattern => globToRegex(normalizePath(pattern)).test(file));
}

function listClaimFiles(claimDir) {
  const abs = join(ROOT, claimDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter(name => name !== '.gitkeep')
    .map(name => `${claimDir}/${name}`.replace(/\\/g, '/'));
}

function countLogicalLoc(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return 0;
  const raw = readFileSync(abs, 'utf8');
  let count = 0;
  let inBlock = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      inBlock = !trimmed.includes('*/');
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    count++;
  }
  return count;
}

function shouldCheckSize(file, config) {
  if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) return false;
  return !matchesAny(file, config.size?.ignore ?? []);
}

function checkFrozenFiles(files, config, args, errors) {
  if (args.allowFrozen) return;
  const frozen = config.frozenFiles ?? [];
  for (const file of files) {
    if (matchesAny(file, frozen)) {
      errors.push({
        code: 'FROZEN_FILE_CHANGED',
        file,
        message: `${file} is frozen. Add an extension point or use --allow-frozen for a platform-maintainer change.`,
      });
    }
  }
}

function checkOwnership(files, ownership, args, errors) {
  if (!args.workstream) return;
  const stream = ownership.workstreams?.[args.workstream];
  if (!stream) {
    errors.push({
      code: 'UNKNOWN_WORKSTREAM',
      message: `Unknown workstream "${args.workstream}" in ${args.ownership}.`,
    });
    return;
  }

  const allowed = [
    ...(ownership.globalAllowed ?? []),
    ...(stream.owned ?? []),
    ...(stream.shared ?? []),
  ];

  for (const file of files) {
    if (!matchesAny(file, allowed)) {
      errors.push({
        code: 'OWNERSHIP_VIOLATION',
        file,
        message: `${file} is not owned by workstream "${args.workstream}".`,
      });
    }
  }
}

function checkAtomicGroups(files, config, errors) {
  for (const group of config.atomicGroups ?? []) {
    const matched = group.files.filter(file => files.includes(file));
    if (matched.length > 0 && matched.length !== group.files.length) {
      const missing = group.files.filter(file => !files.includes(file));
      errors.push({
        code: 'ATOMIC_GROUP_PARTIAL',
        group: group.id,
        message: `Atomic group "${group.id}" changed partially. Missing: ${missing.join(', ')}`,
      });
    }
  }
}

function checkClaims(files, config, errors, warnings) {
  const claimDirs = [
    config.claims?.dir ?? '.danteforge/agent-claims',
    '.danteforge/dimension-claims',
  ];
  const changedClaims = files.filter(file =>
    claimDirs.some(claimDir => file.startsWith(`${claimDir}/`) && !file.endsWith('/.gitkeep')),
  );
  for (const file of changedClaims) {
    errors.push({
      code: 'CLAIM_FILE_COMMITTED',
      file,
      message: 'Agent claim files are ephemeral coordination state and must not be committed.',
    });
  }

  const ttlHours = config.claims?.ttlHours ?? 4;
  const now = Date.now();
  for (const claimDir of claimDirs) {
    for (const file of listClaimFiles(claimDir)) {
      const abs = join(ROOT, file);
      const ageHours = (now - statSync(abs).mtimeMs) / 3_600_000;
      if (ageHours > ttlHours) {
        warnings.push({
          code: 'STALE_CLAIM',
          file,
          message: `${file} is older than ${ttlHours} hours and should be removed or refreshed.`,
        });
      }
    }
  }
}

function checkDirectMatrixEdits(files, errors) {
  const matrixChanged = files.includes('.danteforge/compete/matrix.json');
  if (!matrixChanged) return;

  const hasMergeReceipt = files.some(file =>
    file.startsWith('.danteforge/score-proposals/merge-receipts/') && file.endsWith('.json'),
  );
  if (!hasMergeReceipt) {
    errors.push({
      code: 'DIRECT_MATRIX_EDIT',
      file: '.danteforge/compete/matrix.json',
      message: 'Canonical matrix edits must be produced by MatrixDevelopmentEngine and include a merge receipt.',
    });
  }
}

function checkFileSizes(files, config, errors, warnings) {
  const hard = config.size?.hard ?? 750;
  const warn = config.size?.warn ?? 500;
  const allowlist = new Set(config.size?.allowlist ?? []);

  for (const file of files) {
    if (!shouldCheckSize(file, config)) continue;
    const loc = countLogicalLoc(file);
    if (loc > hard && !allowlist.has(file)) {
      errors.push({
        code: 'FILE_TOO_LARGE',
        file,
        message: `${file} has ${loc} logical LOC; hard cap is ${hard}. Split before merging.`,
      });
    } else if (allowlist.has(file)) {
      warnings.push({
        code: 'TOUCHED_LEGACY_FILE',
        file,
        message: `${file} is allowlisted legacy code at ${loc} logical LOC. Keep changes minimal and plan a split.`,
      });
    } else if (loc > warn) {
      warnings.push({
        code: 'FILE_SIZE_WARNING',
        file,
        message: `${file} has ${loc} logical LOC; preferred cap is ${warn}. Plan a split.`,
      });
    }
  }
}

function formatResult(result, json) {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;

  const lines = [
    '',
    `DanteForge agent guard -- ${result.changedFiles.length} changed file(s) checked`,
  ];

  if (result.warnings.length) {
    lines.push('', `Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) lines.push(`  WARN ${warning.code}: ${warning.message}`);
  }

  if (result.errors.length) {
    lines.push('', `Errors (${result.errors.length}):`);
    for (const error of result.errors) lines.push(`  FAIL ${error.code}: ${error.message}`);
    lines.push('', 'FAIL -- fix ownership, frozen-file, atomicity, or LOC violations before merge.');
  } else {
    lines.push('', 'PASS -- no agent coordination violations detected.');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readJson(args.config, {});
  const ownership = readJson(args.ownership, {});
  const changedFiles = [...new Set(listChangedFiles(args))].sort();
  const errors = [];
  const warnings = [];

  checkFrozenFiles(changedFiles, config, args, errors);
  checkOwnership(changedFiles, ownership, args, errors);
  checkAtomicGroups(changedFiles, config, errors);
  checkClaims(changedFiles, config, errors, warnings);
  checkDirectMatrixEdits(changedFiles, errors);
  checkFileSizes(changedFiles, config, errors, warnings);

  const result = { changedFiles, errors, warnings };
  process.stdout.write(formatResult(result, args.json));
  process.exit(errors.length > 0 ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error(`agent guard failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
