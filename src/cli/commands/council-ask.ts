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
import { makeReadOnlyLease } from '../../matrix/engines/council-worktree.js';

export interface CouncilAskOptions {
  cwd?: string;
  question: string;
  json?: boolean;
  /** Per-member budget in ms (from `--ask-timeout <seconds>`). Defaults to DEFAULT_MEMBER_TIMEOUT_MS. */
  timeoutMs?: number;
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
  /** A council needs ≥ minQuorum independent substantive responses to be a valid verdict; below it the panel
   *  is degraded and an automated loop must PAUSE rather than act (today 2–3 of 4 judges were down). */
  quorumMet: boolean;
  minQuorum: number;
}

/** A council is only a council with ≥2 independent substantive voices to cross-check each other; a lone
 *  responder is a single opinion wearing a panel's authority. Below quorum the verdict is degraded and an
 *  unattended loop must PAUSE, not guess (lived this session: codex+claude timed out, gemini empty → 1 left).
 *  Override with DANTEFORGE_COUNCIL_MIN_QUORUM. */
const MIN_COUNCIL_QUORUM = Math.max(1, Number(process.env['DANTEFORGE_COUNCIL_MIN_QUORUM']) || 2);

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
You have a limited time budget: use Grep/Glob to locate the FEW most relevant files and read only those —
do NOT exhaustively crawl the codebase. A focused answer grounded in the key files beats a slow exhaustive sweep.
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


function makeConsultAdapter(id: CouncilMemberId, workPacket: WorkPacket, timeoutMs: number) {
  switch (id) {
    case 'codex':       return new CodexAdapter({ workPacket, judgeMode: true, timeoutMs });
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket, judgeMode: true, timeoutMs });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket, judgeMode: true, timeoutMs });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket, judgeMode: true, timeoutMs });
    default:
      throw new Error(`Unsupported council member: ${id}`);
  }
}

// ── Real dispatch (production path) ──────────────────────────────────────────

/** Default per-member budget. A consultation that reads the codebase legitimately takes longer than a
 *  trivial probe (claude/codex answer "say OK" in ~6s but need minutes to read a large repo and reason);
 *  the old 300s cut thorough members (claude, codex) off mid-read while grok/gemini — which read less —
 *  finished. Set generously but under the 600s the askcouncil skill allots the whole command. Override
 *  with `--ask-timeout <seconds>`. */
const DEFAULT_MEMBER_TIMEOUT_MS = 450_000; // 7.5 minutes

async function dispatchToMember(
  member: CouncilMember,
  question: string,
  cwd: string,
  memberTimeoutMs: number,
): Promise<MemberPerspective> {
  const startMs = Date.now();
  const workPacket = makeConsultWorkPacket(question, member.label, cwd);
  const lease = makeReadOnlyLease(cwd);
  // Backstop timer handle — MUST be cleared once the race settles (finally below), else a SUCCESSFUL
  // run leaves a live timer that keeps the node process alive for the full backstop window. Codex
  // caught this in the very consultation that validated the timeout fix — the original 300s timer
  // leaked the same way, hanging every council ask after results printed.
  let backstopTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Give the adapter ITS OWN timeout = the council budget, so the adapter's honest timeout path
    // (tree-kill + stderr-tail → a real reason like "usage limit" / "judge_timeout") governs. The
    // old blind outer race fired 300s < the adapter's 600s default, so it always won and printed a
    // misleading "service may be down" that threw away the adapter's real diagnosis.
    const adapter = makeConsultAdapter(member.id as CouncilMemberId, workPacket, memberTimeoutMs);
    // Backstop ONLY: fires above the adapter's own timeout, so the adapter's honest failure resolves
    // first. Reaching here means the adapter itself wedged past its timeout (not a normal slow read).
    const backstopMs = memberTimeoutMs + 30_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      backstopTimer = setTimeout(() => reject(new Error(`${member.id} did not return within ${Math.round(backstopMs / 1000)}s — the ${member.id} CLI wedged past its own timeout (check its auth / usage limits)`)), backstopMs);
    });
    const result = await Promise.race([runAdapter(adapter, { lease, cwd }), timeoutPromise]);
    // A timed-out/failed adapter returns status 'failed' with the REAL reason on errorReason — surface
    // it as an error (renders red, counts as errored) instead of passing off a "(judge run failed…)"
    // placeholder as a real answer.
    const failed = result.status === 'failed';
    return {
      memberId: member.id,
      label: member.label,
      response: failed ? '' : (result.finalMessage ?? '(no response)'),
      error: failed ? (result.errorReason ?? result.finalMessage ?? `${member.id} run failed`) : undefined,
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
  } finally {
    if (backstopTimer) clearTimeout(backstopTimer);
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
    process.exitCode = 3; // zero members is below any quorum — the same pause signal
    return { question: options.question, perspectives: [], membersAsked: 0, membersResponded: 0, membersErrored: 0, quorumMet: false, minQuorum: MIN_COUNCIL_QUORUM };
  }

  const memberTimeoutMs = options.timeoutMs ?? DEFAULT_MEMBER_TIMEOUT_MS;
  logger.info(chalk.dim(`Consulting ${available.length} member(s) in parallel (${Math.round(memberTimeoutMs / 1000)}s/member budget)...\n`));

  const perspectiveSettled = await Promise.allSettled(
    available.map(member => {
      if (options._dispatch) {
        const startMs = Date.now();
        return options._dispatch(member.id, options.question, cwd)
          .then((response): MemberPerspective => ({ memberId: member.id, label: member.label, response, durationMs: Date.now() - startMs }))
          .catch((err): MemberPerspective => ({ memberId: member.id, label: member.label, response: '', error: String(err), durationMs: Date.now() - startMs }));
      }
      return dispatchToMember(member, options.question, cwd, memberTimeoutMs);
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
  const quorumMet = responded >= MIN_COUNCIL_QUORUM;

  logger.info(chalk.bold('\n── Council Ask Complete ────────────────────────────'));
  logger.info(`Members asked:      ${available.length}`);
  logger.info(`Responded:          ${chalk.green(String(responded))}`);
  if (errored > 0) logger.info(`Errors:             ${chalk.red(String(errored))}`);
  if (!quorumMet) {
    logger.warn(chalk.red.bold(`\n⚠ QUORUM NOT MET: ${responded} substantive response(s) < ${MIN_COUNCIL_QUORUM} required.`));
    logger.warn(chalk.red('  This is NOT a council verdict — a lone/empty panel cannot cross-check itself. An unattended'));
    logger.warn(chalk.red('  loop MUST PAUSE here (exit 3) instead of acting on a degraded panel.'));
    process.exitCode = 3; // distinct pause signal a loop driver can detect (vs 0 = ok, 1 = error)
  }
  logger.info(chalk.dim('\nNext: synthesize the perspectives above and decide on the best path forward.'));

  const result: CouncilAskResult = {
    question: options.question,
    perspectives,
    membersAsked: available.length,
    membersResponded: responded,
    membersErrored: errored,
    quorumMet,
    minQuorum: MIN_COUNCIL_QUORUM,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }

  return result;
}
