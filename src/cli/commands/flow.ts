// flow — Workflow decision tree command
// Shows the 5 DanteForge journeys and what to run next based on current project state.

import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';

export interface WorkflowStep {
  command: string;
  label?: string;
}

export interface Workflow {
  id: string;
  label: string;
  trigger: string;
  useWhen: string;
  steps: string[];
}

export interface FlowOptions {
  interactive?: boolean;
  cwd?: string;
  _readState?: () => Promise<string | null>;
  _writeOutput?: (lines: string[]) => void;
  /** Injection seam: receives the choice array and returns the 0-based index selected. */
  _prompt?: (choices: string[]) => Promise<number>;
}

export interface FlowResult {
  workflows: Workflow[];
  recommended?: string;
  currentStage?: string;
}

export const WORKFLOWS: Workflow[] = [
  {
    id: 'daily-driver',
    label: 'Daily quality flywheel — score, improve, teach',
    trigger: 'Starting your work session',
    useWhen: 'Use when: beginning any coding session to see where you are and drive continuous improvement.',
    steps: ['/score', '/prime', '/go', '/teach "what AI got wrong"', '/proof --since yesterday'],
  },
  {
    id: 'oss-harvest',
    label: 'Harvest patterns from open-source, one at a time',
    trigger: 'Want to learn from what others have built',
    useWhen: 'Use when: you want to adopt a specific pattern from OSS repos with Y/N control per gap.',
    steps: ['/harvest-pattern "pattern name"', '/score', '/prime'],
  },
  {
    id: 'multi-agent',
    label: 'Multi-agent blitz — parallel improvement',
    trigger: 'Want maximum parallelism for a dimension sprint',
    useWhen: 'Use when: tackling a large dimension gap that benefits from parallel agent execution.',
    steps: ['/magic or /inferno', '/score', '/prime'],
  },
  {
    id: 'spec-to-ship',
    label: 'Spec-to-ship guided wizard',
    trigger: 'Building something new from a goal statement',
    useWhen: 'Use when: starting a new feature or project with a clear goal — runs the full pipeline.',
    steps: ['/build "your goal"', '/score', '/synthesize'],
  },
  {
    id: 'competitive-leapfrog',
    label: 'Competitive leapfrog — beat the benchmark',
    trigger: 'Want to outperform a competitor or reference score',
    useWhen: 'Use when: you have a competitive target and want automated sprint-and-score cycles.',
    steps: ['/compete', '/compete --sprint --auto', '/score'],
  },
];

function formatWorkflowList(workflows: Workflow[]): string[] {
  const lines: string[] = [
    'DanteForge Workflows — Choose Your Path',
    '========================================',
    '',
  ];

  for (let i = 0; i < workflows.length; i++) {
    const w = workflows[i];
    lines.push(`${i + 1}. ${w.label}`);
    if (w.useWhen) lines.push(`   ${w.useWhen}`);
    lines.push(`   → ${w.steps.join(' → ')}`);
    lines.push('');
  }

  lines.push('Run `danteforge flow --interactive` to get a personalized recommendation.');
  return lines;
}

function recommendWorkflow(stage: string | undefined): string {
  if (!stage) return 'spec-to-ship';
  if (stage === 'forge') return 'spec-to-ship';
  if (stage === 'verify' || stage === 'synthesize') return 'daily-driver';
  if (stage === 'specify' || stage === 'clarify' || stage === 'plan' || stage === 'tasks') {
    return 'spec-to-ship';
  }
  return 'daily-driver';
}

/** Default readline-based prompt — reads a number from stdin. */
async function defaultReadlinePrompt(choices: string[]): Promise<number> {
  const isTTY = Boolean(process.stdin.isTTY);
  if (!isTTY) return 0;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<number>((resolve) => {
    rl.question('\nEnter number (1-' + String(choices.length) + '): ', (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      resolve(isNaN(idx) ? -1 : idx);
    });
  });
}

async function runInteractiveFlow(options: FlowOptions, currentStage?: string): Promise<void> {
  const writeOutput = options._writeOutput ?? ((lines: string[]) => {
    process.stdout.write(lines.join('\n') + '\n');
  });
  const promptFn = options._prompt ?? defaultReadlinePrompt;

  const header = [
    'DanteForge Workflow Picker',
    '==========================',
    '',
    ...(currentStage ? [`Current stage: ${currentStage}`, ''] : []),
  ];
  writeOutput(header);

  const choices = WORKFLOWS.map((w, i) => `  ${i + 1}. ${w.label}`);
  writeOutput(choices);

  const idx = await promptFn(choices);
  const workflow = WORKFLOWS[idx];

  if (!workflow) {
    writeOutput(['', 'Invalid selection — run `danteforge flow` to see options.']);
    return;
  }

  writeOutput([
    '',
    `▶  ${workflow.label}`,
    `   Trigger: ${workflow.trigger}`,
    '',
    'Run these commands:',
    '',
    ...workflow.steps.map(s => `  danteforge ${s}`),
    '',
  ]);
}

export async function runFlow(options: FlowOptions = {}): Promise<FlowResult> {
  const cwd = options.cwd ?? process.cwd();

  const readState = options._readState ?? (async () => {
    try {
      return await fs.readFile(path.join(cwd, '.danteforge', 'STATE.yaml'), 'utf8');
    } catch {
      return null;
    }
  });

  const writeOutput = options._writeOutput ?? ((lines: string[]) => {
    process.stdout.write(lines.join('\n') + '\n');
  });

  const stateYaml = await readState();
  let currentStage: string | undefined;

  if (stateYaml) {
    const match = stateYaml.match(/^workflowStage:\s*(.+)$/m);
    currentStage = match?.[1]?.trim();
  }

  const recommended = recommendWorkflow(currentStage);

  if (options.interactive) {
    await runInteractiveFlow(options, currentStage);
  } else {
    const lines = formatWorkflowList(WORKFLOWS);
    if (currentStage) {
      lines.push('');
      lines.push(`Current stage: ${currentStage}`);
      const rec = WORKFLOWS.find(w => w.id === recommended);
      if (rec) {
        lines.push(`Recommended: Workflow — ${rec.label}`);
        lines.push(`Next step: ${rec.steps[0]}`);
      }
    }
    writeOutput(lines);
  }

  return { workflows: WORKFLOWS, recommended, currentStage };
}
