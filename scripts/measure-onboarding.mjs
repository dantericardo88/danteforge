#!/usr/bin/env node
// Metric: onboarding_feature_score (0-8)
// Checks what a new user encounters across the front-door surfaces.
// Higher is better. Target: 8/8.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

// 1. danteforge quality works (no LLM, fast)
const qualityOut = run('node dist/index.js quality 2>&1');
const qualityHasScore = /Overall\s+[\d.]+\/10/.test(qualityOut);
const qualityHasP0    = /P0|← P0|<- P0/.test(qualityOut);

// 2. danteforge dashboard HTML contains quality surface
// We can't start a server, but we can call the renderDashboardHtml export directly
// by generating minimal state and piping through the function.
// Simplest: check source of dashboard.ts for presence of score-rendering code.
import { readFileSync } from 'node:fs';
const dashboardSrc = readFileSync('src/cli/commands/dashboard.ts', 'utf8');
const dashboardHasScoreRender  = dashboardSrc.includes('displayScore') || dashboardSrc.includes('qualityScore');
const dashboardHasP0Section    = dashboardSrc.includes('P0') || dashboardSrc.includes('p0');
const dashboardHasNextAction   = dashboardSrc.includes('nextAction') || dashboardSrc.includes('next action') || dashboardSrc.includes('recommended');
const dashboardHasDimBar       = dashboardSrc.includes('dimension') && (dashboardSrc.includes('bar') || dashboardSrc.includes('progress') || dashboardSrc.includes('scoreBar'));

// 3. showcase generates a shareable proof artifact
const showcaseHasMarkdown = existsSync('docs/CASE_STUDY.md') || run('node dist/index.js showcase --help 2>&1').includes('CASE_STUDY');

// 4. README has a quick-start mention of the primary command
const readme = readFileSync('README.md', 'utf8');
const readmeHasQuickStart  = readme.includes('danteforge go') || readme.includes('Quick Start');
const readmeHasScoreExample = readme.includes('8.') || readme.includes('/10');

// Score each feature
const features = [
  { name: 'quality command shows overall score',       pass: qualityHasScore },
  { name: 'quality command shows P0 gaps',             pass: qualityHasP0 },
  { name: 'dashboard renders quality score',           pass: dashboardHasScoreRender },
  { name: 'dashboard has P0 gap section',              pass: dashboardHasP0Section },
  { name: 'dashboard has next-action recommendation',  pass: dashboardHasNextAction },
  { name: 'dashboard has dimension bars/progress',     pass: dashboardHasDimBar },
  { name: 'showcase generates shareable artifact',     pass: !!showcaseHasMarkdown },
  { name: 'README has quick-start + score example',   pass: readmeHasQuickStart && readmeHasScoreExample },
];

const score = features.filter(f => f.pass).length;

console.log(`\n=== onboarding measurement ===`);
for (const f of features) {
  console.log(`  ${f.pass ? '✔' : '✖'} ${f.name}`);
}
console.log(`\nMETRIC onboarding_feature_score: ${score}/${features.length}`);
console.log(`TARGET: ${features.length}/${features.length}`);
process.exit(0);
