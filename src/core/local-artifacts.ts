import fs from 'fs/promises';
import path from 'path';

const STATE_DIR = '.danteforge';

export const FIRST_EXECUTION_PHASE = 1;

export interface LocalTask {
  name: string;
  files?: string[];
  verify?: string;
}

export async function writeArtifact(filename: string, content: string): Promise<string> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const filePath = path.join(STATE_DIR, filename);
  await fs.writeFile(filePath, content);
  return filePath;
}

export function buildLocalSpec(
  idea: string,
  constitution?: string,
  currentState?: string,
): { markdown: string; tasks: LocalTask[] } {
  const inferredPaths = inferPlanningPaths(currentState);
  const tasks: LocalTask[] = [
    {
      name: `Implement ${idea}`,
      files: [inferredPaths.source],
      verify: 'Core workflow matches the specification',
    },
    {
      name: `Test ${idea}`,
      files: [inferredPaths.test],
      verify: 'Automated checks cover the primary flow',
    },
  ];

  const markdown = [
    '# SPEC.md',
    '',
    '## Feature Name',
    idea,
    '',
    '## Constitution Reference',
    constitution ?? 'No constitution recorded yet.',
    '',
    '## What & Why',
    `Deliver ${idea} using a structured DanteForge workflow that can run locally or with an external LLM.`,
    '',
    '## User Stories',
    `1. As an operator, I want ${idea}, so that I can move from intent to execution with clear artifacts.`,
    '2. As a reviewer, I want generated artifacts to be explicit and verifiable, so that the workflow is trustworthy.',
    '',
    '## Non-functional Requirements',
    '- Keep generated artifacts deterministic in local-only mode.',
    '- Preserve compatibility with prompt-mode and LLM-backed workflows.',
    '- Make every step fail closed when prerequisites are missing.',
    '',
    '## Acceptance Criteria',
    '1. SPEC.md is written to .danteforge/.',
    '2. The task breakdown can drive forge phase 1 without inventing default work.',
    '3. Operators can understand the next command to run from the generated artifact.',
    '',
    '## Task Breakdown',
    ...tasks.map((task, index) => (
      `${index + 1}. ${task.name} - files: ${(task.files ?? []).join(', ')} - verify: ${task.verify}`
    )),
    '',
    '## Dependencies & Risks',
    '- Depends on project conventions already captured in the constitution and current state review.',
    currentState ? '- Risk: current codebase constraints may require manual refinement after import.' : '- Risk: no current state review exists yet.',
    '',
  ].join('\n');

  return { markdown, tasks };
}

function inferPlanningPaths(currentState?: string): { source: string; test: string } {
  if (!currentState) {
    return { source: 'src/', test: 'tests/' };
  }

  const normalizedLines = currentState
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean);

  const source = findPreferredPath(normalizedLines, [
    /^src\/.+/,
    /^vscode-extension\/src\/.+/,
    /^lib\/.+/,
    /^src\/$/,
    /^vscode-extension\/src\/$/,
    /^(commands|agents|hooks)\/.+/,
    /^(commands|agents|hooks)\/$/,
  ]);
  const test = normalizedLines.find(line => /^tests\//.test(line));

  return {
    source: source ?? 'src/',
    test: test ?? 'tests/',
  };
}

function findPreferredPath(lines: string[], patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = lines.find(line => pattern.test(line));
    if (match) {
      return match;
    }
  }

  return undefined;
}

export function buildLocalClarify(
  specContent: string,
  currentState?: string,
): string {
  return [
    '# CLARIFY.md',
    '',
    '## Ambiguities Found',
    '- Confirm the exact operator workflow once artifacts are generated.',
    '',
    '## Missing Requirements',
    currentState
      ? '- Check whether current repository constraints require additional implementation details.'
      : '- Run danteforge review to capture repository-specific context before execution.',
    '',
    '## Consistency Issues',
    '- Ensure every success message corresponds to a real file or prompt artifact.',
    '',
    '## Clarification Questions',
    '1. Which commands should generate deterministic local artifacts versus prompts?',
    '2. What is the minimum verification bar before a phase is considered complete?',
    '3. Which user-facing integrations must be release-blocking?',
    '',
    '## Suggested Defaults',
    '- Default to writing local artifacts for planning commands when no LLM is configured.',
    '- Require explicit --prompt for forge or UX refinement when no LLM is configured.',
    '- Treat missing required artifacts as verification failures.',
    '',
    '## Spec Snapshot',
    specContent.slice(0, 1200) || 'No SPEC.md found.',
    '',
  ].join('\n');
}

