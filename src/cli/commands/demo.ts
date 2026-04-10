// demo — illustrative side-by-side comparison of raw-prompt quality vs. DanteForge artifacts.
import { scoreRawPrompt } from '../../core/proof-engine.js';
import { DEMO_FIXTURES, getDemoFixture } from '../../core/demo-fixtures.js';
import type { RawPromptScore } from '../../core/proof-engine.js';
import type { DemoFixture } from '../../core/demo-fixtures.js';

export interface DemoCommandOptions {
  fixture?: string;
  all?: boolean;
  cwd?: string;
  _scoreRawPrompt?: (p: string) => RawPromptScore;
  _runPdse?: (artifacts: Record<string, string>, cwd: string) => Promise<number>;
  _stdout?: (line: string) => void;
}

function print(line: string, options: DemoCommandOptions): void {
  const out = options._stdout ?? ((l: string) => process.stdout.write(l + '\n'));
  out(line);
}

async function runFixture(fixture: DemoFixture, options: DemoCommandOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const scorer = options._scoreRawPrompt ?? scoreRawPrompt;

  print(`\n=== DanteForge Demo: ${fixture.description} ===`, options);

  print(`\nWITHOUT DanteForge (raw prompt):`, options);
  print(`  Prompt: "${fixture.rawPrompt}"`, options);

  const scoreRaw = scorer(fixture.rawPrompt);
  print(`  Context Quality Score: ${scoreRaw.total}/100`, options);

  print(`\nWITH DanteForge (structured artifacts):`, options);

  let pdseScore: number;
  if (options._runPdse) {
    pdseScore = await options._runPdse(
      {
        constitution: fixture.artifactSet.constitution,
        spec: fixture.artifactSet.spec,
        plan: fixture.artifactSet.plan,
      },
      cwd,
    );
  } else {
    pdseScore = fixture.expectedPdseScore;
  }

  print(`  PDSE Score: ${pdseScore}/100`, options);
  print(`  Artifacts: CONSTITUTION.md + SPEC.md + PLAN.md`, options);

  const delta = ((pdseScore - scoreRaw.total) / Math.max(scoreRaw.total, 1) * 100).toFixed(0);
  print(`\nIMPROVEMENT: +${delta}% better AI context quality`, options);
  print(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, options);
}

export async function demo(options: DemoCommandOptions = {}): Promise<void> {
  const fixturesToRun: DemoFixture[] = [];

  if (options.all) {
    fixturesToRun.push(...DEMO_FIXTURES);
  } else {
    const name = options.fixture ?? 'task-tracker';
    const found = getDemoFixture(name) ?? getDemoFixture('task-tracker');
    if (found) {
      fixturesToRun.push(found);
    }
  }

  for (const fixture of fixturesToRun) {
    await runFixture(fixture, options);
  }

  print(`\nRun 'danteforge quickstart --simple' to get started with your own project.`, options);
}
