import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { DanteState } from './state.js';
import type { ResidualGapReport } from './residual-gap-miner.js';
import { generateGapReport } from './residual-gap-miner.js';

export interface RunMetadata {
  runId: string;
  sessionId: string;
  correlationId: string;
  startTime: string;
  command: string;
  args: string[];
  cwd: string;
}

export interface EvidenceBundle {
  run: RunMetadata;
  events: EvidenceEvent[];
  inputs: Record<string, any>;
  plan: any;
  reads: FileAccess[];
  writes: FileAccess[];
  commands: CommandExecution[];
  tests: TestResult[];
  gates: GateCheck[];
  receipts: Receipt[];
  verdict: Verdict;
  summary: string;
  gapReport?: ResidualGapReport;
}

export interface EvidenceEvent {
  timestamp: string;
  eventType: string;
  correlationId: string;
  sessionId: string;
  data: Record<string, any>;
}

export interface FileAccess {
  timestamp: string;
  path: string;
  operation: 'read' | 'write';
  size?: number;
  hash?: string;
}

export interface CommandExecution {
  timestamp: string;
  command: string;
  args: string[];
  exitCode: number;
  duration: number;
  output?: string;
  error?: string;
}

export interface TestResult {
  timestamp: string;
  testName: string;
  status: 'pass' | 'fail';
  duration: number;
  error?: string;
}

export interface GateCheck {
  timestamp: string;
  gateName: string;
  status: 'pass' | 'fail';
  reason?: string;
}

export interface Receipt {
  timestamp: string;
  type: string;
  data: Record<string, any>;
}

export interface Verdict {
  timestamp: string;
  status: 'success' | 'failure' | 'partial';
  completionOracle: boolean;
  reason?: string;
  evidenceHash: string;
}

export class RunLedger {
  private runId: string;
  private sessionId: string;
  private correlationId: string;
  private startTime: string;
  private events: EvidenceEvent[] = [];
  private reads: FileAccess[] = [];
  private writes: FileAccess[] = [];
  private commands: CommandExecution[] = [];
  private tests: TestResult[] = [];
  private gates: GateCheck[] = [];
  private receipts: Receipt[] = [];
  private runDir: string;

