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

export type TimeMachineAction = 'commit' | 'verify' | 'restore' | 'query' | 'validate';

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
  roundTripsPerDomain?: number;
  toWorkingTree?: boolean;
  confirm?: boolean;
  json?: boolean;
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
    const report = await runTimeMachineValidation({
      cwd,
      classes: parseClasses(options.classes),
      scale: options.scale ?? 'smoke',
      outDir: options.out,
      delegate52Mode: options.delegate52Mode,
      delegate52Dataset: options.delegate52Dataset,
      budgetUsd: options.budgetUsd,
      maxDomains: options.maxDomains,
      roundTripsPerDomain: options.roundTripsPerDomain,
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
