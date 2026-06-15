import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER_START = '# ---- danteforge-loc-gate-start ---- do not edit between markers';
const MARKER_END = '# ---- danteforge-loc-gate-end ----';

// CH-024: the documented "Zero Tolerance — Pre-Commit Enforced" Pillar-2 guards live in
// hooks/pre-commit.mjs (the matrix-surface, outcome-evidence, protected-lines, score-write, and
// zero-tolerance integrity guards, plus a typecheck) but were NEVER installed — only the LOC gate was,
// so the entire enforcement was dormant.
// This block chains the full guard script. It is a no-op in consumer repos that don't vendor the script
// ([ -f ] check), and Phase A / typecheck inside it degrade/skip safely (warn-when-absent;
// DANTEFORGE_SKIP_PRECOMMIT_TSC=1) so arming it can never wedge an in-flight loop.
const GUARDS_MARKER_START = '# ---- danteforge-guards-start ---- do not edit between markers';
const GUARDS_MARKER_END = '# ---- danteforge-guards-end ----';
const GUARDS_BLOCK = `${GUARDS_MARKER_START}
if [ -f hooks/pre-commit.mjs ]; then node hooks/pre-commit.mjs || exit 1; fi
${GUARDS_MARKER_END}`;

const LOC_GATE_BLOCK = `${MARKER_START}
node -e "
const {execSync}=require('child_process');
const {readFileSync,existsSync}=require('fs');
const {join}=require('path');
const LOC=750;
const root=process.cwd();
try{
  const staged=execSync('git diff --cached --name-only',{encoding:'utf8'})
    .split('\\n').filter(f=>f&&(f.endsWith('.ts')||f.endsWith('.tsx'))&&!f.includes('/dist/')&&!f.includes('node_modules')&&!f.endsWith('.d.ts'));
  const bad=[];
  for(const f of staged){try{const n=readFileSync(join(root,f),'utf8').split('\\n').length;if(n>LOC)bad.push(f+' ('+n+' lines)');}catch{}}
  if(bad.length){console.error('DanteForge LOC gate: files exceed 750-line hard cap:\\n  '+bad.join('\\n  ')+'\\nSplit: foo.ts -> foo.ts + foo-types.ts + foo-utils.ts');process.exit(1);}
}catch{}
"
${MARKER_END}`;

export interface InstallLocHookResult {
  installed: boolean;
  updated: boolean;
  skipped: boolean;
}

export interface InstallLocHookOpts {
  _exists?: (p: string) => Promise<boolean>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, content: string, mode: number) => Promise<void>;
  _mkdir?: (p: string) => Promise<void>;
}

export async function installLocHook(
  cwd: string,
  opts: InstallLocHookOpts = {},
): Promise<InstallLocHookResult> {
  const existsFn = opts._exists ?? defaultExists;
  const readFileFn = opts._readFile ?? defaultReadFile;
  const writeFileFn = opts._writeFile ?? defaultWriteFile;
  const mkdirFn = opts._mkdir ?? defaultMkdir;

  try {
    const hooksDir = path.join(cwd, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'pre-commit');

    const hookDirExists = await existsFn(hooksDir);
    if (!hookDirExists) {
      return { installed: false, updated: false, skipped: false };
    }

    const hookExists = await existsFn(hookPath);

    if (!hookExists) {
      const content = `#!/bin/sh\n${LOC_GATE_BLOCK}\n${GUARDS_BLOCK}\n`;
      await writeFileFn(hookPath, content, 0o755);
      return { installed: true, updated: false, skipped: false };
    }

    // Ensure BOTH the LOC gate AND the Pillar-2 guards are present — append whichever is missing. A repo
    // that already had only the LOC gate (the dormant-defenses state, CH-024) gets the guards added.
    const existing = await readFileFn(hookPath);
    const hasLoc = existing.includes(MARKER_START);
    const hasGuards = existing.includes(GUARDS_MARKER_START);
    if (hasLoc && hasGuards) {
      return { installed: false, updated: false, skipped: true };
    }
    let body = existing.endsWith('\n') ? existing : `${existing}\n`;
    if (!hasLoc) body += `${LOC_GATE_BLOCK}\n`;
    if (!hasGuards) body += `${GUARDS_BLOCK}\n`;
    await writeFileFn(hookPath, body, 0o755);
    return { installed: false, updated: true, skipped: false };
  } catch {
    return { installed: false, updated: false, skipped: false };
  }
}

async function defaultExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadFile(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

async function defaultWriteFile(p: string, content: string, mode: number): Promise<void> {
  await fs.writeFile(p, content, { encoding: 'utf8', mode });
}

async function defaultMkdir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}
