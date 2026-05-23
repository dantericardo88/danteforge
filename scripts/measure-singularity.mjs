#!/usr/bin/env node
// measure-singularity.mjs — DanteForge Singularity Score
//
// Measures what fraction of recent commits were DanteForge-assisted.
// Mirrors Aider's "62% of Aider's own code is written by Aider" metric.
//
// Classification:
//   - Commit contains "Co-Authored-By: Claude" → DanteForge-assisted
//   - Commit author email contains "danteforge", "dantecode", or "claude"
//     OR subject matches known DanteForge command prefixes → assisted
//
// Output: writes .danteforge/metrics/singularity.json
// Exit 0 if singularity% >= --assert-min (default: no assertion)
// Exit 1 if assertion fails

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const METRICS_DIR = path.join(process.cwd(), '.danteforge', 'metrics');
const SINGULARITY_FILE = path.join(METRICS_DIR, 'singularity.json');

const args = process.argv.slice(2);
const assertMinArg = args.find(a => a.startsWith('--assert-min'));
const assertMin = assertMinArg
  ? parseFloat(assertMinArg.split('=')[1] ?? args[args.indexOf(assertMinArg) + 1] ?? '0')
  : null;
const sinceArg = args.find(a => a.startsWith('--since'));
const since = sinceArg
  ? (sinceArg.split('=')[1] ?? args[args.indexOf(sinceArg) + 1] ?? '90 days ago')
  : '90 days ago';
const jsonOnly = args.includes('--json');

// ── Fetch git log ─────────────────────────────────────────────────────────────

function getCommits(sinceStr) {
  try {
    const raw = execSync(
      `git log --format="%H|||%ae|||%s|||%b" --since="${sinceStr}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const [hash, email, subject, ...bodyParts] = line.split('|||');
      return { hash: hash ?? '', email: email ?? '', subject: subject ?? '', body: bodyParts.join(' ') };
    });
  } catch {
    return [];
  }
}

// ── Classification ────────────────────────────────────────────────────────────

const ASSISTED_EMAIL_PATTERN = /danteforge|dantecode|claude|anthropic/i;
const ASSISTED_SUBJECT_PATTERN = /^(feat|fix|refactor|perf|test|chore|score|wave|inferno|crusade)\(/i;
const COAUTHORED_PATTERN = /Co-Authored-By:.*Claude/i;

function classifyCommit(commit) {
  if (COAUTHORED_PATTERN.test(commit.body)) return 'danteforge';
  if (ASSISTED_EMAIL_PATTERN.test(commit.email)) return 'danteforge';
  // Commits matching DanteForge command patterns in subject (heuristic)
  if (ASSISTED_SUBJECT_PATTERN.test(commit.subject) && commit.body.includes('Co-Authored')) return 'danteforge';
  return 'human';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const commits = getCommits(since);
const total = commits.length;

if (total === 0) {
  console.error('[singularity] No commits found in the last period.');
  process.exit(0);
}

const classified = commits.map(c => ({ ...c, classification: classifyCommit(c) }));
const assisted = classified.filter(c => c.classification === 'danteforge');
const singularity = (assisted.length / total) * 100;

const result = {
  generatedAt: new Date().toISOString(),
  since,
  totalCommits: total,
  assistedCommits: assisted.length,
  humanCommits: total - assisted.length,
  singularityPercent: Math.round(singularity * 10) / 10,
  // Comparison reference
  aiderBaseline: 62,
  gap: Math.round((62 - singularity) * 10) / 10,
  topAssistedCommits: assisted.slice(0, 5).map(c => ({ hash: c.hash.slice(0, 8), subject: c.subject })),
};

// Write metrics file
fs.mkdirSync(METRICS_DIR, { recursive: true });
fs.writeFileSync(SINGULARITY_FILE, JSON.stringify(result, null, 2), 'utf-8');

if (jsonOnly) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`[singularity] Commits analysed: ${total} (since ${since})`);
  console.log(`[singularity] DanteForge-assisted: ${assisted.length} (${result.singularityPercent}%)`);
  console.log(`[singularity] Human-only:          ${total - assisted.length}`);
  console.log(`[singularity] Aider baseline:       62%  |  DanteForge: ${result.singularityPercent}%  |  Gap: ${result.gap}%`);
  console.log(`[singularity] Report: ${SINGULARITY_FILE}`);

  if (result.topAssistedCommits.length > 0) {
    console.log('[singularity] Top assisted commits:');
    for (const c of result.topAssistedCommits) {
      console.log(`  ${c.hash}  ${c.subject}`);
    }
  }
}

// ── Assertion ─────────────────────────────────────────────────────────────────

if (assertMin !== null) {
  if (singularity >= assertMin) {
    console.log(`[singularity] PASS — ${result.singularityPercent}% >= ${assertMin}% threshold`);
    process.exit(0);
  } else {
    console.error(`[singularity] FAIL — ${result.singularityPercent}% < ${assertMin}% threshold`);
    process.exit(1);
  }
}

process.exit(0);
