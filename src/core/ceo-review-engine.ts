// CEO Review Engine — ambiguity detection, intent elevation, 10-star framework.
// Three-mode: API → prompt → local fallback.
import { isLLMAvailable, callLLM } from './llm.js';
import { savePrompt } from './prompt-builder.js';

export const AMBIGUITY_SIGNALS = [
  'something', 'kind of', 'maybe', 'probably', 'might', 'could',
  'a bit', 'somehow', 'sort of', 'roughly', 'approximately', 'TBD',
  'figure out', 'not sure', 'unclear',
] as const;

export interface CEOReviewResult {
  originalGoal: string;
  elevatedVision: string;
  challengingQuestions: string[];
  tenStarVersion: string;
  ambiguitySignalsFound: string[];
  wasAutoTriggered: boolean;
}

// ── Ambiguity detection ─────────────────────────────────────────────────────

export function detectAmbiguitySignals(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const signal of AMBIGUITY_SIGNALS) {
    if (lower.includes(signal.toLowerCase())) {
      found.push(signal);
    }
  }
  return found;
}

export function shouldAutoCEOReview(goal: string): boolean {
  return detectAmbiguitySignals(goal).length >= 3;
}

// ── CEO Review execution ────────────────────────────────────────────────────

export async function runCEOReview(
  goal: string,
  specContent: string,
  options: { prompt?: boolean } = {},
): Promise<CEOReviewResult> {
  const ambiguitySignals = detectAmbiguitySignals(goal);
  const wasAutoTriggered = ambiguitySignals.length >= 3;

  const reviewPrompt = buildCEOReviewPrompt(goal, specContent, ambiguitySignals);

  // Prompt mode — write prompt for human execution
  if (options.prompt || !(await isLLMAvailable())) {
    const savedPath = await savePrompt('ceo-review', reviewPrompt);
    return {
      originalGoal: goal,
      elevatedVision: `[CEO Review prompt saved to ${savedPath}]`,
      challengingQuestions: ['Review the prompt and apply CEO-level thinking to the spec'],
      tenStarVersion: '[Run the prompt through an LLM to generate the 10-star version]',
      ambiguitySignalsFound: ambiguitySignals,
      wasAutoTriggered,
    };
  }

  // API mode — call LLM
  try {
    const response = await callLLM(reviewPrompt);
    return parseCEOReviewResponse(response, goal, ambiguitySignals, wasAutoTriggered);
  } catch {
    // Fallback — return minimal result
    return {
      originalGoal: goal,
      elevatedVision: goal,
      challengingQuestions: [],
      tenStarVersion: goal,
      ambiguitySignalsFound: ambiguitySignals,
      wasAutoTriggered,
    };
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatCEOReviewSection(result: CEOReviewResult): string {
  const lines: string[] = [
    '## CEO Review Notes',
    '',
    `**Original Goal:** ${result.originalGoal}`,
    '',
  ];

  if (result.ambiguitySignalsFound.length > 0) {
    lines.push(`**Ambiguity signals detected:** ${result.ambiguitySignalsFound.join(', ')}`);
    lines.push('');
  }

  if (result.wasAutoTriggered) {
    lines.push('*This review was auto-triggered due to high ambiguity in the goal.*');
    lines.push('');
  }

  lines.push('### Elevated Vision');
  lines.push(result.elevatedVision);
  lines.push('');

  if (result.challengingQuestions.length > 0) {
    lines.push('### Challenging Questions');
    for (const q of result.challengingQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push('');
  }

  lines.push('### 10-Star Version');
  lines.push(result.tenStarVersion);

  return lines.join('\n');
}

// ── Internal helpers ────────────────────────────────────────────────────────

function buildCEOReviewPrompt(goal: string, specContent: string, ambiguitySignals: string[]): string {
  return [
    'You are a world-class product strategist applying the 10-star product framework.',
    '',
    `## Goal: ${goal}`,
    '',
    ambiguitySignals.length > 0
      ? `## Ambiguity Signals Found: ${ambiguitySignals.join(', ')}`
      : '',
    '',
    '## Current Spec (if any):',
    specContent || '(No spec yet)',
    '',
    '## Your Task:',
    '1. Challenge whether this goal solves the right problem at the right level.',
    '2. Ask 3–5 hard questions a founder/CEO should consider before building.',
    '3. Describe the 10-star version: what would the best possible implementation look like?',
    '4. Provide an elevated vision that aims higher than the original goal.',
    '',
    '## Output Format:',
    'ELEVATED_VISION: <one paragraph>',
    'QUESTIONS:',
    '- <question 1>',
    '- <question 2>',
    '- <question 3>',
    'TEN_STAR: <one paragraph describing the ideal>',
  ].filter(Boolean).join('\n');
}

function parseCEOReviewResponse(
  response: string,
  originalGoal: string,
  ambiguitySignals: string[],
  wasAutoTriggered: boolean,
): CEOReviewResult {
  const visionMatch = response.match(/ELEVATED_VISION:\s*([\s\S]*?)(?=QUESTIONS:|$)/i);
  const tenStarMatch = response.match(/TEN_STAR:\s*([\s\S]*?)$/i);
  const questionsSection = response.match(/QUESTIONS:\s*([\s\S]*?)(?=TEN_STAR:|$)/i);

  const questions: string[] = [];
  if (questionsSection) {
    const qLines = questionsSection[1].split('\n').filter(l => l.trim().startsWith('-'));
    for (const line of qLines) {
      questions.push(line.replace(/^-\s*/, '').trim());
    }
  }

  return {
    originalGoal,
    elevatedVision: visionMatch?.[1]?.trim() ?? response.trim(),
    challengingQuestions: questions,
    tenStarVersion: tenStarMatch?.[1]?.trim() ?? '',
    ambiguitySignalsFound: ambiguitySignals,
    wasAutoTriggered,
  };
}
