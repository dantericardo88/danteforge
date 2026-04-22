#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

// Get staged .ts files
let stagedFiles;
try {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  stagedFiles = output.split('\n').filter((f) => f.endsWith('.ts'));
} catch {
  // git not available or not in a repo — skip
  process.exit(0);
}

if (stagedFiles.length === 0) {
  // No TypeScript files staged; nothing to check
  process.exit(0);
}

console.log(`[pre-commit] Typechecking ${stagedFiles.length} staged .ts file(s)...`);

try {
  execFileSync('npx', ['tsc', '--noEmit'], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
    // tsc / npx not available — skip gracefully
    console.warn('[pre-commit] tsc not available, skipping typecheck.');
    process.exit(0);
  }
  console.error('[pre-commit] TypeScript typecheck failed. Fix errors before committing.');
  process.exit(1);
}

console.log('[pre-commit] Typecheck passed.');
process.exit(0);
