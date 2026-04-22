#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── State helpers (pure — exported for tests) ─────────────────────────────────

function extractTasksForPhase(yaml, phase) {
  if (!phase) return [];
  const lines = yaml.split('\n');
  const tasks = [];
  let inPhaseBlock = false;
  const phaseKey = new RegExp(`^\\s*${phase}:\\s*$`);

  for (const line of lines) {
    if (phaseKey.test(line)) { inPhaseBlock = true; continue; }
    if (inPhaseBlock) {
      if (/^\s*\d+:\s*$/.test(line) && !phaseKey.test(line)) break;
      const nameMatch = line.match(/^\s*-?\s*name:\s*(.+)$/);
      if (nameMatch) tasks.push(nameMatch[1].trim());
    }
  }
  return tasks;
}

function nextActionForStage(stage, project) {
  const p = project ?? 'your project';
  switch (stage) {
    case 'specify':   return `Run /clarify to sharpen the spec for ${p}`;
    case 'clarify':   return `Run /tech-decide to choose your stack, then /plan`;
    case 'plan':      return `Run /tasks to break the plan into execution tasks`;
    case 'tasks':     return `Run /forge to begin implementation`;
    case 'verify':    return `Run /synthesize to finalize, then /ship when ready`;
    case 'synthesize':return `Run /ship to cut a release`;
    default:          return `Run /danteforge-flow to pick the right workflow`;
  }
}

// ── Matrix section builder (pure — exported for tests) ───────────────────────

export function buildMatrixSection(matrixState) {
  if (!matrixState) return '';
  const staleWarning = matrixState.daysOld !== null && matrixState.daysOld > 7
    ? `  ⚠  Matrix ${matrixState.daysOld}d old — run \`danteforge compete --init\` to rescan\n`
    : '';
  const sprintLine = matrixState.next
    ? `  CHL Sprint: "${matrixState.next.label}" (gap: ${matrixState.next.gap_to_leader.toFixed(1)}, harvest: ${matrixState.next.harvest_source ?? matrixState.next.oss_leader ?? '?'})\n`
    : '  CHL: All gaps closed! Run `danteforge compete --init` to refresh.\n';
  return (
    `\n## Competitive Position — ${matrixState.project}\n` +
    `Score: ${matrixState.overallScore.toFixed(1)}/10  |  ${sprintLine}` +
    staleWarning +
    `  Run: \`danteforge compete --sprint\`\n`
  );
}

export function buildSessionContext(stateYaml, matrixState = null) {
  const header = `## DanteForge — Active\n`;
  const matrixSection = buildMatrixSection(matrixState);
  const footer = (
    `\n## Available Commands\n` +
    `**Workflow:** /constitution /specify /clarify /tech-decide /plan /tasks /design /forge /ux-refine /verify /synthesize /review\n` +
    `**Presets:** /spark /ember /canvas /magic /blaze /nova /inferno /autoforge /party\n` +
    `**Quality:** /qa /retro /ship /debug /brainstorm /assess /maturity /define-done /self-improve /universe\n` +
    `**Harvest:** /oss /harvest /local-harvest /awesome-scan /wiki-ingest /wiki-lint /wiki-query /wiki-status /wiki-export\n` +
    `**Other:** /lessons /browse /resume /self-assess /self-mutate /ci-report /share-patterns /import-patterns\n` +
    `**Recovery:** /refused-patterns /respec /cross-synthesize\n` +
    `**Compete:** /compete /ascend\n` +
    `**Daily Flow:** /score /prime /teach /go /harvest-pattern /build /proof\n` +
    `**Flows:** /daily-driver /oss-harvest /multi-agent /spec-to-ship /competitive-leapfrog\n` +
    `\nHelp: /danteforge-flow (all workflows) | danteforge help <command>\n`
  );

  if (!stateYaml || stateYaml.trim() === '') {
    return (
      header +
      matrixSection +
      `\n✦ New project? Run \`/danteforge-flow\` to choose your path.\n` +
      `Quick starts: /spark "idea" (free) | /magic "idea" (~$1) | /inferno "idea" (max power)\n` +
      footer
    );
  }

  let stage, phase, project;
  try {
    stage   = (stateYaml.match(/^workflowStage:\s*(.+)$/m) ?? [])[1]?.trim();
    phase   = (stateYaml.match(/^currentPhase:\s*(.+)$/m) ?? [])[1]?.trim();
    project = (stateYaml.match(/^project:\s*(.+)$/m) ?? [])[1]?.trim();
  } catch {
    return header + matrixSection + `\nDanteForge is active. Run /danteforge-flow to get started.\n` + footer;
  }

  if (stage === 'forge') {
    const tasks = extractTasksForPhase(stateYaml, phase);
    const taskLines = tasks.length > 0
      ? tasks.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
      : '  (run `danteforge tasks` to generate tasks)';

    return (
      header +
      matrixSection +
      `\n✦ Phase ${phase} | project: ${project ?? 'unknown'} | stage: forge\n` +
      `Next: Load the forge skill — \`@danteforge-forge\`\n\n` +
      `**Tasks for phase ${phase}:**\n${taskLines}\n\n` +
      `When done: \`danteforge verify --json\` → read \`.danteforge/evidence/verify/latest.json\`\n` +
      footer
    );
  }

  if (stage) {
    const next = nextActionForStage(stage, project);
    return (
      header +
      matrixSection +
      `\n✦ Stage: ${stage} | project: ${project ?? 'unknown'}\n` +
      `Next: ${next}\n` +
      footer
    );
  }

  return header + matrixSection + `\nDanteForge is active. Run /danteforge-flow to get started.\n` + footer;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const stateFile = join(process.cwd(), '.danteforge', 'STATE.yaml');
let stateYaml = null;
try { stateYaml = readFileSync(stateFile, 'utf8'); } catch { /* no state file — ok */ }

// Load CHL matrix state
const matrixFile = join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
let matrixState = null;
try {
  const raw = readFileSync(matrixFile, 'utf8');
  const matrix = JSON.parse(raw);
  const FREQ = { high: 1.5, medium: 1.0, low: 0.5 };
  const eligible = (matrix.dimensions ?? []).filter(d => d.status !== 'closed');
  const next = eligible.length > 0
    ? eligible.reduce((best, d) => {
        const p = d.weight * d.gap_to_leader * (FREQ[d.frequency] ?? 1.0);
        const bp = best.weight * best.gap_to_leader * (FREQ[best.frequency] ?? 1.0);
        return p > bp ? d : best;
      })
    : null;
  const lastUpdated = matrix.lastUpdated ? new Date(matrix.lastUpdated) : null;
  const daysOld = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 86400000) : null;
  matrixState = { overallScore: matrix.overallSelfScore ?? 0, next, daysOld, project: matrix.project ?? 'Project' };
} catch { /* no matrix — ok */ }

const context = buildSessionContext(stateYaml, matrixState);
const payload = { additional_context: context, hookSpecificOutput: { additionalContext: context } };
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
