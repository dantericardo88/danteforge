// Matrix Kernel CLI — Execution-loop subcommands (Phase 13a)
//
// Wires the verification / red-team / taste-gate / merge-court / retrospective
// half of the Matrix Kernel to the CLI. Each command reads/writes canonical
// MATRIX_REPORT_PATHS via matrix-state helpers and dispatches to the
// corresponding court/engine.
import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';

export function registerMatrixExecutionCommands(matrix: Command): void {
  registerRunWave(matrix);
  registerVerify(matrix);
  registerRedTeam(matrix);
  registerTasteGate(matrix);
  registerMergeCourt(matrix);
  registerRetrospective(matrix);
  registerEmbeddedComplete(matrix);
  registerMailboxCommands(matrix);
}

// ── run-wave ───────────────────────────────────────────────────────────────

function registerRunWave(matrix: Command): void {
  matrix
    .command('run-wave <waveNumber>')
    .description('Execute a planned wave: create leases + worktrees + dispatch agents')
    .option('--cwd <path>', 'Project root')
    .option('--adapter <kind>', 'Agent adapter: auto | embedded | fake | claude | codex | claude-api | codex-api | gemini | grok | dantecode | ollama | together | groq | mistral (default: auto, which uses `embedded` inside a host AI and falls back to `fake` in a plain terminal). `embedded` writes a Work Instruction Packet for the host AI instead of spawning a subprocess.')
    .option('--max-tokens <n>', 'Per-agent LLM token cap', parseInt)
    .action(async (waveNumber: string, opts) => runSafely('matrix-kernel:run-wave', async () => {
      const { loadGraph, saveGraph, ensureMatrixDir } = await import('../matrix/engines/matrix-state.js');
      const { loadOwnershipMap } = await import('../matrix/engines/ownership-map.js');
      const { createLease } = await import('../matrix/engines/lease-manager.js');
      const { FakeAgentAdapter } = await import('../matrix/adapters/fake-agent-adapter.js');
      const { ClaudeCodeAdapter } = await import('../matrix/adapters/claude-code-adapter.js');
      const { CodexAdapter } = await import('../matrix/adapters/codex-adapter.js');
      const { AnthropicAPIAdapter } = await import('../matrix/adapters/anthropic-api-adapter.js');
      const { OpenAIAPIAdapter } = await import('../matrix/adapters/openai-api-adapter.js');
      const { GeminiAdapter } = await import('../matrix/adapters/gemini-adapter.js');
      const { GrokAdapter } = await import('../matrix/adapters/grok-adapter.js');
      const { DanteCodeAdapter } = await import('../matrix/adapters/dantecode-adapter.js');
      const { LLMAgentAdapter } = await import('../matrix/adapters/llm-agent-adapter.js');
      const { EmbeddedAdapter } = await import('../matrix/adapters/embedded-adapter.js');
      const { runAdapter } = await import('../matrix/adapters/adapter-interface.js');
      const { detectHostAI } = await import('../core/host-detection.js');
      const { appendMessage, writeMailboxIndex } = await import('../matrix/engines/mailbox.js');
      const path = await import('node:path');
      const fs = await import('node:fs/promises');

      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      const requestedKind = (opts.adapter as string | undefined) ?? 'auto';
      const detectedHost = detectHostAI();
      // Default `auto` routing: embedded when invoked from inside a host AI;
      // dry-run-safe adapter otherwise (no LLM spend without explicit opt-in).
      const adapterKind = requestedKind === 'auto'
        ? (detectedHost ? 'embedded' : 'fake')
        : requestedKind;
      if (requestedKind === 'auto') {
        logger.info(`[matrix-kernel] Auto-selected adapter: ${adapterKind}${detectedHost ? ` (host AI: ${detectedHost})` : ' (no host detected)'}`);
      }
      const waveIdx = parseInt(waveNumber, 10) - 1;
      await ensureMatrixDir(cwd);

      const simulationPlan = await loadGraph<{ waves: Array<{ workPacketIds: string[] }> }>(cwd, 'simulationPlan');
      const workGraph = await loadGraph<{ packets: Array<{ id: string; dimensionId: string; paths: { ownedPaths: string[]; readOnlyPaths: string[]; forbiddenPaths: string[] }; [k: string]: unknown }> }>(cwd, 'workGraph');
      if (!simulationPlan || !workGraph) {
        logger.error('[matrix-kernel] Missing simulation plan or work graph. Run `matrix-kernel simulate` first.');
        process.exitCode = 1;
        return;
      }
      const wave = simulationPlan.waves[waveIdx];
      if (!wave) {
        logger.error(`[matrix-kernel] Wave ${waveNumber} not found (only ${simulationPlan.waves.length} planned).`);
        process.exitCode = 1;
        return;
      }

      const ownershipMap = await loadOwnershipMap({ cwd });

      // Build adapter for one work packet. Factored out so we can dispatch
      // the whole wave in parallel via Promise.all without duplicating logic.
      const makeAdapter = (packet: { id: string }) => {
        switch (adapterKind) {
          case 'embedded': return new EmbeddedAdapter({
            workPacket: packet as never,
            hostAI: detectedHost ?? 'unknown',
          });
          case 'claude': return new ClaudeCodeAdapter({ workPacket: packet as never });
          case 'codex':  return new CodexAdapter({ workPacket: packet as never });
          case 'claude-api': return new AnthropicAPIAdapter({ workPacket: packet as never });
          case 'codex-api': return new OpenAIAPIAdapter({ workPacket: packet as never });
          case 'gemini': return new GeminiAdapter({ workPacket: packet as never });
          case 'grok':   return new GrokAdapter({ workPacket: packet as never });
          case 'dantecode': return new DanteCodeAdapter({ workPacket: packet as never });
          case 'ollama': return new LLMAgentAdapter({ workPacket: packet as never, provider: 'ollama', providerLabel: 'ollama' });
          case 'together': return new LLMAgentAdapter({ workPacket: packet as never, provider: 'together', providerLabel: 'together' });
          case 'groq': return new LLMAgentAdapter({ workPacket: packet as never, provider: 'groq', providerLabel: 'groq' });
          case 'mistral': return new LLMAgentAdapter({ workPacket: packet as never, provider: 'mistral', providerLabel: 'mistral' });
          default:       return new FakeAgentAdapter({ action: 'success' });
        }
      };

      // Pre-create leases sequentially so logs interleave cleanly and so we
      // surface "packet not found" errors before any subprocess launches.
      type DispatchEntry = { lease: ReturnType<typeof createLease>; packet: typeof workGraph.packets[number] };
      const dispatchQueue: DispatchEntry[] = [];
      for (const packetId of wave.workPacketIds) {
        const packet = workGraph.packets.find(p => p.id === packetId);
        if (!packet) {
          logger.warn(`[matrix-kernel] Packet ${packetId} not found in workGraph; skipping`);
          continue;
        }
        const lease = createLease({
          workPacket: packet as never,
          provider: adapterKind,
          agentRole: 'dimension-engineer',
          ownershipMap,
          cwd,
        });
        await fs.mkdir(lease.worktreePath, { recursive: true });
        dispatchQueue.push({ lease, packet });
        logger.info(`[matrix-kernel] Issued lease ${lease.id} (provider=${adapterKind})`);
      }

      logger.info(`[matrix-kernel] Dispatching ${dispatchQueue.length} agent(s) in parallel...`);
      const dispatched = await Promise.all(dispatchQueue.map(async ({ lease, packet }) => {
        const adapter = makeAdapter(packet);
        try {
          const result = await runAdapter(adapter, { lease, cwd: lease.worktreePath });
          logger.info(`  ${result.status === 'completed' ? '✓' : '✗'} ${lease.id}: ${result.status} (${result.filesChanged.length} file(s))`);
          return { lease, result };
        } catch (err) {
          logger.warn(`  ✗ ${lease.id}: adapter threw ${String(err)}`);
          return { lease, result: null };
        }
      }));

      const newLeases: unknown[] = dispatched.map(d => d.lease);
      const agentRuns: unknown[] = dispatched.flatMap(d => (d.result ? [d.result] : []));

      // Persist leases + agent runs
      const existingLeases = (await loadGraph<{ leases: unknown[] }>(cwd, 'leaseGraph'))?.leases ?? [];
      await saveGraph(cwd, 'leaseGraph', { generatedAt: new Date().toISOString(), leases: [...existingLeases, ...newLeases] });
      const existingRuns = (await loadGraph<{ runs: unknown[] }>(cwd, 'agentRuns'))?.runs ?? [];
      await saveGraph(cwd, 'agentRuns', { generatedAt: new Date().toISOString(), runs: [...existingRuns, ...agentRuns] });

      // Publish wave-level mailbox messages so other agents (and the war-room
      // dashboard) see what completed. Use `merge_ready` for successful agent
      // runs, `regression_detected` for failed/awaiting ones — these are the
      // most actionable signals for downstream consumers.
      try {
        for (const d of dispatched) {
          if (!d.result) continue;
          const status = d.result.status;
          const msgType = status === 'completed' ? 'merge_ready'
            : status === 'awaiting_input' ? 'human_decision_required'
            : 'regression_detected';
          await appendMessage({
            cwd,
            type: msgType,
            fromLease: d.lease.id,
            toLease: 'broadcast',
            summary: `Lease ${d.lease.id} finished wave ${waveNumber} as ${status} (${d.result.filesChanged.length} file change(s)).`,
            impact: status === 'completed' ? 'consumer_update_required' : 'informational',
            requiresAck: false,
            metadata: { provider: adapterKind, waveNumber, filesChanged: d.result.filesChanged },
          });
        }
        await writeMailboxIndex(cwd);
      } catch (err) {
        logger.warn(`[matrix-kernel] Mailbox publish failed: ${String(err)}`);
      }

      logger.success(`[matrix-kernel] Wave ${waveNumber} complete: ${agentRuns.length} agent run(s)`);
      void path;
    }));
}

