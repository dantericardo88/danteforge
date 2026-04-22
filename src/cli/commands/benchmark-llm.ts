// benchmark-llm — A/B LLM benchmark: raw prompt vs DanteForge-structured context
import {
  runLLMBenchmark,
  formatBenchmarkReport,
  loadBenchmarkHistory,
  type BenchmarkTask,
  type BenchmarkResult,
  type LLMBenchmarkOptions,
} from '../../core/llm-benchmark.js';

export interface BenchmarkLLMCommandOptions {
  task?: string;
  save?: boolean;
  compare?: boolean;
  cwd?: string;
  _runBenchmark?: (task: BenchmarkTask, opts?: LLMBenchmarkOptions) => Promise<BenchmarkResult>;
  _loadHistory?: (cwd: string) => Promise<BenchmarkResult[]>;
  _stdout?: (line: string) => void;
}

export async function benchmarkLLM(options: BenchmarkLLMCommandOptions = {}): Promise<void> {
  const stdout = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const cwd = options.cwd ?? process.cwd();

  if (!options.task) {
    stdout('Usage: danteforge benchmark-llm "<task description>"');
    return;
  }

  const task: BenchmarkTask = {
    id: Date.now().toString(),
    description: options.task,
    successCriteria: [],
  };

  stdout(`Running benchmark: ${options.task}...`);

  const runBenchmark = options._runBenchmark ?? runLLMBenchmark;
  const result = await runBenchmark(task, { cwd });

  const report = formatBenchmarkReport(result);
  for (const line of report.split('\n')) {
    stdout(line);
  }

  if (options.compare) {
    const loadHistory = options._loadHistory ?? loadBenchmarkHistory;
    const history = await loadHistory(cwd);
    const recent = history.slice(-3);
    if (recent.length > 0) {
      stdout('');
      stdout('HISTORICAL TREND (last 3 results):');
      for (const r of recent) {
        const sign = r.improvement.overallDeltaPercent >= 0 ? '+' : '';
        stdout(`  [${r.savedAt}] ${r.task.description.slice(0, 40)} — ${sign}${r.improvement.overallDeltaPercent.toFixed(2)}% (${r.verdict})`);
      }
    }
  }

  if (options.save !== false) {
    stdout('Results saved to .danteforge/benchmark-results.json');
  }
}
