import fs from 'fs/promises';
import path from 'path';

export interface StrictDimensions {
  autonomy: number;
  selfImprovement: number;
  tokenEconomy: number;
  specDrivenPipeline: number;
  developerExperience: number;
  planningQuality: number;
  convergenceSelfHealing: number;
}

type GitLogFn = (args: string[], cwd: string) => Promise<string>;
type ExistsFn = (p: string) => Promise<boolean>;
type ListDirFn = (p: string) => Promise<string[]>;

export async function makeFileChecker(
  cwd: string,
  checkExists: ExistsFn,
  listDir: ListDirFn,
): Promise<(filename: string) => Promise<boolean>> {
  const monorepoFiles = await listDir(path.join(cwd, 'packages'));
  return async (filename: string): Promise<boolean> => {
    if (await checkExists(path.join(cwd, 'src', 'core', filename))) return true;
    for (const pkg of monorepoFiles) {
      if (await checkExists(path.join(cwd, 'packages', pkg, 'src', filename))) return true;
    }
    return false;
  };
}

async function strictAutonomy(cwd: string, runGit: GitLogFn, checkExists: ExistsFn, listDir: ListDirFn): Promise<number> {
  let score = 20;
  const commitLog = await runGit(['log', '--oneline', '--no-merges'], cwd);
  const commitCount = commitLog.trim() === '' ? 0 : commitLog.trim().split('\n').length;
  if (commitCount >= 100) score += 30; else if (commitCount >= 30) score += 20; else if (commitCount >= 10) score += 10; else if (commitCount >= 1) score += 5;
  const verifyFiles = await listDir(path.join(cwd, '.danteforge', 'evidence', 'verify'));
  if (verifyFiles.length >= 5) score += 25; else if (verifyFiles.length >= 2) score += 15; else if (verifyFiles.length >= 1) score += 8;
  if (await checkExists(path.join(cwd, '.danteforge', 'evidence', 'autoforge'))) score += 15;
  if (await checkExists(path.join(cwd, '.danteforge', 'evidence', 'oss-harvest.json'))) score += 10;
  return Math.max(0, Math.min(100, score));
}

async function strictSelfImprovement(cwd: string, runGit: GitLogFn, checkExists: ExistsFn, listDir: ListDirFn): Promise<number> {
  let score = 20;
  const retroCount = (await runGit(['log', '--oneline', '--grep=retro', '--no-merges'], cwd)).trim().split('\n').filter(Boolean).length;
  if (retroCount >= 10) score += 25; else if (retroCount >= 3) score += 15; else if (retroCount >= 1) score += 8;
  const lessonCount = (await runGit(['log', '--oneline', '--grep=lesson', '--no-merges'], cwd)).trim().split('\n').filter(Boolean).length;
  if (lessonCount >= 10) score += 20; else if (lessonCount >= 3) score += 12; else if (lessonCount >= 1) score += 5;
  const retroFiles = await listDir(path.join(cwd, '.danteforge', 'evidence', 'retro'));
  if (retroFiles.length >= 5) score += 20; else if (retroFiles.length >= 2) score += 12; else if (retroFiles.length >= 1) score += 6;
  if (await checkExists(path.join(cwd, '.danteforge', 'lessons.md'))) score += 15;
  const retrosOutputFiles = await listDir(path.join(cwd, '.danteforge', 'retros'));
  if (retrosOutputFiles.length >= 10) score += 15; else if (retrosOutputFiles.length >= 3) score += 8; else if (retrosOutputFiles.length >= 1) score += 3;
  return Math.max(0, Math.min(100, score));
}

async function strictTokenEconomy(cwd: string, checkExists: ExistsFn, listDir: ListDirFn): Promise<number> {
  const hasFile = await makeFileChecker(cwd, checkExists, listDir);
  let score = 20;
  if (await hasFile('task-router.ts') || await hasFile('task-complexity-router.ts')) score += 20;
  if (await hasFile('circuit-breaker.ts')) score += 15;
  const cacheFiles = await listDir(path.join(cwd, '.danteforge', 'cache'));
  if (cacheFiles.length >= 50) score += 30; else if (cacheFiles.length >= 10) score += 20; else if (cacheFiles.length >= 1) score += 10;
  if (await hasFile('context-compressor.ts') || await hasFile('context-compactor.ts') || await hasFile('transcript-compaction.ts')) score += 15;
  return Math.max(0, Math.min(100, score));
}

async function strictSpecDrivenPipeline(cwd: string, checkExists: ExistsFn, listDir: ListDirFn): Promise<number> {
  let score = 10;
  for (const artifact of ['CONSTITUTION.md', 'SPEC.md', 'PLAN.md', 'TASKS.md']) {
    if (await checkExists(path.join(cwd, artifact)) || await checkExists(path.join(cwd, '.danteforge', artifact))) score += 15;
  }
  const evidenceFiles = await listDir(path.join(cwd, '.danteforge', 'evidence'));
  if (evidenceFiles.length >= 1) score += 10;
  const testFiles = await listDir(path.join(cwd, 'tests'));
  if (testFiles.some(f => f.includes('e2e') || f.includes('integration'))) score += 5;
  // Bonus: spec template library shows mature spec-driven discipline
  const specTemplates = await listDir(path.join(cwd, 'src', 'harvested', 'spec'));
  if (specTemplates.length >= 1) score += 5;
  // Bonus: spec-to-ship workflow command exists
  if (await checkExists(path.join(cwd, 'commands', 'spec-to-ship.md'))) score += 5;
  return Math.max(0, Math.min(100, score));
}

