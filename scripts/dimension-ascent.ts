#!/usr/bin/env tsx
import {
  claimDimension,
  getMatrixStatus,
  mergeScoreProposals,
  writeScoreProposal,
  type MatrixMergePolicy,
} from '../src/core/matrix-development-engine.js';

type Args = Record<string, string | boolean | undefined> & { command?: string };

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const args: Args = { command };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const next = rest[i + 1];
      args[arg.slice(2)] = next && !next.startsWith('--') ? rest[++i] : true;
    }
  }
  return args;
}

function help(): void {
  console.log(`DanteForge matrix development

Usage:
  node scripts/dimension-ascent.mjs status [--top 4]
  node scripts/dimension-ascent.mjs claim --dimension <id-or-number> --agent <name>
  node scripts/dimension-ascent.mjs propose --dimension <id-or-number> --score <n> --agent <name> --rationale <text> [--evidence <path>] [--commit <sha>]
  node scripts/dimension-ascent.mjs merge [--policy harsh-min|latest] [--agent <name>]

Canonical CLI:
  danteforge matrix status --top 4
  danteforge matrix claim --dimension <id-or-number> --agent <name>
  danteforge matrix propose --dimension <id-or-number> --score <n> --agent <name> --rationale "<text>"
  danteforge matrix merge --policy harsh-min
`);
}

function requireArg(args: Args, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === 'help') {
    help();
    return;
  }

  if (args.command === 'status') {
    const status = await getMatrixStatus({ top: Number(args.top ?? 4) });
    console.log(`Matrix: ${status.matrixPath}`);
    console.log(`Overall self score: ${status.overallSelfScore}`);
    console.log(`Matrix hash: ${status.matrixHash.slice(0, 12)}`);
    console.log(`Next ${status.topDimensions.length} dimensions:`);
    for (const dim of status.topDimensions) {
      console.log(`${dim.number}. ${dim.id} (${dim.label}) self=${dim.score} priority=${dim.priority.toFixed(2)}`);
    }
    return;
  }

  if (args.command === 'claim') {
    const claim = await claimDimension({
      dimension: requireArg(args, 'dimension'),
      agent: requireArg(args, 'agent'),
    });
    console.log(`Claimed ${claim.dimensionId} for ${claim.agent}: ${claim.claimPath}`);
    return;
  }

  if (args.command === 'propose') {
    const proposal = await writeScoreProposal({
      dimension: requireArg(args, 'dimension'),
      score: Number(requireArg(args, 'score')),
      agent: requireArg(args, 'agent'),
      rationale: requireArg(args, 'rationale'),
      evidence: typeof args.evidence === 'string' ? args.evidence : undefined,
      commit: typeof args.commit === 'string' ? args.commit : undefined,
    });
    console.log(`Queued score proposal: ${proposal.proposalPath}`);
    return;
  }

  if (args.command === 'merge') {
    const receipt = await mergeScoreProposals({
      policy: (args.policy ?? 'harsh-min') as MatrixMergePolicy,
      agent: typeof args.agent === 'string' ? args.agent : 'matrix-script',
    });
    console.log(`Merged ${receipt.merged.length} dimension update(s) with policy=${receipt.policy}.`);
    for (const item of receipt.merged) {
      console.log(`- ${item.dimensionId}: ${item.before} -> ${item.after}`);
    }
    console.log(`Receipt: ${receipt.receiptPath}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch(error => {
  console.error(`dimension-ascent failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
