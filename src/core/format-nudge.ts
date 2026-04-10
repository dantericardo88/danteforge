// format-nudge.ts — Detect and recover from LLM format non-compliance.
// When an LLM outputs code in an unrecognized format, nudge it to reformat
// using SEARCH/REPLACE blocks without changing the implementation.

/**
 * Maximum number of reformat nudges before giving up and falling through
 * to the verifier with the last LLM response as-is.
 */
export const MAX_NUDGE_ATTEMPTS = 2;

/**
 * Returns true when the response contains code content (fenced blocks or
 * indented code) but NO recognized format markers (SEARCH/REPLACE, NEW_FILE,
 * filepath comment). Used to distinguish "wrong format" from "no code at all."
 */
export function detectCodePresence(response: string): boolean {
  const hasFence = /`{3,4}/.test(response);
  const hasIndentedCode = /\n {4}\S/.test(response);
  if (!hasFence && !hasIndentedCode) return false;

  // Already uses a recognized format — no nudge needed
  const hasSearchReplace = /<<<<<<< SEARCH/.test(response);
  const hasNewFile = /NEW_FILE:\s*\S/.test(response);
  const hasFilepathMarker = /(?:\/\/\s*)?filepath:\s*\S/.test(response);
  return !hasSearchReplace && !hasNewFile && !hasFilepathMarker;
}

/**
 * Builds a targeted reformat prompt that asks the LLM to convert its previous
 * response into SEARCH/REPLACE blocks WITHOUT changing the implementation.
 * The original response is included so the LLM has full context.
 */
export function buildFormatNudgePrompt(taskName: string, badResponse: string): string {
  const truncated =
    badResponse.length > 3000
      ? badResponse.slice(0, 3000) + '\n[response truncated]'
      : badResponse;

  return [
    `Task: ${taskName}`,
    '',
    'Your previous response contained code but did not use the required SEARCH/REPLACE format.',
    'Reformat your code changes using ONLY the format below — do NOT change the implementation.',
    '',
    '## Required format:',
    '<<<<<<< SEARCH',
    '[exact lines to find in the file]',
    '=======',
    '[replacement lines]',
    '>>>>>>> REPLACE',
    'filepath: src/path/to/file.ts',
    '',
    'For new files use:',
    'NEW_FILE: src/path/to/file.ts',
    '```',
    '[complete file content]',
    '```',
    '',
    '## Your previous response to reformat:',
    truncated,
    '',
    'Output ONLY the reformatted SEARCH/REPLACE blocks — no explanation.',
  ].join('\n');
}