// ── verify ────────────────────────────────────────────────────────────────

function registerVerify(matrix: Command): void {
  matrix
    .command('verify [leaseId]')
    .description('Run Verification Court on a lease (or --all)')
    .option('--cwd <path>', 'Project root')
    .option('--all', 'Verify all leases not yet verified')
    .option('--skip-required-commands', 'Skip running lease.requiredCommands')
    .action(async (leaseId: string | undefined, opts) => runSafely('matrix-kernel:verify', async () => {
      const { loadGraph, saveGraph } = await import('../matrix/engines/matrix-state.js');
      const { loadOwnershipMap } = await import('../matrix/engines/ownership-map.js');
      const { reviewBranch } = await import('../matrix/courts/verification-court.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      const ownershipMap = await loadOwnershipMap({ cwd });
      const leaseGraph = await loadGraph<{ leases: Array<{ id: string; workPacketId: string; [k: string]: unknown }> }>(cwd, 'leaseGraph');
      const workGraph = await loadGraph<{ packets: Array<{ id: string; [k: string]: unknown }> }>(cwd, 'workGraph');
      const agentRunsFile = await loadGraph<{ runs: Array<{ leaseId: string; [k: string]: unknown }> }>(cwd, 'agentRuns');

      if (!leaseGraph || !workGraph || !agentRunsFile) {
        logger.error('[matrix-kernel] Missing leases / work graph / agent runs. Run `run-wave` first.');
        process.exitCode = 1;
        return;
      }

      const candidates = (opts.all as boolean | undefined)
        ? leaseGraph.leases
        : leaseGraph.leases.filter(l => l.id === leaseId);
      if (candidates.length === 0) {
        logger.error(`[matrix-kernel] No leases to verify${leaseId ? ` matching ${leaseId}` : ''}`);
        process.exitCode = 1;
        return;
      }

      logger.info(`[matrix-kernel] Verifying ${candidates.length} lease(s)...`);
      const gateReports: unknown[] = [];
      for (const lease of candidates) {
        const packet = workGraph.packets.find(p => p.id === lease.workPacketId);
        const run = agentRunsFile.runs.find(r => r.leaseId === lease.id);
        if (!packet || !run) {
          logger.warn(`[matrix-kernel] Skipping ${lease.id} (missing packet or run)`);
          continue;
        }
        logger.info(`  → ${lease.id}`);
        const report = await reviewBranch({
          lease: lease as never,
          workPacket: packet as never,
          ownershipMap,
          agentRunResult: run as never,
          skipRequiredCommands: opts.skipRequiredCommands as boolean | undefined,
        });
        gateReports.push(report);
        const icon = report.status === 'passed' ? '✓' : report.status === 'failed' ? '✗' : '⚠';
        logger.info(`    ${icon} ${report.status}`);
      }
      const existing = (await loadGraph<{ reports: unknown[] }>(cwd, 'gateReports'))?.reports ?? [];
      await saveGraph(cwd, 'gateReports', { generatedAt: new Date().toISOString(), reports: [...existing, ...gateReports] });
      logger.success(`[matrix-kernel] Verification Court: ${gateReports.length} report(s) written`);
    }));
}

// ── red-team ──────────────────────────────────────────────────────────────

function registerRedTeam(matrix: Command): void {
  matrix
    .command('red-team <leaseId>')
    .description('Run adversarial Red Team Verifier on a lease (live LLM by default)')
    .option('--cwd <path>', 'Project root')
    .option('--mock', 'Use a stubbed LLM that returns an empty findings array (CI-safe)')
    .action(async (leaseId: string, opts) => runSafely('matrix-kernel:red-team', async () => {
      const { loadGraph, saveGraph } = await import('../matrix/engines/matrix-state.js');
      const { verifyBranchAdversarial } = await import('../matrix/courts/red-team-verifier.js');
      const { callLLM } = await import('../core/llm.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();

      const leaseGraph = await loadGraph<{ leases: Array<{ id: string; workPacketId: string }> }>(cwd, 'leaseGraph');
      const workGraph = await loadGraph<{ packets: Array<{ id: string }> }>(cwd, 'workGraph');
      const gateReportsFile = await loadGraph<{ reports: Array<{ leaseId: string }> }>(cwd, 'gateReports');
      const agentRunsFile = await loadGraph<{ runs: Array<{ leaseId: string }> }>(cwd, 'agentRuns');

      const lease = leaseGraph?.leases.find(l => l.id === leaseId);
      const packet = lease ? workGraph?.packets.find(p => p.id === lease.workPacketId) : undefined;
      const gateReport = gateReportsFile?.reports.find(r => r.leaseId === leaseId);
      const run = agentRunsFile?.runs.find(r => r.leaseId === leaseId);
      if (!lease || !packet || !gateReport || !run) {
        logger.error(`[matrix-kernel] Missing data for lease ${leaseId}. Run prior phases first.`);
        process.exitCode = 1;
        return;
      }

      const mockCaller = async (): Promise<string> => '[]';
      const liveCaller = async (prompt: string): Promise<string> => callLLM(prompt, 'claude');
      const report = await verifyBranchAdversarial({
        lease: lease as never,
        workPacket: packet as never,
        gateReport: gateReport as never,
        agentRunResult: run as never,
        _redTeamCaller: (opts.mock as boolean | undefined) ? mockCaller : liveCaller,
      });
      const existing = (await loadGraph<{ reports: unknown[] }>(cwd, 'redTeamReports'))?.reports ?? [];
      await saveGraph(cwd, 'redTeamReports', { generatedAt: new Date().toISOString(), reports: [...existing, report] });
      const icon = report.status === 'passed' ? '✓' : '✗';
      logger.info(`  ${icon} ${leaseId} → ${report.status} (${report.findings.length} finding(s))`);
      logger.success(`[matrix-kernel] Red Team report written`);
    }));
}

// ── taste-gate ────────────────────────────────────────────────────────────

function registerTasteGate(matrix: Command): void {
  matrix
    .command('taste-gate <leaseIdOrAction> [secondArg]')
    .description('Check, approve, or reject a taste gate for a lease')
    .option('--cwd <path>', 'Project root')
    .option('--by <name>', 'Resolver name (for approve/reject)')
    .option('--notes <text>', 'Decision notes')
    .action(async (arg1: string, arg2: string | undefined, opts) => runSafely('matrix-kernel:taste-gate', async () => {
      const { loadGraph, saveGraph } = await import('../matrix/engines/matrix-state.js');
      const { checkTasteGate, approveTasteGate, rejectTasteGate } = await import('../matrix/courts/taste-gate.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();

      // Lifecycle: `taste-gate approve <id>` | `taste-gate reject <id>` | `taste-gate <leaseId>`
      if (arg1 === 'approve' || arg1 === 'reject') {
        const id = arg2;
        if (!id) {
          logger.error(`[matrix-kernel] Missing taste-gate ID for ${arg1}`);
          process.exitCode = 1;
          return;
        }
        const file = await loadGraph<{ requests: unknown[] }>(cwd, 'tasteGates');
        const requests = (file?.requests ?? []) as Array<{ id: string }>;
        const idx = requests.findIndex(r => r.id === id);
        if (idx === -1) {
          logger.error(`[matrix-kernel] Taste gate ${id} not found`);
          process.exitCode = 1;
          return;
        }
        const by = (opts.by as string | undefined) ?? 'cli-operator';
        const notes = opts.notes as string | undefined;
        requests[idx] = (arg1 === 'approve'
          ? approveTasteGate(requests[idx] as never, by, notes)
          : rejectTasteGate(requests[idx] as never, by, notes)) as unknown as { id: string };
        await saveGraph(cwd, 'tasteGates', { generatedAt: new Date().toISOString(), requests });
        logger.success(`[matrix-kernel] Taste gate ${id} ${arg1}d by ${by}`);
        return;
      }

      // Otherwise: check a lease
      const leaseId = arg1;
      const leaseGraph = await loadGraph<{ leases: Array<{ id: string; workPacketId: string }> }>(cwd, 'leaseGraph');
      const workGraph = await loadGraph<{ packets: Array<{ id: string }> }>(cwd, 'workGraph');
      const agentRunsFile = await loadGraph<{ runs: Array<{ leaseId: string }> }>(cwd, 'agentRuns');
      const lease = leaseGraph?.leases.find(l => l.id === leaseId);
      const packet = lease ? workGraph?.packets.find(p => p.id === lease.workPacketId) : undefined;
      const run = agentRunsFile?.runs.find(r => r.leaseId === leaseId);
      if (!lease || !packet || !run) {
        logger.error(`[matrix-kernel] Missing data for lease ${leaseId}`);
        process.exitCode = 1;
        return;
      }
      const request = checkTasteGate({ lease: lease as never, workPacket: packet as never, agentRunResult: run as never });
      const existing = (await loadGraph<{ requests: unknown[] }>(cwd, 'tasteGates'))?.requests ?? [];
      await saveGraph(cwd, 'tasteGates', { generatedAt: new Date().toISOString(), requests: [...existing, request] });
      logger.info(`  ${request.status === 'requires_human_approval' ? '⚠' : '✓'} ${leaseId} → ${request.status}`);
      if (request.affectedSurfaces.length > 0) {
        logger.info(`    affected surfaces: ${request.affectedSurfaces.join(', ')}`);
      }
      logger.success(`[matrix-kernel] Taste gate request ${request.id} written`);
    }));
}

// ── merge-court ───────────────────────────────────────────────────────────

function registerMergeCourt(matrix: Command): void {
  matrix
    .command('merge-court')
    .description('Run Merge Court arbitration over all pending candidates')
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:merge-court', async () => {
      const { loadGraph, saveGraph } = await import('../matrix/engines/matrix-state.js');
      const { runMergeCourt } = await import('../matrix/courts/merge-court.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();

      const leaseGraph = await loadGraph<{ leases: Array<{ id: string; workPacketId: string; branch: string; allowedWritePaths: string[] }> }>(cwd, 'leaseGraph');
      const workGraph = await loadGraph<{ packets: Array<{ id: string; dimensionId: string; allowEmptyDiff?: boolean }> }>(cwd, 'workGraph');
      const gateReportsFile = await loadGraph<{ reports: Array<{ id: string; leaseId: string; status: string }> }>(cwd, 'gateReports');
      const redTeamFile = await loadGraph<{ reports: Array<{ leaseId: string }> }>(cwd, 'redTeamReports');
      const tasteGatesFile = await loadGraph<{ requests: Array<{ leaseId: string }> }>(cwd, 'tasteGates');
      const conflictFile = await loadGraph<{ conflicts: unknown[]; summary: { low: number; medium: number; high: number; critical: number } }>(cwd, 'conflicts');
      // agent-runs.json carries the actual filesChanged from each AgentRunResult.
      // Merge-court reads this to enforce the no-diff rejection rule.
      const agentRunsFile = await loadGraph<{ runs: Array<{ leaseId: string; filesChanged: string[] }> }>(cwd, 'agentRuns');

      if (!leaseGraph || !workGraph || !gateReportsFile) {
        logger.error('[matrix-kernel] Missing required state. Run `verify` and `run-wave` first.');
        process.exitCode = 1;
        return;
      }

      const candidates = [] as Array<{ candidate: { candidateId: string; leaseId: string; workPacketId: string; branch: string; gateReportId: string; blastRadius: number; riskLevel: 'low' | 'medium'; filesChanged: string[]; allowEmptyDiff?: boolean }; lease: unknown; workPacket: unknown; gateReport: unknown; redTeamReport?: unknown; tasteGateRequest?: unknown }>;
      for (const lease of leaseGraph.leases) {
        const packet = workGraph.packets.find(p => p.id === lease.workPacketId);
        const gateReport = gateReportsFile.reports.find(r => r.leaseId === lease.id);
        if (!packet || !gateReport) continue;
        const redTeamReport = redTeamFile?.reports.find(r => r.leaseId === lease.id);
        const tasteGateRequest = tasteGatesFile?.requests.find(r => r.leaseId === lease.id);
        // Find the latest agent-run for this lease — there may be multiple
        // (re-runs); take the last one so the embedded-complete update wins.
        const matchingRuns = (agentRunsFile?.runs ?? []).filter(r => r.leaseId === lease.id);
        const filesChanged = matchingRuns.length > 0 ? (matchingRuns[matchingRuns.length - 1]?.filesChanged ?? []) : [];
        candidates.push({
          candidate: {
            candidateId: `cand.${lease.id}`,
            leaseId: lease.id,
            workPacketId: lease.workPacketId,
            branch: lease.branch,
            gateReportId: gateReport.id,
            blastRadius: lease.allowedWritePaths.length,
            riskLevel: 'low',
            filesChanged,
            allowEmptyDiff: packet.allowEmptyDiff === true,
          },
          lease, workPacket: packet, gateReport, redTeamReport, tasteGateRequest,
        });
      }

      const conflictReport = conflictFile ?? { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } };
      const result = await runMergeCourt({
        candidates: candidates.map(c => c as never),
        conflictReport: conflictReport as never,
        _runMerge: async () => ({ success: true }),
        _createTimeMachineCommit: async (input) => ({ eventId: `tm.${input.candidate.candidateId}` }),
      });
      const existing = (await loadGraph<{ decisions: unknown[] }>(cwd, 'mergeDecisions'))?.decisions ?? [];
      await saveGraph(cwd, 'mergeDecisions', { generatedAt: new Date().toISOString(), decisions: [...existing, ...result.decisions] });
      logger.success(`[matrix-kernel] Merge Court: ${result.approvedCount} approved, ${result.rejectedCount} rejected, ${result.blockedCount} blocked`);
      for (const d of result.decisions) {
        const icon = d.decision === 'APPROVED' ? '✓' : '✗';
        logger.info(`  ${icon} ${d.candidateId} → ${d.decision}`);
      }
    }));
}

