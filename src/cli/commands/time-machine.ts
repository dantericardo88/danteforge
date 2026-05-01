import {
  createTimeMachineCommit,
  queryTimeMachine,
  restoreTimeMachineCommit,
  verifyTimeMachine,
  type TimeMachineQueryKind,
} from '../../core/time-machine.js';
import {
  runTimeMachineValidation,
  type Delegate52Mode,
  type TimeMachineValidationClass,
  type TimeMachineValidationScale,
} from '../../core/time-machine-validation.js';
import { createDecisionNodeStore } from '../../core/decision-node.js';
import { counterfactualReplay } from '../../core/time-machine-replay.js';
import { logger } from '../../core/logger.js';

export type TimeMachineAction =
  | 'commit'
  | 'verify'
  | 'restore'
  | 'query'
  | 'validate'
  | 'node-list'
  | 'node-trace'
  | 'replay';

export interface TimeMachineCommandOptions {
  action: TimeMachineAction;
  cwd?: string;
  path?: string | string[];
  label?: string;
  commit?: string;
  out?: string;
  kind?: TimeMachineQueryKind;
  classes?: string | string[];
  scale?: TimeMachineValidationScale;
  delegate52Mode?: Delegate52Mode;
  delegate52Dataset?: string;
  budgetUsd?: number;
  maxDomains?: number;
  maxCommits?: number;
  benchmarkTimeBudgetMinutes?: number;
  roundTripsPerDomain?: number;
  mitigateDivergence?: boolean;
  retriesOnDivergence?: number;
  /** Pass 40/45: 'substrate-restore-retry' (default), 'prompt-only-retry', 'no-mitigation', 'smart-retry' (diff-guided feedback). */
  mitigationStrategy?: 'substrate-restore-retry' | 'prompt-only-retry' | 'no-mitigation' | 'smart-retry';
  toWorkingTree?: boolean;
  confirm?: boolean;
  json?: boolean;
  /** node list / node trace / replay: path to the decision-node JSONL store */
  store?: string;
  /** node list: filter by session id */
  session?: string;
  /** node list: filter by timeline id */
  timeline?: string;
  /** node trace / replay: the target node id */
  nodeId?: string;
  /** replay: the altered prompt text */
  alteredInput?: string;
  /** replay: if true, print the plan without executing */
  dryRun?: boolean;
  _stdout?: (line: string) => void;
  _now?: () => string;
}

