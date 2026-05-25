// council.ts — Multi-LLM council orchestration.
//
// Enforces "the one who builds is never the one who judges" structurally.
// Discovers available council members, assigns builder + judge roles
// (builder is excluded from the judge pool), dispatches in parallel where
// possible, collects verdicts, and advances scores only on consensus.
//
// See commands/council.md for the canonical protocol.

import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../../matrix/adapters/codex-adapter.js';
import { GeminiCLIAdapter } from '../../matrix/adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../../matrix/adapters/grok-build-adapter.js';
import { ClaudeCodeAdapter } from '../../matrix/adapters/claude-code-adapter.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';
import type { AgentRunResult } from '../../matrix/types/agent.js';
import { runAdapter } from '../../matrix/adapters/adapter-interface.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CouncilMemberId = 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code';

export interface CouncilMember {
  id: CouncilMemberId;
  label: string;
  available: boolean;
}

export interface JudgeVerdict {
  memberId: CouncilMemberId;
  verdict: 'PASS' | 'FAIL' | 'UNCLEAR';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  scoreSuggestion: number | null;
  reason: string;
  blockingIssues: string[];
  rawOutput: string;
}

export interface CouncilCycleResult {
  builderId: CouncilMemberId;
  judgeIds: CouncilMemberId[];
  buildResult: AgentRunResult;
  verdicts: JudgeVerdict[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
  scoreSuggested: number | null;
  filesChanged: string[];
}

export interface RunCouncilOptions {
  cwd?: string;
  goal: string;
  builderPref?: CouncilMemberId;
  targetDims?: number;
  loop?: boolean;
  maxCycles?: number;
  json?: boolean;
  /** Injection seam for tests. */
  _discover?: () => Promise<CouncilMember[]>;
}

// ── Work packet / lease factory ───────────────────────────────────────────────

function makeWorkPacket(goal: string, cwd: string): WorkPacket {
  return {
    id: `council.${Date.now()}`,
    dimensionId: 'council-task',
    objective: goal,
    acceptanceCriteria: [
      'Implement the requested changes with no stubs or mocks in src/ files.',
      'All modified files must pass TypeScript typecheck.',
      'Tests must exercise real code, not mocked internals.',
    ],
    proof: {
      proofRequired: [
        'git diff shows meaningful changes',
        'no jest.mock / vi.mock / sinon in src/',
      ],
    },
    globalForbidden: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
    ],
    context: { goal, cwd },
  } as unknown as WorkPacket;
}

function makeLease(cwd: string): AgentLease {
  return {
    id: `council-lease.${Date.now()}`,
    worktreePath: cwd,
    allowedWritePaths: ['src/**', 'tests/**', 'commands/**', 'scripts/**', '*.md', '*.json'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
      'node_modules/**',
      'dist/**',
    ],
  } as unknown as AgentLease;
}

// ── Council discovery ─────────────────────────────────────────────────────────

export async function discoverCouncil(): Promise<CouncilMember[]> {
  const dummy = makeWorkPacket('probe', process.cwd());

  const probes: Array<{ id: CouncilMemberId; label: string; adapter: { isAvailable(): Promise<boolean> } }> = [
    { id: 'codex', label: 'Codex (OpenAI subscription)', adapter: new CodexAdapter({ workPacket: dummy }) },
    { id: 'gemini-cli', label: 'Gemini CLI (Google subscription)', adapter: new GeminiCLIAdapter({ workPacket: dummy }) },
    { id: 'grok-build', label: 'Grok Build (~/.grok/bin/grok.exe)', adapter: new GrokBuildAdapter({ workPacket: dummy }) },
    { id: 'claude-code', label: 'Claude Code (claude binary)', adapter: new ClaudeCodeAdapter({ workPacket: dummy }) },
  ];

  const results: CouncilMember[] = [];
  await Promise.all(probes.map(async p => {
    const available = await p.adapter.isAvailable().catch(() => false);
    results.push({ id: p.id, label: p.label, available });
  }));
  return results;
}

// ── Role assignment ───────────────────────────────────────────────────────────

function assignRoles(
  members: CouncilMember[],
  builderPref?: CouncilMemberId,
): { builder: CouncilMemberId; judges: CouncilMemberId[] } | null {
  const available = members.filter(m => m.available).map(m => m.id);
  if (available.length < 2) return null;

  // Builder preference: use pref if available, else pick first
  const builder = (builderPref && available.includes(builderPref))
    ? builderPref
    : available[0]!;

  // Judges: everyone else (never the builder)
  const judges = available.filter(id => id !== builder);
  return { builder, judges };
}

