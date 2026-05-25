// council-ask.ts — Council consultation mode.
//
// Dispatches a read-only question to ALL available council members in parallel.
// Each member reads the codebase and responds with their perspective.
// Output is structured for the operator (Claude Code) to synthesize.
//
// Usage: danteforge council --ask "<question>"
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { discoverCouncil } from './council.js';
import type { CouncilMember, CouncilMemberId } from './council.js';
import { CodexAdapter } from '../../matrix/adapters/codex-adapter.js';
import { GeminiCLIAdapter } from '../../matrix/adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../../matrix/adapters/grok-build-adapter.js';
import { ClaudeCodeAdapter } from '../../matrix/adapters/claude-code-adapter.js';
import { runAdapter } from '../../matrix/adapters/adapter-interface.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';

export interface CouncilAskOptions {
  cwd?: string;
  question: string;
  json?: boolean;
  /** Injection seam: override council discovery for tests */
  _discover?: () => Promise<CouncilMember[]>;
  /** Injection seam: override member dispatch for tests */
  _dispatch?: (memberId: string, question: string, cwd: string) => Promise<string>;
}

export interface MemberPerspective {
  memberId: string;
  label: string;
  response: string;
  error?: string;
  durationMs: number;
}

export interface CouncilAskResult {
  question: string;
  perspectives: MemberPerspective[];
  membersAsked: number;
  membersResponded: number;
  membersErrored: number;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildConsultPrompt(question: string, label: string): string {
  return `You are ${label}, a senior software engineering expert reviewing this codebase.

You have been asked a consultation question. Read the relevant source files and answer honestly.

QUESTION: ${question}

Your response must include:
1. ASSESSMENT: Your honest technical assessment (2-4 sentences)
2. RECOMMENDATION: The specific action you recommend (1-3 bullet points)
3. RISKS: Key risks or trade-offs the operator should know (1-3 bullet points)

Be direct and specific. Use file paths and function names where relevant.
Do NOT make any code changes — this is read-only consultation.`;
}

// ── Adapter factory (read-only consultation mode) ─────────────────────────────

function makeConsultWorkPacket(question: string, label: string, cwd: string): WorkPacket {
  return {
    id: `council-ask.${Date.now()}`,
    dimensionId: 'council-consultation',
    objective: buildConsultPrompt(question, label),
    acceptanceCriteria: ['ASSESSMENT, RECOMMENDATION, and RISKS sections present'],
    proof: { proofRequired: ['structured consultation response'] },
    globalForbidden: ['**'],
    context: { worktreePath: cwd },
  } as unknown as WorkPacket;
}

function makeReadOnlyLease(cwd: string): AgentLease {
  return {
    id: `council-ask-lease.${Date.now()}`,
    worktreePath: cwd,
    allowedWritePaths: [],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['**'],
  } as unknown as AgentLease;
}

function makeConsultAdapter(id: CouncilMemberId, workPacket: WorkPacket) {
  switch (id) {
    case 'codex':       return new CodexAdapter({ workPacket, judgeMode: true });
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket, judgeMode: true });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket, judgeMode: true });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket, judgeMode: true });
    default:
      throw new Error(`Unsupported council member: ${id}`);
  }
}

// ── Real dispatch (production path) ──────────────────────────────────────────

async function dispatchToMember(
  member: CouncilMember,
  question: string,
  cwd: string,
): Promise<MemberPerspective> {
  const startMs = Date.now();
  const workPacket = makeConsultWorkPacket(question, member.label, cwd);
  const lease = makeReadOnlyLease(cwd);
  try {
    const adapter = makeConsultAdapter(member.id as CouncilMemberId, workPacket);
    const result = await runAdapter(adapter, { lease, cwd });
    return {
      memberId: member.id,
      label: member.label,
      response: result.finalMessage ?? '(no response)',
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      memberId: member.id,
      label: member.label,
      response: '',
      error: String(err),
      durationMs: Date.now() - startMs,
    };
  }
}

// ── Output rendering ──────────────────────────────────────────────────────────

function renderPerspective(p: MemberPerspective, index: number): void {
  const banner = chalk.bold(`\n── ${index + 1}. ${p.label} ` + '─'.repeat(Math.max(2, 50 - p.label.length)));
  logger.info(banner);
  if (p.error) {
    logger.info(chalk.red(`  Error: ${p.error}`));
    return;
  }
  const lines = p.response.split('\n');
  for (const line of lines) {
    if (/^ASSESSMENT:/i.test(line.trim()))  logger.info(chalk.cyan(line));
    else if (/^RECOMMENDATION:/i.test(line.trim())) logger.info(chalk.green(line));
    else if (/^RISKS:/i.test(line.trim()))  logger.info(chalk.yellow(line));
    else logger.info('  ' + line);
  }
  logger.info(chalk.dim(`  (${(p.durationMs / 1000).toFixed(1)}s)`));
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runCouncilAsk(options: CouncilAskOptions): Promise<CouncilAskResult> {
  const cwd = options.cwd ?? process.cwd();

  logger.info(chalk.bold('\n=== DanteForge Council Ask ==='));
  logger.info(chalk.italic(`"${options.question}"\n`));

  const discover = options._discover ?? discoverCouncil;
  const members = await discover();
  const available = members.filter(m => m.available);

  for (const m of members) {
    logger.info(`  ${m.available ? chalk.green('✓') : chalk.dim('✗')}  ${m.label}`);
  }
  logger.info('');

  if (available.length === 0) {
    logger.error(chalk.red('No council members available. Install at least one: codex, gemini, grok, or claude-code.'));
    return { question: options.question, perspectives: [], membersAsked: 0, membersResponded: 0, membersErrored: 0 };
  }

  logger.info(chalk.dim(`Consulting ${available.length} member(s) in parallel...\n`));

  const perspectiveSettled = await Promise.allSettled(
    available.map(member => {
      if (options._dispatch) {
        const startMs = Date.now();
        return options._dispatch(member.id, options.question, cwd)
          .then((response): MemberPerspective => ({ memberId: member.id, label: member.label, response, durationMs: Date.now() - startMs }))
          .catch((err): MemberPerspective => ({ memberId: member.id, label: member.label, response: '', error: String(err), durationMs: Date.now() - startMs }));
      }
      return dispatchToMember(member, options.question, cwd);
    }),
  );

  const perspectives: MemberPerspective[] = perspectiveSettled.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      memberId: available[i]!.id,
      label: available[i]!.label,
      response: '',
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      durationMs: 0,
    },
  );

  // Render each perspective
  perspectives.forEach((p, i) => renderPerspective(p, i));

  const responded = perspectives.filter(p => !p.error && p.response).length;
  const errored = perspectives.filter(p => Boolean(p.error)).length;

  logger.info(chalk.bold('\n── Council Ask Complete ────────────────────────────'));
  logger.info(`Members asked:      ${available.length}`);
  logger.info(`Responded:          ${chalk.green(String(responded))}`);
  if (errored > 0) logger.info(`Errors:             ${chalk.red(String(errored))}`);
  logger.info(chalk.dim('\nNext: synthesize the perspectives above and decide on the best path forward.'));

  const result: CouncilAskResult = {
    question: options.question,
    perspectives,
    membersAsked: available.length,
    membersResponded: responded,
    membersErrored: errored,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }

  return result;
}