// ── retrospective + report ────────────────────────────────────────────────

function registerRetrospective(matrix: Command): void {
  matrix
    .command('retrospective')
    .description('Generate the Matrix run retrospective')
    .option('--cwd <path>', 'Project root')
    .option('--run-id <id>', 'Run identifier (default: current timestamp)')
    .action(async (opts) => runSafely('matrix-kernel:retrospective', async () => {
      const { loadGraph } = await import('../matrix/engines/matrix-state.js');
      const { generateRetrospective, writeRetrospective } = await import('../matrix/engines/retrospective.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      const runId = (opts.runId as string | undefined) ?? `run-${Date.now()}`;

      const agentRunsFile = await loadGraph<{ runs: unknown[] }>(cwd, 'agentRuns');
      const gateReportsFile = await loadGraph<{ reports: unknown[] }>(cwd, 'gateReports');
      const redTeamFile = await loadGraph<{ reports: unknown[] }>(cwd, 'redTeamReports');
      const mergeFile = await loadGraph<{ decisions: unknown[] }>(cwd, 'mergeDecisions');
      const conflictFile = await loadGraph<{ conflicts: unknown[]; summary: { low: number; medium: number; high: number; critical: number } }>(cwd, 'conflicts');

      const retro = generateRetrospective({
        runId,
        startedAt: new Date().toISOString(),
        agentRuns: (agentRunsFile?.runs ?? []) as never,
        gateReports: (gateReportsFile?.reports ?? []) as never,
        redTeamReports: (redTeamFile?.reports ?? []) as never,
        mergeDecisions: (mergeFile?.decisions ?? []) as never,
        conflictReport: (conflictFile ?? { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } }) as never,
      });
      const outPath = await writeRetrospective(retro, cwd);
      logger.success(`[matrix-kernel] Retrospective written: ${outPath}`);
      logger.info(`  Best provider: ${retro.bestPerformingProvider}`);
      logger.info(`  Highest conflict area: ${retro.highestConflictArea}`);
      logger.info(`  Recommendations: ${retro.recommendedNextRunChanges.length}`);
    }));

  matrix
    .command('report')
    .description('Render the final Matrix run report (markdown)')
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:report', async () => {
      const { loadGraph } = await import('../matrix/engines/matrix-state.js');
      const { generateRunReport, writeFinalReport } = await import('../matrix/engines/report-generator.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();

      const retro = await loadGraph<{ runId: string; startedAt: string; completedAt: string; recommendedNextRunChanges: string[]; [k: string]: unknown }>(cwd, 'retrospective');
      if (!retro) {
        logger.error('[matrix-kernel] No retrospective found. Run `retrospective` first.');
        process.exitCode = 1;
        return;
      }
      const mergeFile = await loadGraph<{ decisions: Array<{ decision: string }> }>(cwd, 'mergeDecisions');
      const conflictFile = await loadGraph<{ conflicts: unknown[] }>(cwd, 'conflicts');
      const workGraph = await loadGraph<{ packets: unknown[] }>(cwd, 'workGraph');
      const agentRunsFile = await loadGraph<{ runs: unknown[] }>(cwd, 'agentRuns');

      const report = generateRunReport({
        runId: retro.runId,
        startedAt: retro.startedAt,
        completedAt: retro.completedAt,
        startingScore: 0,
        endingScore: 0,
        dimensionsImproved: [],
        workPacketsCreated: workGraph?.packets.length ?? 0,
        agentsRan: agentRunsFile?.runs.length ?? 0,
        conflictsPredicted: conflictFile?.conflicts.length ?? 0,
        conflictsHappened: 0,
        mergeDecisions: (mergeFile?.decisions ?? []) as never,
        gateReports: [],
        redTeamReports: [],
        retrospective: retro as never,
      });
      const outPath = await writeFinalReport(report, retro as never, cwd);
      logger.success(`[matrix-kernel] Final report written: ${outPath}`);
    }));
}

