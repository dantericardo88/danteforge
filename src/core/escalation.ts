// Escalation — tiered feedback for incomplete tasks
// Harvested from: Reflection-3.ts (OpenCode plugin) — 3-tier escalation with loop overrides

import type { LoopDetectionResult } from './loop-detector.js';

// --- Escalating Feedback Builder ---------------------------------------------
// Attempt 1: Polite with missing items
// Attempt 2: Firm with DO/DON'T instructions
// Attempt 3: Final warning — fix or explain why you cannot
// Loop override: Hard STOP message

export function buildEscalatingFeedback(
  attempt: number,
  maxAttempts: number,
  missing: string[],
  loopResult?: LoopDetectionResult,
): string {
  // Loop overrides take precedence over normal escalation
  if (loopResult?.detected) {
    if (loopResult.type === 'planning') {
      return buildPlanningLoopFeedback(loopResult);
    }
    if (loopResult.type === 'action') {
      return buildActionLoopFeedback(loopResult);
    }
  }

  if (attempt >= maxAttempts) {
    return buildFinalWarning(attempt, maxAttempts, missing);
  }

  if (attempt >= 2) {
    return buildFirmFeedback(attempt, maxAttempts, missing);
  }

  return buildPoliteFeedback(attempt, maxAttempts, missing);
}

// --- Tier 1: Polite ----------------------------------------------------------

function buildPoliteFeedback(attempt: number, maxAttempts: number, missing: string[]): string {
  const lines = [
    `## Task Incomplete (attempt ${attempt}/${maxAttempts})`,
    '',
    'The following items are still missing:',
    ...missing.map(item => `- ${item}`),
    '',
    'Please address these items and try again.',
  ];
  return lines.join('\n');
}

// --- Tier 2: Firm ------------------------------------------------------------

function buildFirmFeedback(attempt: number, maxAttempts: number, missing: string[]): string {
  const lines = [
    `## Task Incomplete — Second Attempt (${attempt}/${maxAttempts})`,
    '',
    '**Still missing:**',
    ...missing.map(item => `- ${item}`),
    '',
    '**DO:**',
    '- Run tests after every code change',
    '- Verify the build passes',
    '- Address each missing item above',
    '',
    '**DO NOT:**',
    '- Skip verification steps',
    '- Claim completion without evidence',
    '- Repeat the same approach that failed',
  ];
  return lines.join('\n');
}

// --- Tier 3: Final Warning ---------------------------------------------------

function buildFinalWarning(attempt: number, maxAttempts: number, missing: string[]): string {
  const lines = [
    `## FINAL ATTEMPT (${attempt}/${maxAttempts})`,
    '',
    '**This is your last chance before reflection stops pushing.**',
    '',
    'Still missing:',
    ...missing.map(item => `- ${item}`),
    '',
    'Either:',
    '1. Implement the fix and provide evidence (test output, build output)',
    '2. Explain clearly why you cannot complete this task',
    '',
    'Do NOT claim completion without evidence.',
  ];
  return lines.join('\n');
}

// --- Loop Overrides ----------------------------------------------------------

function buildPlanningLoopFeedback(loopResult: LoopDetectionResult): string {
  return [
    '## STOP — Planning Loop Detected',
    '',
    `**Evidence:** ${loopResult.evidence}`,
    '',
    'You are stuck reading files without making changes.',
    '',
    '**DO NOW:**',
    '- Stop reading/searching — you have enough context',
    '- Write the code changes immediately',
    '- Run tests after writing',
    '',
    '**DO NOT:**',
    '- Read more files',
    '- Search for more context',
    '- Plan further without writing code',
  ].join('\n');
}

function buildActionLoopFeedback(loopResult: LoopDetectionResult): string {
  return [
    '## STOP — Action Loop Detected',
    '',
    `**Evidence:** ${loopResult.evidence}`,
    '',
    'You are repeating the same failing commands.',
    '',
    '**Choose ONE:**',
    '1. Fix the root cause (not the symptom)',
    '2. Try a completely different approach',
    '3. Ask the user for help',
    '',
    '**DO NOT:**',
    '- Run the same command again',
    '- Make the same change that already failed',
    '- Ignore the error output',
  ].join('\n');
}
