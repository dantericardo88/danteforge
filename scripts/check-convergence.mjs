#!/usr/bin/env node
/**
 * check-convergence.mjs
 *
 * Machine-readable convergence gate: runs the harsh scorer with strict overrides
 * and exits 0 (PASS) or 1 (FAIL) based on whether all target dimensions meet
 * the required score.
 *
 * This script is the canonical tool that agents MUST run after each wave to
 * decide whether the loop should continue. It replaces agent self-assessment.
 *
 * Usage:
 *   node scripts/check-convergence.mjs                     # check overall >= 9.0
 *   node scripts/check-convergence.mjs --target 8.5        # custom overall target
 *   node scripts/check-convergence.mjs --dim autonomy      # check one dimension
 *   node scripts/check-convergence.mjs --dim autonomy,testing --target 9.0
 *   node scripts/check-convergence.mjs --all-dims          # every dimension must meet target
 *
 * Exit codes:
 *   0  — PASS: all checked dimensions >= target
 *   1  — FAIL: one or more dimensions below target (loop must continue)
 *   2  — ERROR: could not run scorer (configuration/dependency issue)
 */

const ROOT = process.cwd();

// ── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find(a => a.startsWith(`${flag}=`));
  return eq ? eq.split('=').slice(1).join('=') : null;
}

const TARGET = parseFloat(getArg('--target') ?? '9.0');
const DIM_ARG = getArg('--dim');
const ALL_DIMS = process.argv.includes('--all-dims');
const JSON_OUT = process.argv.includes('--json');

const TARGET_DIMS = DIM_ARG ? DIM_ARG.split(',').map(s => s.trim()) : null;

// ── Scorer ────────────────────────────────────────────────────────────────────

async function runHarshScore() {
  const { execSync } = await import('node:child_process');

  // Primary: measure --json (canonical CLI path, measure.v1 schema)
  try {
    const raw = execSync('node dist/index.js measure --json --level standard', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(raw);
    // Normalise measure.v1 schema to { overall, dimensions }
    if (parsed.overallScore !== undefined && Array.isArray(parsed.dimensions)) {
      const dims = {};
      for (const d of parsed.dimensions) {
        if (d.name && d.score !== undefined) dims[d.name] = d.score;
      }
      return { overall: parsed.overallScore, dimensions: dims, raw: parsed };
    }
    return parsed;
  } catch {
    // Fallback: parse text output of measure (no --json)
    try {
      const text = execSync('node dist/index.js measure --level standard', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return parseTextScore(text);
    } catch (err2) {
      console.error('[convergence] ERROR: Could not run scorer:', err2.message);
      process.exit(2);
    }
  }
}

function parseTextScore(text) {
  // Parse human-readable output from `measure` or `score` commands.
  const lines = text.split('\n');
  const result = { overall: null, dimensions: {}, raw: text };

  for (const line of lines) {
    // Overall score line: "Score: 8.4/10", "8.4/10", or "Overall  8.4 / 10"
    const overallMatch = line.match(/(?:Score:|overall:?\s*|Overall\s+)(\d+(?:\.\d+)?)\s*\/\s*10/i);
    if (overallMatch) {
      result.overall = parseFloat(overallMatch[1]);
      continue;
    }
    // Standalone score like "  8.4/10  - excellent"
    const standaloneMatch = line.match(/^\s+(\d+(?:\.\d+)?)\s*\/\s*10\s+[-–]/);
    if (standaloneMatch && result.overall === null) {
      result.overall = parseFloat(standaloneMatch[1]);
      continue;
    }
    // Dimension line: "  functionality         8.2/10" or "  Functionality  8.2"
    const dimMatch = line.match(/^\s{2,}(\w+)\s+(\d+(?:\.\d+)?)(?:\/10)?(?:\s|$)/);
    if (dimMatch && parseFloat(dimMatch[2]) <= 10) {
      result.dimensions[dimMatch[1]] = parseFloat(dimMatch[2]);
    }
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nDanteForge convergence check — target: ${TARGET}/10`);
if (TARGET_DIMS) console.log(`  Dimensions: ${TARGET_DIMS.join(', ')}`);
else if (ALL_DIMS) console.log('  Mode: all dimensions');
else console.log('  Mode: overall score');
console.log();

const scoreData = await runHarshScore();

const overall = scoreData.overall ?? scoreData.displayScore ?? null;
const dims = scoreData.dimensions ?? scoreData.displayDimensions ?? {};

// Determine what to check
let checks = [];

if (TARGET_DIMS) {
  checks = TARGET_DIMS.map(dim => ({
    name: dim,
    score: dims[dim] ?? null,
    target: TARGET,
  }));
} else if (ALL_DIMS) {
  checks = Object.entries(dims).map(([name, score]) => ({ name, score, target: TARGET }));
} else {
  checks = [{ name: 'overall', score: overall, target: TARGET }];
}

// Print results
let failures = 0;

for (const { name, score, target } of checks) {
  if (score === null) {
    console.log(`  UNKNOWN  ${name.padEnd(24)} (not found in score output)`);
    failures++;
    continue;
  }

  const passed = score >= target;
  const gap = (score - target).toFixed(1);
  const gapStr = passed ? `(+${gap})` : `(gap: ${gap})`;
  const statusIcon = passed ? 'PASS  ' : 'FAIL  ';

  console.log(`  ${statusIcon} ${name.padEnd(24)} ${score.toFixed(1)}/10  ${gapStr}`);
  if (!passed) failures++;
}

console.log();

if (JSON_OUT) {
  console.log(JSON.stringify({ target: TARGET, checks, failures, pass: failures === 0 }, null, 2));
}

if (failures === 0) {
  console.log(`PASS — all checked dimensions meet target ${TARGET}/10. Loop may stop.\n`);
  process.exit(0);
} else {
  console.log(`FAIL — ${failures} dimension(s) below target ${TARGET}/10. Loop must continue.`);
  console.log('Next step: run another wave targeting the lowest-scoring dimension.\n');
  process.exit(1);
}
