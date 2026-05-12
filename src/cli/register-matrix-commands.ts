// Matrix Kernel CLI surface — registers all `danteforge matrix <subcommand>` actions.
//
// This is the user entry point to the Matrix Kernel engines. Built on the
// lazy-load pattern used by register-late-commands.ts. Engines and courts are
// imported dynamically inside actions so cold-start cost is paid lazily.
import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';
import { registerMatrixExecutionCommands } from './register-matrix-execution-commands.js';

export function registerMatrixCommands(program: Command): void {
  const matrix = program
    .command('matrix-kernel')
    .description('Matrix Kernel — closed-loop verified multi-agent engineering control plane');

  registerLifecycle(matrix);
  registerGraphs(matrix);
  registerPlanning(matrix);
  registerLeases(matrix);
  registerMatrixExecutionCommands(matrix);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function registerLifecycle(matrix: Command): void {
  matrix
    .command('init')
    .description('Initialize .danteforge/matrix/ scaffolding')
    .option('--cwd <path>', 'Project root (default: current directory)')
    .action(async (opts) => runSafely('matrix-kernel:init', async () => {
      const { mkdir } = await import('node:fs/promises');
      const path = await import('node:path');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      await mkdir(path.join(cwd, '.danteforge', 'matrix'), { recursive: true });
      await mkdir(path.join(cwd, '.danteforge', 'matrix', 'mailbox'), { recursive: true });
      await mkdir(path.join(cwd, '.danteforge', 'matrix', 'leases'), { recursive: true });
      logger.success(`[matrix-kernel] Initialized .danteforge/matrix/ in ${cwd}`);
    }));

  matrix
    .command('status')
    .description('Show current Matrix run state + report paths')
    .option('--cwd <path>', 'Project root (default: current directory)')
    .action(async (opts) => runSafely('matrix-kernel:status', async () => {
      const { stat } = await import('node:fs/promises');
      const path = await import('node:path');
      const { MATRIX_REPORT_PATHS } = await import('../matrix/types/index.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      logger.info('[matrix-kernel] Status:');
      for (const [name, rel] of Object.entries(MATRIX_REPORT_PATHS)) {
        try {
          const fullPath = path.join(cwd, rel);
          const st = await stat(fullPath);
          logger.info(`  ✓ ${name.padEnd(20)} ${rel}  (${st.size} bytes)`);
        } catch {
          logger.info(`  · ${name.padEnd(20)} ${rel}  (not yet generated)`);
        }
      }
    }));
}

// ── Graph commands ──────────────────────────────────────────────────────────

function registerGraphs(matrix: Command): void {
  matrix
    .command('map-project')
    .description('Build the Project Graph: scans source files, extracts symbols, tags protected + ownership')
    .option('--cwd <path>', 'Project root (default: current directory)')
    .action(async (opts) => runSafely('matrix-kernel:map-project', async () => {
      const { buildProjectGraph, writeProjectGraph } = await import('../matrix/engines/project-graph.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      logger.info(`[matrix-kernel] Mapping project at ${cwd}...`);
      const graph = await buildProjectGraph({ cwd });
      const outPath = await writeProjectGraph(graph, cwd);
      const fileNodes = graph.nodes.filter(n => n.type !== 'module').length;
      const moduleNodes = graph.nodes.filter(n => n.type === 'module').length;
      const protectedCount = graph.nodes.filter(n => n.protected).length;
      logger.success(
        `[matrix-kernel] Mapped: ${graph.nodes.length} nodes (${fileNodes} files, ${moduleNodes} modules, ${protectedCount} protected)`,
      );
      logger.info(`[matrix-kernel] Wrote ${outPath}`);
    }));

  matrix
    .command('synthesize-dimensions')
    .description('Generate the Dimension Graph from the existing compete-matrix')
    .option('--cwd <path>', 'Project root (default: current directory)')
    .option('--target <n>', 'Target score per dimension (default: 9.0)', parseFloat)
    .action(async (opts) => runSafely('matrix-kernel:synthesize-dimensions', async () => {
      const { synthesizeDimensions, writeDimensionGraph } = await import('../matrix/engines/dimension-synthesizer.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      const target = (opts.target as number | undefined) ?? 9.0;
      const graph = await synthesizeDimensions({ cwd, targetScore: target });
      const outPath = await writeDimensionGraph(graph, cwd);
      logger.success(
        `[matrix-kernel] Synthesized ${graph.nodes.length} dimensions, ${graph.competitors.length} competitors`,
      );
      logger.info(`[matrix-kernel] Wrote ${outPath}`);
      // Show top 5 gap dimensions
      const sorted = [...graph.nodes].sort((a, b) => b.gapVsTarget - a.gapVsTarget);
      logger.info('[matrix-kernel] Top gaps:');
      for (const dim of sorted.slice(0, 5)) {
        logger.info(`  ${dim.dimensionId.padEnd(35)} self=${dim.currentScore.toFixed(1)}  gap=${dim.gapVsTarget.toFixed(1)}`);
      }
    }));
}

// ── Planning ────────────────────────────────────────────────────────────────

function registerPlanning(matrix: Command): void {
  matrix
    .command('work-packets')
    .description('Generate Work Packets from the Dimension Graph + Project Graph')
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:work-packets', async () => {
      const { buildProjectGraph } = await import('../matrix/engines/project-graph.js');
      const { synthesizeDimensions } = await import('../matrix/engines/dimension-synthesizer.js');
      const { generateWorkPackets, writeWorkGraph } = await import('../matrix/engines/work-packet-generator.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      const projectGraph = await buildProjectGraph({ cwd });
      const dimensionGraph = await synthesizeDimensions({ cwd, projectGraph });
      const graph = generateWorkPackets({
        dimensionGraph, projectGraph,
        globalForbiddenPaths: projectGraph.project.protectedPaths,
      });
      const outPath = await writeWorkGraph(graph, cwd);
      logger.success(`[matrix-kernel] Generated ${graph.packets.length} work packet(s)`);
      logger.info(`[matrix-kernel] Wrote ${outPath}`);
      for (const packet of graph.packets.slice(0, 10)) {
        logger.info(`  ${packet.id.padEnd(50)} ${packet.riskLevel.padEnd(8)} ${packet.dimensionId}`);
      }
    }));

  matrix
    .command('simulate')
    .description('Plan a Matrix run without executing any agents (dry-run)')
    .option('--cwd <path>', 'Project root')
    .option('--max-agents <n>', 'Requested parallel agent count (default: 5)', parseInt)
    .action(async (opts) => runSafely('matrix-kernel:simulate', async () => {
      const { buildProjectGraph } = await import('../matrix/engines/project-graph.js');
      const { synthesizeDimensions } = await import('../matrix/engines/dimension-synthesizer.js');
      const { generateWorkPackets } = await import('../matrix/engines/work-packet-generator.js');
      const { buildDependencyGraph } = await import('../matrix/engines/dependency-graph.js');
      const { loadOwnershipMap } = await import('../matrix/engines/ownership-map.js');
      const { scanConflicts } = await import('../matrix/engines/conflict-radar.js');
      const { simulate, writeSimulationPlan } = await import('../matrix/engines/simulation.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      const maxAgents = (opts.maxAgents as number | undefined) ?? 5;

      logger.info(`[matrix-kernel] Simulating Matrix run with up to ${maxAgents} agents...`);
      const projectGraph = await buildProjectGraph({ cwd });
      const dimensionGraph = await synthesizeDimensions({ cwd, projectGraph });
      const workGraph = generateWorkPackets({
        dimensionGraph, projectGraph,
        globalForbiddenPaths: projectGraph.project.protectedPaths,
      });
      const dependencyGraph = buildDependencyGraph({ workGraph });
      const ownershipMap = await loadOwnershipMap({ cwd });
      const conflictReport = scanConflicts({
        workPackets: workGraph.packets, ownershipMap,
      });
      const plan = simulate({
        projectGraph, dimensionGraph, workGraph, dependencyGraph,
        conflictReport, requestedAgents: maxAgents,
      });
      const outPath = await writeSimulationPlan(plan, cwd);

      logger.info('');
      logger.success(`[matrix-kernel] Simulation Plan — ${plan.waves.length} wave(s)`);
      logger.info(`  Requested agents:    ${plan.safeParallelism.requestedAgents}`);
      logger.info(`  Safe agents now:     ${plan.safeParallelism.safeAgentsNow}`);
      logger.info(`  Recommended wave:    ${plan.safeParallelism.recommendedWaveSize}`);
      logger.info(`  Blocked packets:     ${plan.safeParallelism.blockedWorkPackets}`);
      logger.info(`  High-conflict:       ${plan.safeParallelism.highConflictPackets}`);
      logger.info(`  Predicted conflicts: ${plan.riskSummary.predictedConflicts}`);
      logger.info(`  Approvals needed:    ${plan.riskSummary.requiredHumanApprovals}`);
      logger.info(`  Total tokens (est):  ${plan.totalEstimatedTokens.toLocaleString()}`);
      logger.info(`  USD range:           $${plan.totalEstimatedUsdLow.toFixed(2)}–$${plan.totalEstimatedUsdHigh.toFixed(2)}`);
      logger.info('');
      logger.info('  Reasoning:');
      for (const r of plan.safeParallelism.reasoning) logger.info(`    · ${r}`);
      logger.info('');
      logger.info(`[matrix-kernel] Wrote ${outPath}`);
    }));
}

// ── Lease commands (read-only inspection for MVP) ──────────────────────────

function registerLeases(matrix: Command): void {
  matrix
    .command('leases-list')
    .description('List all current leases')
    .option('--cwd <path>', 'Project root')
    .action(async (opts) => runSafely('matrix-kernel:leases:list', async () => {
      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const { MATRIX_REPORT_PATHS } = await import('../matrix/types/index.js');
      const cwd = (opts.cwd as string | undefined) ?? process.cwd();
      try {
        const raw = await readFile(path.join(cwd, MATRIX_REPORT_PATHS.leaseGraph), 'utf8');
        const data = JSON.parse(raw) as { leases?: Array<{ id: string; provider: string; status: string; workPacketId: string; branch: string }> };
        const leases = data.leases ?? [];
        if (leases.length === 0) {
          logger.info('[matrix-kernel] No leases recorded yet. Run `matrix-kernel simulate` then issue leases.');
          return;
        }
        logger.info(`[matrix-kernel] ${leases.length} lease(s):`);
        for (const lease of leases) {
          logger.info(`  ${lease.id.padEnd(40)} ${lease.status.padEnd(10)} ${lease.provider.padEnd(10)} ${lease.branch}`);
        }
      } catch {
        logger.info('[matrix-kernel] No lease graph found. Run `matrix-kernel simulate` to generate one.');
      }
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