async function strictDeveloperExperience(cwd: string, checkExists: ExistsFn, listDir: ListDirFn): Promise<number> {
  let score = 15;
  if (await checkExists(path.join(cwd, 'CLAUDE.md'))) score += 20;
  const readmeContent = await fs.readFile(path.join(cwd, 'README.md'), 'utf8').catch(() => '');
  if (readmeContent.length > 500) score += 15;
  const examplesFiles = await listDir(path.join(cwd, 'examples'));
  if (examplesFiles.length >= 1) score += 20;
  const testFiles = await listDir(path.join(cwd, 'tests'));
  if (testFiles.length >= 100) score += 15; else if (testFiles.length >= 50) score += 10; else if (testFiles.length >= 10) score += 5;
  // Bonus: agent-instruction file shows multi-tool DX investment
  if (await checkExists(path.join(cwd, 'AGENTS.md'))) score += 8;
  // Bonus: hook system in place for session-level DX automation
  const hooksFiles = await listDir(path.join(cwd, 'hooks'));
  if (hooksFiles.length >= 2) score += 7;
  return Math.max(0, Math.min(100, score));
}

async function strictPlanningQuality(cwd: string, runGit: GitLogFn, checkExists: ExistsFn): Promise<number> {
  let score = 15;
  for (const [artifact, pts] of [['PLAN.md', 20], ['SPEC.md', 15], ['CONSTITUTION.md', 15], ['CLARIFY.md', 15]] as [string, number][]) {
    if (await checkExists(path.join(cwd, artifact)) || await checkExists(path.join(cwd, '.danteforge', artifact))) score += pts;
  }
  const planCount = (await runGit(['log', '--oneline', '--grep=plan', '--no-merges'], cwd)).trim().split('\n').filter(Boolean).length;
  if (planCount >= 3) score += 10;
  const specCount = (await runGit(['log', '--oneline', '--grep=spec', '--no-merges'], cwd)).trim().split('\n').filter(Boolean).length;
  if (specCount >= 3) score += 10;
  return Math.max(0, Math.min(100, score));
}

async function strictConvergenceSelfHealing(cwd: string, checkExists: ExistsFn, listDir: ListDirFn): Promise<number> {
  const hasFile = await makeFileChecker(cwd, checkExists, listDir);
  let score = 15;
  if (await hasFile('circuit-breaker.ts') || await hasFile('task-circuit-breaker.ts')) score += 25;
  if (await hasFile('context-compressor.ts') || await hasFile('context-compactor.ts') || await hasFile('transcript-compaction.ts')) score += 20;
  const autoforgeFiles = await listDir(path.join(cwd, '.danteforge', 'evidence', 'autoforge'));
  if (autoforgeFiles.length >= 3) score += 15; else if (autoforgeFiles.length >= 1) score += 8;
  const convergenceProof = await checkExists(path.join(cwd, '.danteforge', 'evidence', 'convergence-proof.json'))
    || await checkExists(path.join(cwd, 'examples', 'todo-app', 'evidence', 'convergence-proof.json'));
  if (convergenceProof) score += 10;
  if (await hasFile('ascend-engine.ts') || await hasFile('loop-detector.ts') || await hasFile('recovery-engine.ts')) score += 10;
  return Math.max(0, Math.min(100, score));
}

export async function computeStrictDimensions(
  cwd: string,
  gitLogFn?: GitLogFn,
  existsFn?: ExistsFn,
  listDirFn?: ListDirFn,
): Promise<StrictDimensions> {
  const runGit: GitLogFn = gitLogFn ?? (async (args, dir) => {
    const { execSync } = await import('node:child_process');
    try { return execSync(`git ${args.join(' ')}`, { encoding: 'utf8', cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return ''; }
  });
  const checkExists: ExistsFn = existsFn ?? (async (p) => { try { await fs.access(p); return true; } catch { return false; } });
  const listDir: ListDirFn = listDirFn ?? (async (p) => { try { return await fs.readdir(p); } catch { return []; } });

  const [autonomy, selfImprovement, tokenEconomy, specDrivenPipeline, developerExperience, planningQuality, convergenceSelfHealing] = await Promise.all([
    strictAutonomy(cwd, runGit, checkExists, listDir),
    strictSelfImprovement(cwd, runGit, checkExists, listDir),
    strictTokenEconomy(cwd, checkExists, listDir),
    strictSpecDrivenPipeline(cwd, checkExists, listDir),
    strictDeveloperExperience(cwd, checkExists, listDir),
    strictPlanningQuality(cwd, runGit, checkExists),
    strictConvergenceSelfHealing(cwd, checkExists, listDir),
  ]);

  return { autonomy, selfImprovement, tokenEconomy, specDrivenPipeline, developerExperience, planningQuality, convergenceSelfHealing };
}
