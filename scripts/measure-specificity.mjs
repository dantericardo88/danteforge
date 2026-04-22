#!/usr/bin/env node
/**
 * Metric: P0 recommendation specificity score (0-9)
 * For each of the top 3 P0 items, score 0-3:
 *   +1 if it names a specific file path (src/... pattern)
 *   +1 if it names a specific function/method or line number
 *   +1 if the action command has targeted args (not just generic "danteforge improve X")
 * Max score: 9 (3 per item × 3 items)
 */
import { execSync } from 'node:child_process';

const FILE_PATH_RE = /\bsrc\/[a-zA-Z0-9_\-/]+\.[a-z]+/;
const FUNC_RE = /\b[a-zA-Z_][a-zA-Z0-9_]+\(\)|:[0-9]+\b/;
const GENERIC_CMD_RE = /^danteforge improve "[^"]+"\s*$/;

let output;
try {
  // Capture stderr too — logger writes [INFO] lines to stderr
  output = execSync('node dist/index.js measure 2>&1', { encoding: 'utf8', timeout: 30000, shell: true });
} catch (err) {
  output = (err.stdout ?? '') + (err.stderr ?? '');
}

// Extract P0 block lines
const lines = output.split('\n');
const p0Start = lines.findIndex(l => l.includes('P0 gaps:'));
if (p0Start === -1) {
  console.log('ERROR: No P0 gaps section found in output');
  console.log(output.slice(0, 500));
  process.exit(1);
}

// Collect 3 P0 item blocks (each is 1-2 lines: description + action)
const p0Lines = lines.slice(p0Start + 1, p0Start + 10);

// Strip [INFO] prefix from all lines
const stripped = p0Lines.map(l => l.replace(/^\[INFO\]\s?/, ''));

// Group into items: numbered lines (1./2./3.) start a new item
const items = [];
let current = [];
for (const line of stripped) {
  if (/^\s+[123]\./.test(line)) {
    if (current.length) items.push(current.join('\n'));
    current = [line];
  } else if (current.length > 0 && line.trim()) {
    current.push(line);
  }
}
if (current.length) items.push(current.join('\n'));

let totalScore = 0;
const breakdown = [];

for (const item of items.slice(0, 3)) {
  let score = 0;
  const hasFilePath = FILE_PATH_RE.test(item);
  const hasFunc = FUNC_RE.test(item);
  const actionMatch = item.match(/→\s*(.+)$/m);
  const action = actionMatch ? actionMatch[1].trim() : '';
  const hasSpecificCmd = action.length > 0 && !GENERIC_CMD_RE.test(action);

  if (hasFilePath) score += 1;
  if (hasFunc) score += 1;
  if (hasSpecificCmd) score += 1;
  totalScore += score;

  const firstLine = item.split('\n')[0].trim().slice(0, 80);
  breakdown.push(`  [${score}/3] ${firstLine} | file:${hasFilePath?1:0} func:${hasFunc?1:0} cmd:${hasSpecificCmd?1:0}`);
}

console.log(totalScore);
console.log(`Breakdown (${items.slice(0,3).length} P0 items):`);
breakdown.forEach(b => console.log(b));
