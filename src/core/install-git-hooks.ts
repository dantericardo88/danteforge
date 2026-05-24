import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER_START = '# ---- danteforge-loc-gate-start ---- do not edit between markers';
const MARKER_END = '# ---- danteforge-loc-gate-end ----';

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
      const content = `#!/bin/sh\n${LOC_GATE_BLOCK}\n`;
      await writeFileFn(hookPath, content, 0o755);
      return { installed: true, updated: false, skipped: false };
    }

    const existing = await readFileFn(hookPath);
    if (existing.includes(MARKER_START)) {
      return { installed: false, updated: false, skipped: true };
    }

    const appended = existing.endsWith('\n')
      ? `${existing}${LOC_GATE_BLOCK}\n`
      : `${existing}\n${LOC_GATE_BLOCK}\n`;
    await writeFileFn(hookPath, appended, 0o755);
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