// ── Adapter factories ─────────────────────────────────────────────────────────

function makeAdapter(id: CouncilMemberId, workPacket: WorkPacket, judgeMode = false) {
  switch (id) {
    case 'codex': return new CodexAdapter({ workPacket });
    case 'gemini-cli': return new GeminiCLIAdapter({ workPacket, judgeMode });
    case 'grok-build': return new GrokBuildAdapter({ workPacket, judgeMode });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket });
  }
}

// ── Verdict parsing ───────────────────────────────────────────────────────────

export function parseVerdict(memberId: CouncilMemberId, rawOutput: string): JudgeVerdict {
  const upper = rawOutput.toUpperCase();
  const verdict: 'PASS' | 'FAIL' | 'UNCLEAR' =
    upper.includes('VERDICT: PASS') ? 'PASS' :
    upper.includes('VERDICT: FAIL') ? 'FAIL' : 'UNCLEAR';

  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
    upper.includes('CONFIDENCE: HIGH') ? 'HIGH' :
    upper.includes('CONFIDENCE: MEDIUM') ? 'MEDIUM' : 'LOW';

  const scoreMatch = rawOutput.match(/SCORE_SUGGESTION:\s*([\d.]+)/i);
  const scoreSuggestion = scoreMatch ? parseFloat(scoreMatch[1]!) : null;

  const reasonMatch = rawOutput.match(/REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const reason = reasonMatch ? reasonMatch[1]!.trim() : rawOutput.slice(0, 200);

  const blockingMatch = rawOutput.match(/BLOCKING_ISSUES:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const blockingRaw = blockingMatch ? blockingMatch[1]!.trim() : '';
  const blockingIssues = blockingRaw === 'none' || blockingRaw === '' ? [] :
    blockingRaw.split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean);

  return { memberId, verdict, confidence, scoreSuggestion, reason, blockingIssues, rawOutput };
}

function resolveConsensus(verdicts: JudgeVerdict[]): 'PASS' | 'FAIL' | 'SPLIT' {
  if (verdicts.length === 0) return 'FAIL';
  const passes = verdicts.filter(v => v.verdict === 'PASS').length;
  const fails = verdicts.filter(v => v.verdict === 'FAIL').length;
  if (passes > fails) return 'PASS';
  if (fails > passes) return 'FAIL';
  return 'SPLIT';
}

// ── One full council cycle ────────────────────────────────────────────────────

export async function runCouncilCycle(
  goal: string,
  roles: { builder: CouncilMemberId; judges: CouncilMemberId[] },
  cwd: string,
): Promise<CouncilCycleResult> {
  const workPacket = makeWorkPacket(goal, cwd);
  const lease = makeLease(cwd);

  // Build phase
  logger.info(chalk.cyan(`  [council] Builder: ${chalk.bold(roles.builder)}`));
  const builderAdapter = makeAdapter(roles.builder, workPacket, false);
  const buildResult = await runAdapter(builderAdapter, { lease, cwd });
  logger.info(chalk.dim(`  [council] Build complete: ${buildResult.filesChanged.length} file(s) changed, status=${buildResult.status}`));

  if (buildResult.status === 'failed') {
    logger.warn(`  [council] Builder failed: ${buildResult.errorReason}`);
  }

  // Judge phase — all judges run in parallel, each gets the same read-only task
  logger.info(chalk.cyan(`  [council] Judges: ${roles.judges.map(j => chalk.bold(j)).join(', ')}`));
  const judgeWorkPacket = makeWorkPacket(
    `Review the latest changes in this project. Evaluate: ${goal}`,
    cwd,
  );

  const verdictPromises = roles.judges.map(async (judgeId): Promise<JudgeVerdict> => {
    try {
      const judgeAdapter = makeAdapter(judgeId, judgeWorkPacket, true);
      const result = await runAdapter(judgeAdapter, { lease, cwd });
      const output = result.finalMessage ?? '';
      return parseVerdict(judgeId, output);
    } catch (err) {
      return { memberId: judgeId, verdict: 'UNCLEAR', confidence: 'LOW',
        scoreSuggestion: null, reason: String(err), blockingIssues: [], rawOutput: '' };
    }
  });

  const verdicts = await Promise.all(verdictPromises);
  const consensus = resolveConsensus(verdicts);

  const scoreValues = verdicts.map(v => v.scoreSuggestion).filter((v): v is number => v !== null);
  const scoreSuggested = scoreValues.length > 0
    ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10
    : null;

  return {
    builderId: roles.builder,
    judgeIds: roles.judges,
    buildResult,
    verdicts,
    consensus,
    scoreSuggested,
    filesChanged: buildResult.filesChanged,
  };
}

// ── CLI command ───────────────────────────────────────────────────────────────

export async function runCouncilCommand(options: RunCouncilOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Discovery
  logger.info(chalk.bold('\n=== DanteForge Council ==='));
  logger.info('Discovering available council members...\n');

  const members = options._discover ? await options._discover() : await discoverCouncil();

  for (const m of members) {
    const icon = m.available ? chalk.green('✓') : chalk.dim('✗');
    logger.info(`  ${icon}  ${m.label}`);
  }
  logger.info('');

  const roles = assignRoles(members, options.builderPref);
  if (!roles) {
    logger.error('Need at least 2 available council members. Install Codex, Gemini CLI, or Grok Build.');
    process.exitCode = 1;
    return;
  }

  logger.info(chalk.bold(`Builder: ${roles.builder}`));
  logger.info(chalk.bold(`Judges:  ${roles.judges.join(', ')}`));
  logger.info(chalk.dim('(builder is structurally excluded from judging its own work)\n'));

  const maxCycles = options.maxCycles ?? (options.loop ? 20 : 1);
  const targetDims = options.targetDims ?? 50;

  const cycleResults: CouncilCycleResult[] = [];
  let passCount = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    logger.info(chalk.cyan(`\n── Cycle ${cycle}/${maxCycles} ──────────────────────────────────`));
    logger.info(`Goal: ${options.goal}\n`);

    const result = await runCouncilCycle(options.goal, roles, cwd);
    cycleResults.push(result);

    // Print verdicts
    for (const v of result.verdicts) {
      const color = v.verdict === 'PASS' ? chalk.green : v.verdict === 'FAIL' ? chalk.red : chalk.yellow;
      logger.info(`  ${color(`[${v.verdict}]`)} ${v.memberId} (${v.confidence} confidence)${v.scoreSuggestion !== null ? ` — score: ${v.scoreSuggestion}` : ''}`);
      if (v.reason) logger.info(chalk.dim(`    ${v.reason.slice(0, 120)}`));
      if (v.blockingIssues.length > 0) {
        for (const issue of v.blockingIssues) logger.info(chalk.red(`    ✗ ${issue}`));
      }
    }

    const consensusColor = result.consensus === 'PASS' ? chalk.green.bold :
      result.consensus === 'FAIL' ? chalk.red.bold : chalk.yellow.bold;
    logger.info(`\n  Consensus: ${consensusColor(result.consensus)}`);
    if (result.scoreSuggested !== null) logger.info(`  Score suggested: ${result.scoreSuggested}`);
    logger.info(`  Files changed: ${result.filesChanged.length}`);

    if (result.consensus === 'PASS') {
      passCount++;
      logger.info(chalk.green(`  ✓ Council approved. Changes stand. (${passCount}/${targetDims} toward frontier)`));

      // Write progress artifact
      await fs.writeFile(
        path.join(cwd, '.danteforge', 'COUNCIL_PROGRESS.json'),
        JSON.stringify({ cycle, passCount, targetDims, consensus: result.consensus,
          scoreSuggested: result.scoreSuggested, filesChanged: result.filesChanged,
          timestamp: new Date().toISOString() }, null, 2),
        'utf8',
      ).catch(() => { /* best-effort */ });

      if (!options.loop) break;
      if (passCount >= targetDims) {
        logger.info(chalk.green.bold(`\n✓ COUNCIL TARGET REACHED: ${passCount}/${targetDims}`));
        break;
      }

      // Rotate builder for next cycle — next available judge becomes builder
      const nextBuilder = roles.judges[0] ?? roles.builder;
      roles.judges = roles.judges.slice(1).concat(roles.builder);
      roles.builder = nextBuilder;
      logger.info(chalk.dim(`\n  Rotating: next builder = ${nextBuilder} (judges never repeat the builder role consecutively)`));

    } else if (result.consensus === 'FAIL') {
      logger.info(chalk.red('  ✗ Council rejected. Changes not promoted.'));
      if (!options.loop) break;
    } else {
      logger.info(chalk.yellow('  ~ Split verdict. Human review recommended.'));
      break;
    }
  }

  // Final summary
  logger.info(chalk.bold(`\n── Council Complete ────────────────────────────────`));
  logger.info(`Cycles run: ${cycleResults.length}`);
  logger.info(`Consensus passes: ${passCount}`);

  if (options.json) {
    process.stdout.write(JSON.stringify({ cycleResults, passCount, targetDims }, null, 2) + '\n');
  }
}
