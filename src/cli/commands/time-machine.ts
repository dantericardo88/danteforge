import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
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
import { counterfactualReplay, diffTimelines, buildCausalChain, type PipelineRunContext, type PipelineRunResult, type CounterfactualReplayResult } from '../../core/time-machine-replay.js';
import { renderAsciiTimeline } from '../../core/time-machine-timeline.js';
import { classifyNodes } from '../../core/time-machine-causal-attribution.js';
import {
  evaluateAttributionLabels,
  readAttributionLabelFile,
  writeAttributionEvaluationReport,
} from '../../core/time-machine-attribution-eval.js';
import { buildTimeMachineCorpusBundle } from '../../core/time-machine-corpus.js';
import { runLabelSession } from '../../core/time-machine-labeler.js';
import { callLLM } from '../../core/llm.js';
import { logger } from '../../core/logger.js';

export type TimeMachineAction =
  | 'commit'
  | 'verify'
  | 'restore'
  | 'query'
  | 'validate'
  | 'node-list'
  | 'node-trace'
  | 'replay'
  | 'node-attribute'
  | 'node-eval-attribution'
  | 'node-build-corpus'
  | 'node-label'
  | 'timeline';

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
  delegate52ResumeFrom?: string;
  priorSpendUsd?: number;
  maxDomains?: number;
  maxCommits?: number;
  benchmarkTimeBudgetMinutes?: number;
  roundTripsPerDomain?: number;
  mitigateDivergence?: boolean;
  retriesOnDivergence?: number;
  /** Pass 40/45/46/47 mitigation strategy. */
  mitigationStrategy?: 'substrate-restore-retry' | 'prompt-only-retry' | 'no-mitigation' | 'smart-retry' | 'edit-journal' | 'surgical-patch';
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
  /** replay: if true, run the full DanteForge magic pipeline instead of a single LLM call */
  pipelineMode?: boolean;
  /** node-attribute: branch-point node id */
  branchNodeId?: string;
  /** node-attribute: if true, escalate low-confidence attributions to LLM */
  withLlm?: boolean;
  /** node-eval-attribution: JSON label file */
  labelsFile?: string;
  /** node-build-corpus: minimum replayed sessions required by the evidence gate */
  minSessions?: number;
  /** node-build-corpus: minimum downstream labels required by the evidence gate */
  minLabels?: number;
  /** node-label: path to label-candidates.json (from build-corpus) */
  candidatesFile?: string;
  /** node-label: accept all suggestions automatically without prompting */
  autoLabel?: boolean;
  /** node-label: max candidates to label in this session */
  labelLimit?: number;
  /** timeline: path to a stored CounterfactualReplayResult JSON */
  resultFile?: string;
  /** timeline: original timeline id (for store-reconstruction mode) */
  originalTimeline?: string;
  /** timeline: alternate timeline id (for store-reconstruction mode) */
  alternateTimeline?: string;
  /** timeline: terminal width for rendering (default 120) */
  timelineWidth?: number;
  /** test seam: deterministic alternate timeline id */
  _newTimelineId?: string;
  /** test seam: injected isolated replay pipeline runner */
  _runReplayPipeline?: (input: {
    input: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    storePath: string;
    sessionId: string;
    timelineId: string;
    parentNodeId: string;
    replayDir: string;
  }) => Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;
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
      delegate52ResumeFrom: options.delegate52ResumeFrom,
      priorSpendUsd: options.priorSpendUsd,
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
    const storePath = path.resolve(cwd, options.store ?? '.danteforge/decision-nodes.jsonl');
    const sessionId = options.session ?? 'default';
    const store = createDecisionNodeStore(storePath);

    const replayLlmCaller = async (prompt: string) => callLLM(prompt);

    const newTimelineId = options._newTimelineId ?? randomUUID();
    const replayDir = path.join(cwd, '.danteforge', 'time-machine', 'replays', newTimelineId);
    const replayWorkspace = path.join(replayDir, 'workspace');

    let replayPipelineCaller: ((input: string, context: PipelineRunContext) => Promise<PipelineRunResult>) | undefined;
    if (options.pipelineMode) {
      replayPipelineCaller = async (input: string, context: PipelineRunContext): Promise<PipelineRunResult> => {
        const runStart = Date.now();
        const env = {
          ...process.env,
          DANTEFORGE_DECISION_STORE: storePath,
          DANTEFORGE_DECISION_SESSION_ID: context.sessionId,
          DANTEFORGE_DECISION_TIMELINE_ID: context.timelineId,
          DANTEFORGE_DECISION_PARENT_ID: context.parentNodeId,
        };
        const pipeline = await (options._runReplayPipeline ?? runReplayPipelineChild)({
          input,
          cwd: replayWorkspace,
          env,
          storePath,
          sessionId: context.sessionId,
          timelineId: context.timelineId,
          parentNodeId: context.parentNodeId,
          replayDir,
        });
        const runStartIso = new Date(runStart).toISOString();
        const replayStore = createDecisionNodeStore(storePath);
        const timelineNodes = await replayStore.getByTimeline(context.timelineId);
        await replayStore.close();
        const newNodes = timelineNodes
          .filter(n => n.sessionId === context.sessionId && n.timestamp >= runStartIso)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return {
          nodes: newNodes,
          costUsd: newNodes.reduce((sum, n) => sum + n.output.costUsd, 0),
          nodesAlreadyRecorded: true,
          artifacts: {
            replayDir,
            workspacePath: replayWorkspace,
            stdoutPath: await writeReplayArtifact(replayDir, 'pipeline-stdout.txt', pipeline.stdout),
            stderrPath: await writeReplayArtifact(replayDir, 'pipeline-stderr.txt', pipeline.stderr),
            stdoutExcerpt: excerpt(pipeline.stdout),
            stderrExcerpt: excerpt(pipeline.stderr),
            pipelineExitCode: pipeline.exitCode,
          },
        };
      };
    }

    try {
      if (options.pipelineMode && options.dryRun !== true) {
        await prepareReplayWorkspace(cwd, replayWorkspace);
      }
      const result = await counterfactualReplay(
        {
          branchFromNodeId: options.nodeId,
          alteredInput: options.alteredInput,
          sessionId,
          dryRun: options.dryRun === true,
          newTimelineId,
        },
        store,
        {
          workspacePath: cwd,
          restoreOutDir: options.pipelineMode ? replayWorkspace : undefined,
          replayDir: options.pipelineMode ? replayDir : undefined,
          storePath,
          llmCaller: replayLlmCaller,
          pipelineCaller: replayPipelineCaller,
        },
      );
      if (options.pipelineMode && result.artifacts) {
        result.artifacts.resultPath = await writeReplayArtifact(replayDir, 'counterfactual-result.json', JSON.stringify(result, null, 2));
      }
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

  if (options.action === 'node-attribute') {
    const nodeId = options.branchNodeId ?? options.nodeId;
    if (!nodeId) throw new Error('time-machine node-attribute requires a nodeId argument');
    const attrSession = options.session ?? 'default';
    const storePath = options.store ?? '.danteforge/decision-nodes.jsonl';
    const store = createDecisionNodeStore(storePath);
    try {
      const branchPoint = await store.getById(nodeId);
      if (!branchPoint) throw new Error(`node not found: ${nodeId}`);
      const sessionNodes = await store.getBySession(attrSession);
      const branchTs = new Date(branchPoint.timestamp).getTime();
      const originalTimeline = sessionNodes
        .filter(n => n.timelineId === branchPoint.timelineId && new Date(n.timestamp).getTime() > branchTs)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const attrResult = await classifyNodes(
        branchPoint,
        originalTimeline,
        [],
        options.withLlm ? { llmCaller: async (prompt: string) => callLLM(prompt) } : undefined,
      );
      if (options.json) {
        out(JSON.stringify(attrResult, null, 2));
      } else {
        out(`Causal attribution for node ${nodeId}:`);
        out(`  Branch point: "${branchPoint.input.prompt.slice(0, 80)}"`);
        out(`  Original timeline: ${originalTimeline.length} node(s)`);
        for (const n of attrResult.originalNodes) {
          out(`  [${n.classification}] (conf=${n.confidence.toFixed(2)}) "${n.node.input.prompt.slice(0, 60)}"`);
        }
        out(`  Timelines converged: ${attrResult.converged}`);
      }
    } finally {
      await store.close();
    }
    return;
  }

  if (options.action === 'node-eval-attribution') {
    if (!options.labelsFile) throw new Error('time-machine node eval-attribution requires --labels <file>');
    const labelsFile = path.resolve(cwd, options.labelsFile);
    const labels = await readAttributionLabelFile(labelsFile);
    const storePath = path.resolve(cwd, options.store ?? '.danteforge/decision-nodes.jsonl');
    const store = createDecisionNodeStore(storePath);
    try {
      const branchPoint = await store.getById(labels.branchPointId);
      if (!branchPoint) throw new Error(`node not found: ${labels.branchPointId}`);
      const originalTimelineId = labels.originalTimelineId ?? branchPoint.timelineId;
      const alternateTimelineId = labels.alternateTimelineId;
      const originalTimeline = (await store.getByTimeline(originalTimelineId))
        .filter(n => n.id !== branchPoint.id)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const alternateTimeline = alternateTimelineId
        ? (await store.getByTimeline(alternateTimelineId))
          .filter(n => n.id !== branchPoint.id)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        : [];
      const report = evaluateAttributionLabels({
        branchPoint,
        originalTimeline,
        alternateTimeline,
        labels: labels.labels,
      });
      if (options.out) {
        await writeAttributionEvaluationReport(path.resolve(cwd, options.out), report);
      }
      if (options.json) {
        out(JSON.stringify(report, null, 2));
      } else {
        out(`Attribution evaluation for branch ${report.branchPointId}: ${report.passed ? 'passed' : 'failed'}`);
        out(`  labels: ${report.labelCount}`);
        out(`  precision: ${(report.precision * 100).toFixed(1)}%`);
        out(`  recall: ${(report.recall * 100).toFixed(1)}%`);
        out(`  false-independent: ${(report.falseIndependentRate * 100).toFixed(1)}%`);
        if (options.out) out(`  report: ${path.resolve(cwd, options.out)}`);
      }
    } finally {
      await store.close();
    }
    return;
  }

  if (options.action === 'node-build-corpus') {
    const timestamp = options._now?.() ?? new Date().toISOString();
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const outDir = path.resolve(cwd, options.out ?? path.join('.danteforge', 'evidence', 'time-machine-corpus', safeTimestamp));
    const report = await buildTimeMachineCorpusBundle({
      storePath: path.resolve(cwd, options.store ?? '.danteforge/decision-nodes.jsonl'),
      outDir,
      minSessions: options.minSessions,
      minLabels: options.minLabels,
      now: options._now,
    });
    if (options.json) {
      out(JSON.stringify(report, null, 2));
    } else {
      out(`Time Machine corpus bundle: ${report.readyForHumanAdjudication ? 'ready for adjudication' : 'insufficient evidence'}`);
      out(`  replayed sessions: ${report.replayedSessionCount}/${report.minSessions}`);
      out(`  label candidates:   ${report.labelCandidateCount}/${report.minLabels}`);
      out(`  out:                ${report.outDir}`);
    }
    return;
  }

  if (options.action === 'node-label') {
    const candidates = options.candidatesFile
      ? path.resolve(cwd, options.candidatesFile)
      : path.join(cwd, '.danteforge', 'evidence', 'time-machine-corpus', 'label-candidates.json');
    const outFile = options.out
      ? path.resolve(cwd, options.out)
      : path.join(cwd, '.danteforge', 'labels.json');
    const result = await runLabelSession({
      candidatesFile: candidates,
      outFile,
      auto: options.autoLabel,
      limit: options.labelLimit,
      out: options._stdout,
    });
    if (options.json) {
      out(JSON.stringify(result, null, 2));
    }
    return;
  }

  if (options.action === 'timeline') {
    // Mode 1: load from stored result file
    if (options.resultFile) {
      const raw = await import('node:fs/promises').then(fs => fs.readFile(options.resultFile!, 'utf-8'));
      const result = JSON.parse(raw) as CounterfactualReplayResult;
      if (options.json) {
        out(JSON.stringify(result, null, 2));
      } else {
        out(renderAsciiTimeline(result, options.timelineWidth ?? 120));
      }
      return;
    }
    // Mode 2: reconstruct from store
    if (options.originalTimeline && options.alternateTimeline && options.session) {
      const storePath = options.store ?? '.danteforge/decision-nodes.jsonl';
      const store = createDecisionNodeStore(storePath);
      try {
        const origNodes = await store.getByTimeline(options.originalTimeline);
        const altNodes = await store.getByTimeline(options.alternateTimeline);
        if (origNodes.length === 0) throw new Error(`No nodes found for timeline: ${options.originalTimeline}`);
        const branchPoint = origNodes[0];
        const divergence = diffTimelines(origNodes.slice(1), altNodes);
        const replayResult: CounterfactualReplayResult = {
          originalTimelineId: options.originalTimeline,
          newTimelineId: options.alternateTimeline,
          branchPoint,
          originalPath: origNodes.slice(1),
          alternatePath: altNodes,
          divergence,
          outcomeEquivalent: origNodes.length > 0 && altNodes.length > 0 &&
            JSON.stringify(origNodes[origNodes.length - 1].output.result) === JSON.stringify(altNodes[altNodes.length - 1].output.result),
          causalChain: buildCausalChain(branchPoint, divergence.divergent),
          costUsd: 0,
          durationMs: 0,
        };
        if (options.json) {
          out(JSON.stringify(replayResult, null, 2));
        } else {
          out(renderAsciiTimeline(replayResult, options.timelineWidth ?? 120));
        }
      } finally {
        await store.close();
      }
      return;
    }
    throw new Error('time-machine node timeline requires either --result <file> or --session + --original + --alternate');
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

const REPLAY_COPY_EXCLUDE = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.pytest_cache',
]);

