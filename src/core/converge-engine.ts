import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import type {
  ConvergeOptions,
  ConvergeResult,
  ConvergeScoreSnapshot,
  ConvCycleRecord,
  ConvDimState,
  ConvProgressFile,
} from './converge-engine-types.js';
import type { ScoringDimension } from './harsh-scorer.js';


const PROGRESS_FILE = '.danteforge/converge-progress.json';

async function defaultComputeScore(cwd: string): Promise<ConvergeScoreSnapshot> {
  const { computeHarshScore } = await import('./harsh-scorer.js');
  const result = await computeHarshScore({
    cwd,
    _readHistory: async () => [],
    _writeHistory: async () => {},
  });
  return {
    displayScore: result.displayScore,
    displayDimensions: result.displayDimensions as Record<string, number>,
  };
}

async function defaultRunForge(goal: string, cwd: string): Promise<{ success: boolean }> {
  try {
    const { executeAutoforgeCommand } = await import('./autoforge-executor.js');
    await executeAutoforgeCommand(`forge "${goal}"`, cwd);
    return { success: true };
  } catch (err) {
    logger.warn(`[Converge] forge wave failed: ${String(err)}`);
    return { success: false };
  }
}

async function defaultRunParty(dim: string, cwd: string): Promise<{ success: boolean }> {
  try {
    const { executeAutoforgeCommand } = await import('./autoforge-executor.js');
    await executeAutoforgeCommand(`party "escalate: ${dim}"`, cwd);
    return { success: true };
  } catch (err) {
    logger.warn(`[Converge] party escalation failed for ${dim}: ${String(err)}`);
    return { success: false };
  }
}