export function buildLocalPlan(
  specContent: string,
  constitution?: string,
  currentState?: string,
): string {
  return [
    '# PLAN.md',
    '',
    '## Architecture Overview',
    '- Inputs: constitution, review output, and specification artifacts.',
    '- Outputs: executable tasks, prompt artifacts, and verification signals.',
    '- Execution model: deterministic local planning, explicit prompt mode for implementation when no LLM is configured.',
    '',
    '## Implementation Phases',
    '1. Validate prerequisites and load project state.',
    '2. Generate or refine the required artifact.',
    '3. Store executable tasks for phase 1.',
    '4. Verify required artifacts before moving to execution.',
    '',
    '## Technology Decisions',
    '- Keep the CLI ESM-first and file-based for portability.',
    '- Preserve user-level config for secrets and project-level state for artifacts.',
    constitution ? `- Respect constitution constraints: ${constitution.split('\n')[0]}` : '- No constitution constraints were provided.',
    '',
    '## Risk Mitigations',
    '- Avoid false-positive success messages by requiring a real artifact write.',
    '- Avoid false-positive execution by requiring explicit --prompt mode when no LLM is available.',
    currentState ? '- Review-generated context is available for refinement.' : '- Run danteforge review to reduce repository-specific blind spots.',
    '',
    '## Testing Strategy',
    '- Unit tests for parsing, state transitions, and exit-code behavior.',
    '- End-to-end CLI tests in isolated temp workspaces.',
    '- Extension tests for shell safety and command dispatch behavior.',
    '',
    '## Timeline',
    '- Phase 1: artifact generation and state alignment (M)',
    '- Phase 2: execution fallback and verification hardening (M)',
    '- Phase 3: extension parity and release automation (L)',
    '',
    '## Specification Snapshot',
    specContent.slice(0, 1600) || 'No SPEC.md found.',
    '',
  ].join('\n');
}

export function buildLocalTasks(planContent: string, specContent: string): { markdown: string; tasks: LocalTask[] } {
  const tasks: LocalTask[] = [
    {
      name: 'Implement the documented workflow',
      files: ['src/cli/', 'src/core/'],
      verify: 'Commands produce truthful artifacts and state transitions',
    },
    {
      name: 'Add verification coverage',
      files: ['tests/'],
      verify: 'New integration tests fail on incomplete or misleading workflows',
    },
  ];

  const markdown = [
    '# TASKS.md',
    '',
    '## Phase 1',
    ...tasks.map((task, index) => (
      `${index + 1}. ${task.name} - files: ${(task.files ?? []).join(', ')} - verify: ${task.verify} - effort: M`
    )),
    '',
    '## Dependencies',
    '- Task 2 depends on the core workflow semantics being stable enough to test.',
    '',
    '## Phase Grouping',
    '- Phase 1: establish truthful artifact and execution semantics.',
    '',
    '## Context',
    planContent.slice(0, 1200) || 'No PLAN.md found.',
    '',
    specContent.slice(0, 1200) || 'No SPEC.md found.',
    '',
  ].join('\n');

  return { markdown, tasks };
}

export function extractNumberedTasks(markdown: string, heading: string): LocalTask[] {
  const section = extractSection(markdown, heading);
  return section
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+\.\s/.test(line))
    .map(line => {
      const normalized = line.replace(/^\d+\.\s*/, '');
      const segments = normalized.split(' - ');
      const name = segments[0] ?? normalized;
      const filesSegment = segments.find(segment => segment.startsWith('files: '));
      const verifySegment = segments.find(segment => segment.startsWith('verify: '));
      return {
        name: name.trim(),
        files: filesSegment ? filesSegment.replace('files: ', '').split(',').map(file => file.trim()).filter(Boolean) : undefined,
        verify: verifySegment ? verifySegment.replace('verify: ', '').trim() : 'Matches the documented artifact',
      };
    });
}

function extractSection(markdown: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`## ${escapedHeading}\\n([\\s\\S]*?)(?:\\n## |$)`));
  return match?.[1] ?? '';
}