export async function timeMachine(options: TimeMachineCommandOptions): Promise<void> {
  const out = options._stdout ?? console.log;
  const cwd = options.cwd ?? process.cwd();

  if (options.action === 'commit') {
    const paths = Array.isArray(options.path)
      ? options.path
      : options.path
        ? [options.path]
        : [];
    if (paths.length === 0) throw new Error('time-machine commit requires --path');
    const commit = await createTimeMachineCommit({
      cwd,
      paths,
      label: options.label ?? 'manual',
      now: options._now,
    });
    out(JSON.stringify({
      ok: true,
      commitId: commit.commitId,
      entries: commit.entries.length,
      proof: {
        payloadHash: commit.proof.payloadHash,
        merkleRoot: commit.proof.merkleRoot,
      },
    }, null, 2));
    return;
  }

  if (options.action === 'verify') {
    out(JSON.stringify(await verifyTimeMachine({ cwd }), null, 2));
    return;
  }

  if (options.action === 'restore') {
    if (!options.commit) throw new Error('time-machine restore requires --commit');
    out(JSON.stringify(await restoreTimeMachineCommit({
      cwd,
      commitId: options.commit,
      outDir: options.out,
      toWorkingTree: options.toWorkingTree,
      confirm: options.confirm,
    }), null, 2));
    return;
  }

  if (options.action === 'validate') {
    // When outputting JSON to stdout, redirect all logger output to stderr so it doesn't
    // contaminate the JSON stream captured by comparison/preflight scripts.
    if (options.json) logger.setStderr(true);
    const report = await runTimeMachineValidation({
      cwd,
      classes: parseClasses(options.classes),
      scale: options.scale ?? 'smoke',
      outDir: options.out,
      delegate52Mode: options.delegate52Mode,
      delegate52Dataset: options.delegate52Dataset,
      budgetUsd: options.budgetUsd,
      maxDomains: options.maxDomains,
      maxCommits: options.maxCommits,
      benchmarkTimeBudgetMinutes: options.benchmarkTimeBudgetMinutes,
      roundTripsPerDomain: options.roundTripsPerDomain,
      mitigation: options.mitigateDivergence || options.retriesOnDivergence !== undefined || options.mitigationStrategy !== undefined
        ? {
            restoreOnDivergence: options.mitigateDivergence === true,
            retriesOnDivergence: options.retriesOnDivergence,
            strategy: options.mitigationStrategy,
          }
        : undefined,
      now: options._now,
    });
    if (options.json) {
      out(JSON.stringify(report, null, 2));
    } else {
      out(`Time Machine validation ${report.runId}: ${report.status}`);
      out(`Report: ${report.outDir}`);
    }
    return;
  }

  if (options.action === 'node-list') {
    const storePath = options.store ?? '.danteforge/decision-nodes.jsonl';
    const store = createDecisionNodeStore(storePath);
    try {
      let nodes;
      if (options.session) {
        nodes = await store.getBySession(options.session);
      } else if (options.timeline) {
        nodes = await store.getByTimeline(options.timeline);
      } else {
        throw new Error('time-machine node list requires --session <id> or --timeline <id>');
      }
      if (options.json) {
        out(JSON.stringify(nodes, null, 2));
      } else {
        for (const node of nodes) {
          const prompt = node.input.prompt.slice(0, 80);
          out(
            `[${node.timestamp}] [${node.id}] actor=${node.actor.type}::${node.actor.product}` +
            ` input="${prompt}" success=${node.output.success} cost=$${node.output.costUsd}`,
          );
        }
      }
    } finally {
      await store.close();
    }
    return;
  }

  if (options.action === 'node-trace') {
    if (!options.nodeId) throw new Error('time-machine node trace requires a nodeId argument');
    const storePath = options.store ?? '.danteforge/decision-nodes.jsonl';
    const store = createDecisionNodeStore(storePath);
    try {
      // Build the chain: start node + ancestors (root first)
      const startNode = await store.getById(options.nodeId);
      if (!startNode) throw new Error(`node not found: ${options.nodeId}`);
      const ancestors = await store.getAncestors(options.nodeId);
      // getAncestors returns root→parent; start node is the leaf — reverse to get root→leaf
      const chain = [...ancestors.reverse(), startNode];
      if (options.json) {
        out(JSON.stringify(chain, null, 2));
      } else {
        chain.forEach((node, depth) => {
          const indent = '  '.repeat(depth);
          const prompt = node.input.prompt.slice(0, 60);
          out(`${indent}[${depth}] [${node.id}] ${node.timestamp} "${prompt}"`);
        });
      }
    } finally {
      await store.close();
    }
    return;
  }

  if (options.action === 'replay') {
    if (!options.nodeId) throw new Error('time-machine replay requires a nodeId argument');
    if (!options.alteredInput) throw new Error('time-machine replay requires --input "<altered prompt>"');
    const storePath = options.store ?? '.danteforge/decision-nodes.jsonl';
    const sessionId = options.session ?? 'default';
    const store = createDecisionNodeStore(storePath);
    try {
      const result = await counterfactualReplay(
        {
          branchFromNodeId: options.nodeId,
          alteredInput: options.alteredInput,
          sessionId,
          dryRun: options.dryRun === true,
        },
        store,
        { workspacePath: cwd },
      );
      if (options.json) {
        out(JSON.stringify(result, null, 2));
      } else {
        out(`Original timeline length : ${result.originalPath.length}`);
        out(`Alternate timeline length: ${result.alternatePath.length}`);
        out(`Convergent nodes : ${result.divergence.convergent.length}`);
        out(`Divergent nodes  : ${result.divergence.divergent.length}`);
        out(`Unreachable nodes: ${result.divergence.unreachable.length}`);
        out(`Outcome equivalent: ${result.outcomeEquivalent}`);
        if (result.causalChain.length > 0) {
          out('Causal chain:');
          for (const line of result.causalChain) {
            out(`  ${line}`);
          }
        }
      }
    } finally {
      await store.close();
    }
    return;
  }

  if (!options.kind) throw new Error('time-machine query requires --kind');
  out(JSON.stringify(await queryTimeMachine({
    cwd,
    commitId: options.commit,
    kind: options.kind,
    path: Array.isArray(options.path) ? options.path[0] : options.path,
  }), null, 2));
}

function parseClasses(value: string | string[] | undefined): TimeMachineValidationClass[] | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : value;
  return raw
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(Boolean)
    .map(item => {
      if (!['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(item)) {
        throw new Error(`unknown time-machine validation class: ${item}`);
      }
      return item as TimeMachineValidationClass;
    });
}
