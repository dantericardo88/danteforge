// Diff formatter — parse unified diffs and render colorized terminal output.
// Also provides renderVerifyResult for the verify and publish-check commands.

export type DiffLineType = 'context' | 'added' | 'removed' | 'hunk-header' | 'file-header';

export interface DiffLine {
  type: DiffLineType;
  content: string;
}

export interface DiffFormatterDeps {
  _chalk?: {
    green: (s: string) => string;
    red: (s: string) => string;
    cyan: (s: string) => string;
    gray: (s: string) => string;
    bold: (s: string) => string;
    yellow: (s: string) => string;
  };
}

export function parseDiff(rawDiff: string): DiffLine[] {
  if (!rawDiff) return [];
  const lines = rawDiff.split('\n');
  const result: DiffLine[] = [];
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'file-header', content: line });
    } else if (line.startsWith('@@')) {
      result.push({ type: 'hunk-header', content: line });
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', content: line });
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line });
    } else {
      result.push({ type: 'context', content: line });
    }
  }
  return result;
}

const identity = (s: string) => s;
const defaultChalk = {
  green: identity, red: identity, cyan: identity,
  gray: identity, bold: identity, yellow: identity,
};

export function formatDiffForTerminal(lines: DiffLine[], deps?: DiffFormatterDeps): string {
  const c = deps?._chalk ?? defaultChalk;
  return lines.map(line => {
    switch (line.type) {
      case 'added': return c.green(line.content);
      case 'removed': return c.red(line.content);
      case 'hunk-header': return c.cyan(line.content);
      case 'file-header': return c.bold(line.content);
      default: return c.gray(line.content);
    }
  }).join('\n');
}

export function renderVerifyResult(
  passed: string[],
  warnings: string[],
  failures: string[],
  deps?: DiffFormatterDeps,
): string {
  const c = deps?._chalk ?? defaultChalk;
  const lines: string[] = [];
  for (const p of passed) lines.push(c.green(`✓ ${p}`));
  for (const w of warnings) lines.push(c.yellow(`⚠ ${w}`));
  for (const f of failures) lines.push(c.red(`✗ ${f}`));
  const total = passed.length + warnings.length + failures.length;
  const summary = `${passed.length}/${total} passed`;
  lines.push(failures.length > 0 ? c.red(summary) : c.green(summary));
  return lines.join('\n');
}
