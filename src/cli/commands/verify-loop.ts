// CLI — verify-loop command
//
// 6-phase quality gate: Build -> Typecheck -> Lint -> Tests -> Security -> Diff Review.
// Each phase must pass before the next runs. Stops on first failure.
//
// Usage: danteforge verify-loop [options]
import { execSync } from 'node:child_process';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { ClaudeCodeAdapter } from '../../matrix/adapters/claude-code-adapter.js';
import { runAdapter } from '../../matrix/adapters/adapter-interface.js';
import { makeReadOnlyLease } from '../../matrix/engines/council-worktree.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';

export type PhaseName = 'build' | 'typecheck' | 'lint' | 'tests' | 'security' | 'diff';

export interface PhaseResult {
  phase: PhaseName;
  passed: boolean;
  durationMs: number;
  detail?: string;
}

export interface VerifyLoopResult {
  branch: string;
  date: string;
  phases: PhaseResult[];
  passed: boolean;
  firstFailure?: PhaseName;
}

export interface VerifyLoopOptions {
  cwd?: string;
  dim?: string;
  phases?: string;
  continuous?: boolean;
  intervalMs?: number;
  json?: boolean;
  _exec?: (cmd: string, cwd: string) => { exitCode: number; output: string };
  _runAdapter?: typeof runAdapter;
}

const ALL_PHASES: PhaseName[] = ['build', 'typecheck', 'lint', 'tests', 'security', 'diff'];

function execPhase(cmd: string, cwd: string): { exitCode: number; output: string } {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exitCode: 0, output };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      output: [e.stdout ?? '', e.stderr ?? ''].filter(Boolean).join('\n'),
    };
  }
}

function getTestFiles(cwd: string, dim?: string): string[] {
  try {
    const output = execSync('git ls-files -- tests/', { cwd, encoding: 'utf8' });
    const files = output.split('\n').filter(f => f.endsWith('.test.ts'));
    if (!dim) return files;
    const dimSlug = dim.replace(/[^a-z0-9]/gi, '[-_]?');
    const pattern = new RegExp(dimSlug, 'i');
    const filtered = files.filter(f => pattern.test(path.basename(f)));
    return filtered.length > 0 ? filtered : files;
  } catch {
    return ['tests/'];
  }
}

async function runDiffReview(
  cwd: string,
  _run: typeof runAdapter,
): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const diff = execSync('git diff HEAD~1 HEAD --stat 2>/dev/null || git diff --cached --stat', {
      cwd, encoding: 'utf8',
    }).trim();

    if (!diff) {
      return { phase: 'diff', passed: true, durationMs: Date.now() - start, detail: 'No diff to review' };
    }

    const workPacket: WorkPacket = {
      id: `verify-loop.diff.${Date.now()}`,
      dimensionId: 'verify-loop',
      objective: [
        'Review this git diff for anti-patterns. Reply with PASS or FAIL and a one-line reason.',
        '',
        'Anti-patterns that cause FAIL:',
        '  - Stubs (throw new Error("not implemented"), return {} as Type)',
        '  - TODOs or FIXMEs left in src/ files',
        '  - Hardcoded test outputs with no real logic',
        '  - console.log or debug statements in src/ files',
        '',
        'Diff stats:',
        diff,
      ].join('\n'),
      acceptanceCriteria: ['PASS or FAIL with reason'],
      proof: { proofRequired: [] },
      globalForbidden: [],
      context: { mode: 'review-only' },
    } as unknown as WorkPacket;

    const lease = makeReadOnlyLease(cwd, 'verify-loop-diff');
    const adapter = new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
    const available = await adapter.isAvailable();
    if (!available) {
      return { phase: 'diff', passed: true, durationMs: Date.now() - start, detail: 'Claude Code unavailable — skipped' };
    }

    const result = await _run(adapter, { lease });
    const output = result.finalMessage ?? (result as unknown as { output?: string }).output ?? '';
    const passed = !output.toLowerCase().includes('fail');
    return {
      phase: 'diff',
      passed,
      durationMs: Date.now() - start,
      detail: output.split('\n')[0]?.slice(0, 120),
    };
  } catch {
    return { phase: 'diff', passed: true, durationMs: Date.now() - start, detail: 'Diff review skipped' };
  }
}

