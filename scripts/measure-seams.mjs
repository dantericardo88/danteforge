#!/usr/bin/env node
// Metric: count of src/cli/commands/*.ts files with at least one _ injection seam param
import { readdirSync, readFileSync } from 'node:fs';
const files = readdirSync('src/cli/commands').filter(f => f.endsWith('.ts'));
const withSeams = files.filter(f => {
  const content = readFileSync('src/cli/commands/' + f, 'utf8');
  return /_[a-z][A-Za-z0-9]*\?:/.test(content);
});
const withoutSeams = files.filter(f => {
  const content = readFileSync('src/cli/commands/' + f, 'utf8');
  return !/_[a-z][A-Za-z0-9]*\?:/.test(content);
});
process.stdout.write(`seamed=${withSeams.length} total=${files.length} remaining=${withoutSeams.length}\n`);
process.stdout.write(withoutSeams.join('\n') + '\n');