// ── embedded-complete ─────────────────────────────────────────────────────

function registerEmbeddedComplete(matrix: Command): void {
  matrix
    .command('embedded-complete <leaseId>')
    .description('Record the diff produced by a host AI for an embedded-mode lease and mark it ready for verify-court.')
    .option('--cwd <path>', 'Project root')
    .action(async (leaseId: string, opts) => runSafely('matrix-kernel:embedded-complete', async () => {
      const { embeddedComplete } = await import('./commands/matrix-embedded.js');
      const result = await embeddedComplete(leaseId, { cwd: opts.cwd as string | undefined });
      logger.info(`[matrix-kernel] Recorded ${result.filesChanged.length} file change(s) for ${result.leaseId}.`);
      if (result.mailboxId) {
        logger.info(`[matrix-kernel] Mailbox message: ${result.mailboxId}`);
      }
    }));
}

// ── mailbox post / poll / list ────────────────────────────────────────────

function registerMailboxCommands(matrix: Command): void {
  const mailbox = matrix.command('mailbox').description('Inter-agent coordination bus (post / poll / list)');
  mailbox
    .command('post')
    .description('Publish a mailbox message between leases (or broadcast)')
    .requiredOption('--from <leaseId>', 'Lease ID of the sender (or "system" / "human")')
    .requiredOption('--to <leaseId>', 'Recipient lease ID (or "broadcast")')
    .requiredOption('--type <type>', 'Message type (merge_ready | conflict_detected | dependency_notice | ...)')
    .requiredOption('--summary <text>', 'One-line human-readable summary')
    .option('--impact <kind>', 'informational | consumer_update_required | blocking', 'informational')
    .option('--requires-ack', 'Recipient must acknowledge before the message expires', false)
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:mailbox:post', async () => {
      const { mailboxPost } = await import('./commands/matrix-mailbox.js');
      await mailboxPost({
        cwd: opts.cwd as string | undefined,
        from: opts.from as string,
        to: opts.to as string,
        type: opts.type as string,
        summary: opts.summary as string,
        impact: opts.impact as string,
        requiresAck: opts.requiresAck as boolean,
      });
    }));

  mailbox
    .command('poll')
    .description('Wait for pending messages (returns immediately if any exist)')
    .option('--lease <leaseId>', 'Only return messages addressed to this lease (or broadcast)')
    .option('--timeout <ms>', 'Max wait time in milliseconds (default 5000)', '5000')
    .option('--types <comma>', 'Comma-separated list of message types to filter by')
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:mailbox:poll', async () => {
      const { mailboxPoll } = await import('./commands/matrix-mailbox.js');
      await mailboxPoll({
        cwd: opts.cwd as string | undefined,
        lease: opts.lease as string | undefined,
        timeoutMs: parseInt(opts.timeout as string, 10),
        types: opts.types as string | undefined,
      });
    }));

  mailbox
    .command('list')
    .description('List all messages in the mailbox')
    .option('--status <status>', 'pending_ack | acked | rejected | expired')
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:mailbox:list', async () => {
      const { mailboxList } = await import('./commands/matrix-mailbox.js');
      await mailboxList({
        cwd: opts.cwd as string | undefined,
        status: opts.status as string | undefined,
      });
    }));
}

// ── Common error handler ──────────────────────────────────────────────────

async function runSafely(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (err) {
    formatAndLogError(err, label);
    process.exitCode = 1;
  }
}
