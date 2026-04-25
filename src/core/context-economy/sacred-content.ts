// Sacred content detection for the Context Economy Layer (PRD-26).
// If detection is uncertain, the content is sacred — fail-closed by design.

const SACRED_LINE_PATTERNS: RegExp[] = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bpanic\b/i,
  /\bexception\b/i,
  /\bfatal\b/i,
  /\bcritical\b/i,
  /\bsecurity\b/i,
  /\bwarning\b/i,
  /\bwarn\b/i,
  /at \S+:\d+/,                   // stack frame
  /^\s+at /,                       // JS/TS stack continuation
  /\b(AssertionError|Assertion|TypeError|SyntaxError|ReferenceError|RangeError)\b/,
  /CONFLICT|<<<<<<|>>>>>>|=======/,  // merge conflict markers
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bdenied\b/i,
  /\brejected\b/i,
  /✖|✗|✘|×/,
  /\bFAIL(ED|URE)?\b/,
  /CVE-\d|GHSA-[0-9a-z]|npm audit/i,
  /gate.*fail|fail.*gate/i,
];

const SACRED_BLOCK_STARTERS: RegExp[] = [
  /^Traceback \(most recent call last\)/,
  /^Error:/,
  /^FAILED/,
  /^panic:/,
  /^fatal:/,
];

function isSacredLine(line: string): boolean {
  return SACRED_LINE_PATTERNS.some((p) => p.test(line));
}

function isBlockStarter(line: string): boolean {
  return SACRED_BLOCK_STARTERS.some((p) => p.test(line.trimStart()));
}

function isContinuation(line: string): boolean {
  return line === '' || /^[\s\t]/.test(line) || /^(Caused by:|  \bat\b|\|)/.test(line);
}

export function detectSacredSpans(text: string): string[] {
  const lines = text.split('\n');
  const spans: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlockStarter(line) || isSacredLine(line)) {
      const block: string[] = [line];
      let j = i + 1;
      while (j < lines.length && (isContinuation(lines[j]) || isSacredLine(lines[j]))) {
        block.push(lines[j]);
        j++;
      }
      spans.push(block.join('\n').trimEnd());
      i = j;
    } else {
      i++;
    }
  }

  return spans;
}

export function containsSacredContent(text: string): boolean {
  return text.split('\n').some((line) => isBlockStarter(line) || isSacredLine(line));
}

export function injectSacredSpans(compressed: string, sacred: string[]): string {
  if (sacred.length === 0) return compressed;
  const sacredBlock = '--- sacred content (preserved verbatim) ---\n'
    + sacred.join('\n---\n')
    + '\n--- end sacred content ---';
  return `${compressed}\n\n${sacredBlock}`;
}