  constructor(command: string, args: string[], cwd: string) {
    this.runId = randomUUID();
    this.sessionId = randomUUID();
    this.correlationId = randomUUID();
    this.startTime = new Date().toISOString();
    this.runDir = path.join(cwd, '.danteforge', 'runs', this.runId);

    // Initialize with run metadata
    this.events.push({
      timestamp: this.startTime,
      eventType: 'run_start',
      correlationId: this.correlationId,
      sessionId: this.sessionId,
      data: {
        command,
        args,
        cwd,
        runId: this.runId,
      },
    });
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });
  }

  getRunId(): string {
    return this.runId;
  }

  getCorrelationId(): string {
    return this.correlationId;
  }

  logEvent(eventType: string, data: Record<string, any>): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      eventType,
      correlationId: this.correlationId,
      sessionId: this.sessionId,
      data,
    });
  }

  logFileRead(filePath: string, size?: number, hash?: string): void {
    this.reads.push({
      timestamp: new Date().toISOString(),
      path: filePath,
      operation: 'read',
      size,
      hash,
    });
  }

  logFileWrite(filePath: string, size?: number, hash?: string): void {
    this.writes.push({
      timestamp: new Date().toISOString(),
      path: filePath,
      operation: 'write',
      size,
      hash,
    });
  }

  logCommand(command: string, args: string[], exitCode: number, duration: number, output?: string, error?: string): void {
    this.commands.push({
      timestamp: new Date().toISOString(),
      command,
      args,
      exitCode,
      duration,
      output,
      error,
    });
  }

  logTest(testName: string, status: 'pass' | 'fail', duration: number, error?: string): void {
    this.tests.push({
      timestamp: new Date().toISOString(),
      testName,
      status,
      duration,
      error,
    });
  }

  logGateCheck(gateName: string, status: 'pass' | 'fail', reason?: string): void {
    this.gates.push({
      timestamp: new Date().toISOString(),
      gateName,
      status,
      reason,
    });
  }

  addReceipt(type: string, data: Record<string, any>): void {
    this.receipts.push({
      timestamp: new Date().toISOString(),
      type,
      data,
    });
  }

  async finalize(inputs: Record<string, any>, plan: any, verdict: Omit<Verdict, 'timestamp' | 'evidenceHash'>, state?: DanteState): Promise<string> {
    const finalVerdict: Verdict = {
      ...verdict,
      timestamp: new Date().toISOString(),
      evidenceHash: '', // Will be computed
    };

    let bundle: EvidenceBundle = {
      run: {
        runId: this.runId,
        sessionId: this.sessionId,
        correlationId: this.correlationId,
        startTime: this.startTime,
        command: this.events[0].data.command,
        args: this.events[0].data.args,
        cwd: this.events[0].data.cwd,
      },
      events: this.events,
      inputs,
      plan,
      reads: this.reads,
      writes: this.writes,
      commands: this.commands,
      tests: this.tests,
      gates: this.gates,
      receipts: this.receipts,
      verdict: finalVerdict,
      summary: '', // Will be set after
    };

    // Generate summary after bundle is created
    bundle.summary = this.generateSummary(bundle);

    // Generate residual gap analysis if state provided
    let gapReport: ResidualGapReport | undefined;
    if (state) {
      gapReport = await generateGapReport(bundle, state, path.join(this.runDir, 'gap-analysis.json'));
    }

    // Compute evidence hash (exclude the hash field to avoid self-reference)
    const bundleForHash = { ...bundle, verdict: { ...finalVerdict, evidenceHash: '' } };
    const bundleJson = JSON.stringify(bundleForHash, null, 2);
    const crypto = await import('crypto');
    finalVerdict.evidenceHash = crypto.default.createHash('sha256').update(bundleJson).digest('hex');
    bundle.verdict = finalVerdict;

    // Write bundle files
    await this.writeBundle(bundle);

    // Write gap report to bundle if generated
    if (gapReport) {
      bundle.gapReport = gapReport;
      await fs.writeFile(path.join(this.runDir, 'bundle-with-gaps.json'), JSON.stringify(bundle, null, 2));
    }

    return this.runId;
  }

  private async writeBundle(bundle: EvidenceBundle): Promise<void> {
    const bundleJson = JSON.stringify(bundle, null, 2);

    await fs.writeFile(path.join(this.runDir, 'bundle.json'), bundleJson);
    await fs.writeFile(path.join(this.runDir, 'run.json'), JSON.stringify(bundle.run, null, 2));
    await fs.writeFile(path.join(this.runDir, 'events.jsonl'), bundle.events.map(e => JSON.stringify(e)).join('\n'));
    await fs.writeFile(path.join(this.runDir, 'inputs.json'), JSON.stringify(bundle.inputs, null, 2));
    await fs.writeFile(path.join(this.runDir, 'plan.json'), JSON.stringify(bundle.plan, null, 2));
    await fs.writeFile(path.join(this.runDir, 'reads.json'), JSON.stringify(bundle.reads, null, 2));
    await fs.writeFile(path.join(this.runDir, 'writes.json'), JSON.stringify(bundle.writes, null, 2));
    await fs.writeFile(path.join(this.runDir, 'commands.json'), JSON.stringify(bundle.commands, null, 2));
    await fs.writeFile(path.join(this.runDir, 'tests.json'), JSON.stringify(bundle.tests, null, 2));
    await fs.writeFile(path.join(this.runDir, 'gates.json'), JSON.stringify(bundle.gates, null, 2));
    await fs.writeFile(path.join(this.runDir, 'receipts.json'), JSON.stringify(bundle.receipts, null, 2));
    await fs.writeFile(path.join(this.runDir, 'verdict.json'), JSON.stringify(bundle.verdict, null, 2));
    await fs.writeFile(path.join(this.runDir, 'summary.md'), bundle.summary);
  }

  private generateSummary(bundle: EvidenceBundle): string {
    const totalCommands = bundle.commands.length;
    const failedCommands = bundle.commands.filter(c => c.exitCode !== 0).length;
    const totalTests = bundle.tests.length;
    const passedTests = bundle.tests.filter(t => t.status === 'pass').length;
    const totalGates = bundle.gates.length;
    const passedGates = bundle.gates.filter(g => g.status === 'pass').length;

    return `# Run Summary: ${bundle.run.runId}

**Status:** ${bundle.verdict.status}
**Completion Oracle:** ${bundle.verdict.completionOracle ? 'PASS' : 'FAIL'}
${bundle.verdict.reason ? `**Reason:** ${bundle.verdict.reason}` : ''}

## Execution Metrics
- **Commands:** ${totalCommands} total, ${failedCommands} failed
- **Tests:** ${passedTests}/${totalTests} passed
- **Gates:** ${passedGates}/${totalGates} passed
- **Files Read:** ${bundle.reads.length}
- **Files Written:** ${bundle.writes.length}
- **Events:** ${bundle.events.length}

## Timestamps
- **Started:** ${bundle.run.startTime}
- **Finished:** ${bundle.verdict.timestamp}

## Evidence Hash
${bundle.verdict.evidenceHash}
`;
  }
}

export async function loadRunBundle(runId: string, cwd: string): Promise<EvidenceBundle | null> {
  try {
    const runDir = path.join(cwd, '.danteforge', 'runs', runId);
    const bundlePath = path.join(runDir, 'bundle.json');
    const bundleJson = await fs.readFile(bundlePath, 'utf8');
    return JSON.parse(bundleJson);
  } catch {
    return null;
  }
}

export async function listRuns(cwd: string): Promise<string[]> {
  try {
    const runsDir = path.join(cwd, '.danteforge', 'runs');
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
  } catch {
    return [];
  }
}