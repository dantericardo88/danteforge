#!/usr/bin/env node
// Metric: count of dimensions where compete --validate sees drift > 0.2
// These represent cases where validate uses a DIFFERENT evidence path than measure --strict
// Target: 0 (validate and strict scorer must agree on all shared dimensions)

import { execSync } from 'node:child_process';

const KNOWN_CEILINGS = { communityAdoption: 4.0, enterpriseReadiness: 9.0 };

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

// 1. Run compete --validate and capture drift lines
const validateOut = run('node dist/index.js compete --validate 2>&1');
const driftLines = validateOut.split('\n').filter(l => l.includes('drift:'));

let validateDivergences = 0;
const driftDetails = [];
for (const line of driftLines) {
  const match = line.match(/drift:\s*([\d.]+)/);
  if (!match) continue;
  const drift = parseFloat(match[1]);
  if (drift > 0.2) {
    validateDivergences++;
    driftDetails.push(line.trim());
  }
}

// 2. Run measure --strict --full and parse dim values
const strictOut = run('node dist/index.js measure --strict --full 2>&1');
const strictDims = {};
for (const line of strictOut.split('\n')) {
  const m = line.match(/(\w+)\s+([\d.]+)\s+\(weight/);
  if (m) strictDims[m[1].toLowerCase()] = parseFloat(m[2]);
}

// 3. Run compete --validate to extract assessed values (what validate thinks each dim is)
const assessedDims = {};
for (const line of validateOut.split('\n')) {
  // Pattern: "  Autonomy & Self-Direction: matrix=10.0, assessed=6.5 (..."
  const m = line.match(/assessed=([\d.]+)/);
  const labelMatch = line.match(/^\[INFO\]\s+(\S.*?):\s+matrix=/);
  if (m && labelMatch) {
    assessedDims[labelMatch[1].toLowerCase().replace(/[^a-z]/g, '')] = parseFloat(m[1]);
  }
}

// 4. Report
console.log(`\n=== validate-coherence measurement ===`);
console.log(`validate drift count (>0.2): ${validateDivergences}`);
if (driftDetails.length > 0) {
  console.log(`\nDrifted dimensions:`);
  for (const d of driftDetails) console.log(`  ${d}`);
}

console.log(`\nStrict scorer dims (sample):`);
for (const [k, v] of Object.entries(strictDims).slice(0, 6)) {
  console.log(`  ${k}: ${v}`);
}

console.log(`\nMETRIC validate_divergence_count: ${validateDivergences}`);
console.log(`TARGET: 0`);
process.exit(0);