async function prepareReplayWorkspace(sourceRoot: string, replayWorkspace: string): Promise<void> {
  await fs.mkdir(replayWorkspace, { recursive: true });
  await copyReplayTree(path.resolve(sourceRoot), path.resolve(replayWorkspace), path.resolve(replayWorkspace));
}

async function copyReplayTree(source: string, dest: string, replayWorkspace: string): Promise<void> {
  const relToReplay = path.relative(replayWorkspace, source);
  if (relToReplay === '' || (!relToReplay.startsWith('..') && !path.isAbsolute(relToReplay))) return;

  const base = path.basename(source);
  if (REPLAY_COPY_EXCLUDE.has(base)) return;

  const rel = path.relative(process.cwd(), source).replace(/\\/g, '/');
  if (rel.includes('.danteforge/time-machine/replays')) return;

  const stats = await fs.stat(source);
  if (stats.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(source);
    for (const entry of entries) {
      await copyReplayTree(path.join(source, entry), path.join(dest, entry), replayWorkspace);
    }
    return;
  }
  if (stats.isFile()) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
  }
}

async function runReplayPipelineChild(input: {
  input: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  replayDir: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const cliPath = path.resolve(process.cwd(), 'dist', 'index.js');
  if (!existsSync(cliPath)) {
    throw new Error(`pipeline replay requires a built CLI at ${cliPath}; run npm run build first`);
  }

  const started = Date.now();
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cliPath, 'magic', input.input, '--yes'], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', rejectRun);
    child.on('exit', code => resolveRun({ exitCode: code ?? 1, stdout, stderr }));
  });
  const durationMs = Date.now() - started;
  await writeReplayArtifact(input.replayDir, 'pipeline-run.json', JSON.stringify({ exitCode: result.exitCode, durationMs }, null, 2));
  if (result.exitCode !== 0) {
    throw new Error(`pipeline replay failed with exit code ${result.exitCode}; see ${input.replayDir}`);
  }
  return { ...result, durationMs };
}

async function writeReplayArtifact(replayDir: string, name: string, content: string): Promise<string> {
  await fs.mkdir(replayDir, { recursive: true });
  const target = path.join(replayDir, name);
  await fs.writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  return target;
}

function excerpt(value: string, max = 2000): string {
  return value.length <= max ? value : value.slice(0, max);
}