async function writeProgress(cwd: string, data: ConvProgressFile): Promise<void> {
  try {
    const filePath = path.join(cwd, PROGRESS_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

function buildDimTable(
  scores: Record<string, number>,
  dims: ScoringDimension[],
  target: number,
  stdout: (line: string) => void,
): void {
  stdout('  Dimension                Score  Status');
  stdout('  ─────────────────────────────────────');
  for (const dim of dims) {
    const score = scores[dim] ?? 0;
    const status = score >= target ? '✓' : '✗';
    const label = dim.padEnd(28);
    stdout(`  ${status} ${label} ${score.toFixed(1)}`);
  }
}

function pickDims(opts: ConvergeOptions): ScoringDimension[] {
  if (opts.dims && opts.dims.length > 0) return opts.dims;
  // Return all 20 scoring dimensions
  return [
    'functionality', 'testing', 'errorHandling', 'security',
    'uxPolish', 'documentation', 'performance', 'maintainability',
    'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
    'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
    'contextEconomy', 'ecosystemMcp', 'enterpriseReadiness',
    'communityAdoption', 'causalCoherence',
  ] as ScoringDimension[];
}

export async function runConverge(opts: ConvergeOptions = {}): Promise<ConvergeResult> {
  const cwd = opts.cwd ?? process.cwd();
  const target = opts.target ?? 9.0;
  const maxCycles = opts.maxCycles ?? 200;
  const escalateAfter = opts.escalateAfter ?? 3;
  const dims = pickDims(opts);
  const computeScore = opts._computeScore ?? defaultComputeScore;
  const runForge = opts._runForge ?? defaultRunForge;
  const runParty = opts._runParty ?? defaultRunParty;
  const stdout = opts._stdout ?? ((line: string) => process.stdout.write(line + '\n'));

  const dimState = new Map<string, ConvDimState>(
    dims.map(id => [id, { id, stuckCount: 0, lastScore: 0 }]),
  );

  const progressData: ConvProgressFile = {
    target,
    maxCycles,
    cyclesRun: 0,
    lastCycle: null,
    history: [],
  };

  let cyclesRun = 0;

  if (opts.checkOnly) {
    stdout(`[Converge] check-only — reading scores (target: ${target})`);
    const snap = await computeScore(cwd);
    const failing = dims.filter(d => (snap.displayDimensions[d] ?? 0) < target);
    const passing = dims.filter(d => (snap.displayDimensions[d] ?? 0) >= target);
    buildDimTable(snap.displayDimensions, dims, target, stdout);
    if (failing.length === 0) {
      stdout(`\n[Converge] PASS — all ${dims.length} dimensions >= ${target}`);
      return { cyclesRun: 0, dimsAtTarget: passing, dimsFailing: [], finalScores: snap.displayDimensions, success: true, exitCode: 0 };
    }
    stdout(`\n[Converge] FAIL — ${failing.length} dimension(s) below ${target}: ${failing.join(', ')}`);
    return { cyclesRun: 0, dimsAtTarget: passing, dimsFailing: failing, finalScores: snap.displayDimensions, success: false, exitCode: 1 };
  }

  stdout(`[Converge] Starting convergence loop — target: ${target}, maxCycles: ${maxCycles}, dims: ${dims.length}`);

  while (cyclesRun < maxCycles) {
    stdout(`\n[Converge] Cycle ${cyclesRun + 1}/${maxCycles} — measuring...`);

    const snap = await computeScore(cwd);
    const failing = dims.filter(d => (snap.displayDimensions[d] ?? 0) < target);
    const passing = dims.filter(d => (snap.displayDimensions[d] ?? 0) >= target);

    buildDimTable(snap.displayDimensions, dims, target, stdout);

    if (failing.length === 0) {
      stdout(`\n[Converge] SUCCESS — all ${dims.length} dimensions >= ${target} after ${cyclesRun} cycles`);
      const record: ConvCycleRecord = {
        cycle: cyclesRun + 1,
        scores: snap.displayDimensions,
        overallScore: snap.displayScore,
        dimsAtTarget: passing,
        dimsFailing: [],
        action: 'pass',
        worstDim: null,
        timestamp: new Date().toISOString(),
      };
      progressData.cyclesRun = cyclesRun;
      progressData.lastCycle = record;
      progressData.history.push(record);
      await writeProgress(cwd, progressData);
      return { cyclesRun, dimsAtTarget: passing, dimsFailing: [], finalScores: snap.displayDimensions, success: true, exitCode: 0 };
    }

    // Update stuck counts
    for (const dim of dims) {
      const st = dimState.get(dim)!;
      const score = snap.displayDimensions[dim] ?? 0;
      if (score <= st.lastScore + 0.05) {
        st.stuckCount++;
      } else {
        st.stuckCount = 0;
      }
      st.lastScore = score;
    }

    // Pick worst failing dim (lowest score)
    const worstDim = failing.reduce<string>((worst, d) => {
      const ws = snap.displayDimensions[worst] ?? 0;
      const ds = snap.displayDimensions[d] ?? 0;
      return ds < ws ? d : worst;
    }, failing[0]!);

    const st = dimState.get(worstDim)!;
    let action: 'forge' | 'party';

    if (st.stuckCount >= escalateAfter) {
      stdout(`[Converge] Cycle ${cyclesRun + 1}: ${worstDim} stuck at ${(snap.displayDimensions[worstDim] ?? 0).toFixed(1)} for ${st.stuckCount} cycles — escalating to party mode`);
      action = 'party';
      await runParty(worstDim, cwd);
      st.stuckCount = 0;
    } else {
      stdout(`[Converge] Cycle ${cyclesRun + 1}: targeting ${worstDim} (${(snap.displayDimensions[worstDim] ?? 0).toFixed(1)} < ${target})`);
      action = 'forge';
      await runForge(`improve ${worstDim} dimension toward ${target}`, cwd);
    }

    const record: ConvCycleRecord = {
      cycle: cyclesRun + 1,
      scores: snap.displayDimensions,
      overallScore: snap.displayScore,
      dimsAtTarget: passing,
      dimsFailing: failing,
      action,
      worstDim,
      timestamp: new Date().toISOString(),
    };

    progressData.cyclesRun = cyclesRun + 1;
    progressData.lastCycle = record;
    progressData.history.push(record);
    await writeProgress(cwd, progressData);

    cyclesRun++;
  }

  // maxCycles exhausted
  const finalSnap = await computeScore(cwd);
  const finalFailing = dims.filter(d => (finalSnap.displayDimensions[d] ?? 0) < target);
  const finalPassing = dims.filter(d => (finalSnap.displayDimensions[d] ?? 0) >= target);

  stdout(`\n[Converge] maxCycles (${maxCycles}) reached. ${finalFailing.length} dimension(s) still below target: ${finalFailing.join(', ')}`);

  return {
    cyclesRun,
    dimsAtTarget: finalPassing,
    dimsFailing: finalFailing,
    finalScores: finalSnap.displayDimensions,
    success: false,
    exitCode: 1,
  };
}