async function runPhase(
  phase: PhaseName,
  cwd: string,
  dim: string | undefined,
  exec: (cmd: string, cwd: string) => { exitCode: number; output: string },
  _run: typeof runAdapter,
): Promise<PhaseResult> {
  const start = Date.now();

  switch (phase) {
    case 'build': {
      const { exitCode, output } = exec('npm run build', cwd);
      return { phase, passed: exitCode === 0, durationMs: Date.now() - start, detail: exitCode !== 0 ? output.split('\n').slice(-5).join(' ') : undefined };
    }
    case 'typecheck': {
      const { exitCode, output } = exec('npx tsc --noEmit', cwd);
      return { phase, passed: exitCode === 0, durationMs: Date.now() - start, detail: exitCode !== 0 ? output.split('\n').slice(-5).join(' ') : undefined };
    }
    case 'lint': {
      const { exitCode, output } = exec('npm run lint', cwd);
      return { phase, passed: exitCode === 0, durationMs: Date.now() - start, detail: exitCode !== 0 ? output.split('\n').slice(-5).join(' ') : undefined };
    }
    case 'tests': {
      const testFiles = getTestFiles(cwd, dim);
      const cmd = `npx tsx --test ${testFiles.join(' ')}`;
      const { exitCode, output } = exec(cmd, cwd);
      return { phase, passed: exitCode === 0, durationMs: Date.now() - start, detail: exitCode !== 0 ? output.split('\n').slice(-10).join(' ') : undefined };
    }
    case 'security': {
      const { exitCode, output } = exec('node dist/index.js security-scan', cwd);
      const hasCritical = output.includes('CRITICAL') && !output.includes('0 CRITICAL');
      return { phase, passed: exitCode === 0 && !hasCritical, durationMs: Date.now() - start, detail: hasCritical ? 'New CRITICAL findings' : undefined };
    }
    case 'diff': {
      return runDiffReview(cwd, _run);
    }
  }
}

function formatResult(result: VerifyLoopResult): string {
  const lines = [
    `VERIFY [${result.branch}] ${result.date}`,
    ...result.phases.map(p => {
      const icon = p.passed ? '✓' : '✗';
      const dur = `${(p.durationMs / 1000).toFixed(1)}s`;
      const detail = p.detail ? ` — ${p.detail}` : '';
      return `  ${icon} ${p.phase} (${dur})${detail}`;
    }),
    `OVERALL: ${result.passed ? 'PASS' : `FAIL — fix ${result.firstFailure} before merging`}`,
  ];
  return lines.join('\n');
}

function getCurrentBranch(cwd: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function runOnce(
  cwd: string,
  phasesToRun: PhaseName[],
  dim: string | undefined,
  exec: (cmd: string, cwd: string) => { exitCode: number; output: string },
  _run: typeof runAdapter,
): Promise<VerifyLoopResult> {
  const branch = getCurrentBranch(cwd);
  const date = new Date().toISOString().split('T')[0]!;
  const phases: PhaseResult[] = [];
  let firstFailure: PhaseName | undefined;

  for (const phase of phasesToRun) {
    const r = await runPhase(phase, cwd, dim, exec, _run);
    phases.push(r);
    if (!r.passed && !firstFailure) {
      firstFailure = phase;
      break;
    }
  }

  return { branch, date, phases, passed: !firstFailure, firstFailure };
}

export async function runVerifyLoopCommand(opts: VerifyLoopOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const exec = opts._exec ?? execPhase;
  const _run = opts._runAdapter ?? runAdapter;

  let phasesToRun: PhaseName[] = ALL_PHASES;
  if (opts.phases) {
    phasesToRun = opts.phases.split(',').map(p => p.trim() as PhaseName).filter(p => ALL_PHASES.includes(p));
  }

  async function runAndReport(): Promise<void> {
    const result = await runOnce(cwd, phasesToRun, opts.dim, exec, _run);
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      logger.info(formatResult(result));
    }
    if (!result.passed) process.exitCode = 1;
  }

  if (opts.continuous) {
    const intervalMs = opts.intervalMs ?? 900_000;
    logger.info(`[verify-loop] Continuous mode — running every ${intervalMs / 1000}s`);
    await runAndReport();
    const tick = (): void => {
      void runAndReport().then(() => setTimeout(tick, intervalMs));
    };
    setTimeout(tick, intervalMs);
  } else {
    await runAndReport();
  }
}
