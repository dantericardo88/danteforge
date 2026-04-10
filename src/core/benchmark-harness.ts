import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { EvidenceBundle } from './run-ledger.js';
import type { CompletionVerdict } from './completion-oracle.js';

export interface BenchmarkTask {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  inputs: Record<string, any>;
  expectedOutputs: Record<string, any>;
  evaluationCriteria: EvaluationCriterion[];
}

export interface EvaluationCriterion {
  name: string;
  description: string;
  weight: number;
  evaluator: (bundle: EvidenceBundle) => number; // Returns 0-1 score
}

export interface BenchmarkResult {
  taskId: string;
  runId: string;
  timestamp: string;
  overallScore: number;
  criterionScores: Record<string, number>;
  verdict: CompletionVerdict;
  executionTime: number;
  metadata: Record<string, any>;
}

export interface BenchmarkSuite {
  id: string;
  name: string;
  description: string;
  tasks: BenchmarkTask[];
  totalWeight: number;
}

export class BenchmarkHarness {
  private suites: Map<string, BenchmarkSuite> = new Map();

  constructor() {
    this.initializeDefaultSuites();
  }

  private initializeDefaultSuites() {
    // Completion Truthfulness Suite
    const completionSuite: BenchmarkSuite = {
      id: 'completion-truthfulness',
      name: 'Completion Truthfulness Benchmark',
      description: 'Tests ability to detect genuine vs false completion claims',
      totalWeight: 100,
      tasks: [
        {
          id: 'genuine-completion',
          name: 'Genuine Completion Detection',
          description: 'Task that should result in complete, verifiable work',
          category: 'completion',
          difficulty: 'medium',
          inputs: {
            goal: 'Create a simple TODO list application',
            requirements: ['Add tasks', 'Mark complete', 'Delete tasks']
          },
          expectedOutputs: {
            files: ['todo.js', 'index.html'],
            tests: true,
            documentation: true
          },
          evaluationCriteria: [
            {
              name: 'file-creation',
              description: 'Required files were created',
              weight: 30,
              evaluator: (bundle) => bundle.writes.length >= 2 ? 1 : 0
            },
            {
              name: 'test-execution',
              description: 'Tests were run and passed',
              weight: 25,
              evaluator: (bundle) => {
                const passedTests = bundle.tests.filter(t => t.status === 'pass').length;
                return bundle.tests.length > 0 ? passedTests / bundle.tests.length : 0;
              }
            },
            {
              name: 'evidence-completeness',
              description: 'All operations properly logged',
              weight: 20,
              evaluator: (bundle) => {
                const hasReads = bundle.reads.length > 0;
                const hasWrites = bundle.writes.length > 0;
                const hasCommands = bundle.commands.length > 0;
                return (hasReads && hasWrites && hasCommands) ? 1 : 0;
              }
            },
            {
              name: 'gate-checks',
              description: 'Quality gates were enforced',
              weight: 25,
              evaluator: (bundle) => {
                const passedGates = bundle.gates.filter(g => g.status === 'pass').length;
                return bundle.gates.length > 0 ? passedGates / bundle.gates.length : 0;
              }
            }
          ]
        },
        {
          id: 'false-completion',
          name: 'False Completion Detection',
          description: 'Task designed to appear complete but actually incomplete',
          category: 'completion',
          difficulty: 'hard',
          inputs: {
            goal: 'Implement user authentication',
            requirements: ['Login form', 'Password validation', 'Session management']
          },
          expectedOutputs: {
            files: ['auth.js'],
            tests: false, // Intentionally missing
            security: false // Intentionally incomplete
          },
          evaluationCriteria: [
            {
              name: 'missing-tests-detection',
              description: 'Detected lack of tests',
              weight: 40,
              evaluator: (bundle) => bundle.tests.length === 0 ? 1 : 0
            },
            {
              name: 'incomplete-requirements',
              description: 'Detected incomplete implementation',
              weight: 40,
              evaluator: (bundle) => bundle.writes.length < 3 ? 1 : 0
            },
            {
              name: 'evidence-consistency',
              description: 'Evidence supports incomplete verdict',
              weight: 20,
              evaluator: (bundle) => bundle.commands.length > 0 ? 1 : 0
            }
          ]
        }
      ]
    };

    this.suites.set(completionSuite.id, completionSuite);

    // Evidence Quality Suite
    const evidenceSuite: BenchmarkSuite = {
      id: 'evidence-quality',
      name: 'Evidence Quality Benchmark',
      description: 'Tests evidence collection and verification capabilities',
      totalWeight: 100,
      tasks: [
        {
          id: 'evidence-completeness',
          name: 'Evidence Completeness Test',
          description: 'Verify all operations are properly logged',
          category: 'evidence',
          difficulty: 'easy',
          inputs: {
            goal: 'Read a file and process its contents'
          },
          expectedOutputs: {
            evidence: {
              reads: true,
              writes: true,
              commands: true,
              tests: true
            }
          },
          evaluationCriteria: [
            {
              name: 'read-logging',
              description: 'File reads were logged',
              weight: 25,
              evaluator: (bundle) => bundle.reads.length > 0 ? 1 : 0
            },
            {
              name: 'write-logging',
              description: 'File writes were logged',
              weight: 25,
              evaluator: (bundle) => bundle.writes.length > 0 ? 1 : 0
            },
            {
              name: 'command-logging',
              description: 'Commands were logged',
              weight: 25,
              evaluator: (bundle) => bundle.commands.length > 0 ? 1 : 0
            },
            {
              name: 'hash-integrity',
              description: 'Evidence hash is valid',
              weight: 25,
              evaluator: (bundle) => bundle.verdict.evidenceHash && bundle.verdict.evidenceHash.length === 64 ? 1 : 0
            }
          ]
        }
      ]
    };

    this.suites.set(evidenceSuite.id, evidenceSuite);
  }

