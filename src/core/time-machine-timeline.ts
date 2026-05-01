/**
 * time-machine-timeline.ts
 *
 * ASCII timeline renderer for CounterfactualReplayResult.
 * Produces a human-readable side-by-side diff of original vs alternate timelines.
 */
import type { CounterfactualReplayResult } from './time-machine-replay.js';
import type { DecisionNode } from './decision-node.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '??:??:??';
  }
}

function statusIcon(node: DecisionNode): string {
  return node.output.success ? '✓' : '✗';
}

function formatNodeRow(prefix: string, node: DecisionNode, promptWidth: number): string {
  const icon = statusIcon(node);
  const prompt = truncate(node.input.prompt, promptWidth);
  return `${prefix} ${icon}  ${prompt}`;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Render a side-by-side ASCII timeline diff from a CounterfactualReplayResult.
 *
 * @param result  The replay result to render.
 * @param width   Terminal width (default 120).
 */
export function renderAsciiTimeline(result: CounterfactualReplayResult, width = 120): string {
  const bar = '═'.repeat(width);
  const thinBar = '─'.repeat(width);
  const halfWidth = Math.floor((width - 3) / 2); // each column width
  const promptWidth = Math.max(20, halfWidth - 12); // allow for prefix + icon

  const lines: string[] = [];

  // Header
  lines.push(bar);
  lines.push(' Time Machine Timeline Diff');
  const branchShort = result.branchPoint.id.slice(0, 8);
  const origShort = result.originalTimelineId.slice(0, 8);
  const altShort = result.newTimelineId.slice(0, 8);
  lines.push(` Branch: ${branchShort}  Original: ${origShort}  Alternate: ${altShort}`);
  lines.push(bar);
  lines.push('');

  // Branch point
  lines.push(`  ${'─── BRANCH POINT ' + '─'.repeat(Math.max(0, width - 20))}`);
  const bpDate = formatDate(result.branchPoint.timestamp);
  const bpRow = formatNodeRow(`  [${bpDate}]`, result.branchPoint, 60);
  lines.push(bpRow);
  lines.push('');

  // Column headers
  const origHeader = 'ORIGINAL TIMELINE';
  const altHeader = 'ALTERNATE TIMELINE';
  const origPadded = origHeader.padEnd(halfWidth);
  lines.push(`  ${origPadded}   ${altHeader}`);
  lines.push(`  ${thinBar}`);
  lines.push('');

  // Convergent nodes (show in both columns)
  for (const node of result.divergence.convergent) {
    const left = formatNodeRow('≡', node, promptWidth);
    const right = formatNodeRow('≡', node, promptWidth);
    const leftPadded = left.padEnd(halfWidth);
    lines.push(`  ${leftPadded} │ ${right}`);
  }

  // Unreachable nodes (original only — left column)
  for (const node of result.divergence.unreachable) {
    const left = formatNodeRow('✗', node, promptWidth);
    const leftPadded = left.padEnd(halfWidth);
    lines.push(`  ${leftPadded} │`);
  }

  // Divergent nodes (alternate only — right column)
  for (const node of result.divergence.divergent) {
    const right = formatNodeRow('↻', node, promptWidth);
    const leftPadded = ''.padEnd(halfWidth);
    lines.push(`  ${leftPadded} │ ${right}`);
  }

  lines.push('');
  lines.push(`  ${thinBar}`);

  // Summary
  const outcomeLabel = result.outcomeEquivalent ? 'YES' : 'NO';
  lines.push(`  Outcome equivalent: ${outcomeLabel}  (or NO)`
    .replace('  (or NO)', '')
    .replace('(or YES)', '')
  );
  // Simple clean line
  lines[lines.length - 1] = `  Outcome equivalent: ${outcomeLabel}`;

  const convergentCount = result.divergence.convergent.length;
  const divergentCount = result.divergence.divergent.length;
  const unreachableCount = result.divergence.unreachable.length;
  lines.push(`  Convergent: ${convergentCount}  │  Divergent: ${divergentCount}  │  Unreachable: ${unreachableCount}`);
  lines.push(bar);

  return lines.join('\n');
}