  async runBenchmark(suiteId: string, taskId: string, cwd: string = process.cwd()): Promise<BenchmarkResult | null> {
    const suite = this.suites.get(suiteId);
    if (!suite) return null;

    const task = suite.tasks.find(t => t.id === taskId);
    if (!task) return null;

    const runId = randomUUID();
    const startTime = Date.now();

    // Execute the benchmark task (placeholder - would integrate with actual command execution)
    // For now, simulate with mock data
    const mockBundle: EvidenceBundle = {
      run: {
        runId,
        sessionId: randomUUID(),
        correlationId: randomUUID(),
        startTime: new Date().toISOString(),
        command: 'benchmark',
        args: [suiteId, taskId],
        cwd
      },
      events: [],
      inputs: task.inputs,
      plan: task.expectedOutputs,
      reads: task.expectedOutputs.files ? [{ path: task.expectedOutputs.files[0], operation: 'read', size: 100 }] : [],
      writes: task.expectedOutputs.files ? [{ path: task.expectedOutputs.files[0], operation: 'write', size: 200 }] : [],
      commands: [{ timestamp: new Date().toISOString(), command: 'echo', args: ['test'], exitCode: 0, duration: 100 }],
      tests: task.expectedOutputs.tests ? [{ timestamp: new Date().toISOString(), testName: 'unit-test', status: 'pass', duration: 50 }] : [],
      gates: [{ timestamp: new Date().toISOString(), gateName: 'quality-gate', status: 'pass' }],
      receipts: [],
      verdict: {
        timestamp: new Date().toISOString(),
        status: 'success',
        completionOracle: true,
        evidenceHash: 'mock-hash'
      },
      summary: 'Benchmark execution completed'
    };

    const executionTime = Date.now() - startTime;

    // Evaluate criteria
    const criterionScores: Record<string, number> = {};
    let totalWeightedScore = 0;

    for (const criterion of task.evaluationCriteria) {
      const score = criterion.evaluator(mockBundle);
      criterionScores[criterion.name] = score;
      totalWeightedScore += score * criterion.weight;
    }

    const overallScore = totalWeightedScore / suite.totalWeight;

    // Determine verdict based on score
    let verdict: CompletionVerdict;
    if (overallScore >= 0.9) verdict = 'complete';
    else if (overallScore >= 0.7) verdict = 'partially_complete';
    else if (overallScore >= 0.5) verdict = 'inconclusive';
    else verdict = 'regressed';

    const result: BenchmarkResult = {
      taskId,
      runId,
      timestamp: new Date().toISOString(),
      overallScore,
      criterionScores,
      verdict,
      executionTime,
      metadata: {
        suiteId,
        taskName: task.name,
        category: task.category,
        difficulty: task.difficulty
      }
    };

    // Save result
    const resultsDir = path.join(cwd, '.danteforge', 'benchmarks');
    await fs.mkdir(resultsDir, { recursive: true });
    const resultPath = path.join(resultsDir, `${runId}.json`);
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));

    return result;
  }

  async runSuite(suiteId: string, cwd: string = process.cwd()): Promise<BenchmarkResult[]> {
    const suite = this.suites.get(suiteId);
    if (!suite) return [];

    const results: BenchmarkResult[] = [];
    for (const task of suite.tasks) {
      const result = await this.runBenchmark(suiteId, task.id, cwd);
      if (result) results.push(result);
    }

    return results;
  }

  getSuites(): string[] {
    return Array.from(this.suites.keys());
  }

  getSuiteTasks(suiteId: string): BenchmarkTask[] {
    const suite = this.suites.get(suiteId);
    return suite ? suite.tasks : [];
  }

  async loadResults(cwd: string = process.cwd()): Promise<BenchmarkResult[]> {
    const resultsDir = path.join(cwd, '.danteforge', 'benchmarks');
    try {
      const files = await fs.readdir(resultsDir);
      const results: BenchmarkResult[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(resultsDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          results.push(JSON.parse(content));
        }
      }

      return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch {
      return [];
    }
  }
}

export const benchmarkHarness = new BenchmarkHarness();