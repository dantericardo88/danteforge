#!/usr/bin/env node
// CI-ready corpus integrity check for the Pass 11+ proof spine.
//
// Runs `verifyProofCorpus` over `.danteforge/evidence/` (or a caller-supplied
// directory). Exits non-zero if ANY proof-bearing receipt fails verification
// or is unreadable; succeeds when the corpus is CLEAN (verified + skipped only).
//
// Wired into `npm run verify:all` so integrity drift cannot land silently.
//
// Usage:
//   node scripts/check-proof-integrity.mjs                 # default: .danteforge/evidence
//   node scripts/check-proof-integrity.mjs <dir>           # custom directory
//   node scripts/check-proof-integrity.mjs --json          # machine-readable output

import { resolve } from 'node:path';
import 'tsx/esm';

const { verifyProofCorpus } = await import('../src/cli/commands/proof.ts');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const dirArg = args.find((a) => !a.startsWith('--')) ?? '.danteforge/evidence';
const root = resolve(process.cwd(), dirArg);

const report = await verifyProofCorpus(root, { cwd: process.cwd(), skipGit: false });

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const adoptionPct = (report.proofAdoptionRate * 100).toFixed(1);
  const integrity = report.failed === 0 && report.errored === 0 ? 'CLEAN' : 'DEGRADED';
  console.log(`[proof-integrity] ${integrity}  scanned=${report.totalFiles}  verified=${report.verified}  failed=${report.failed}  skipped=${report.skipped}  errored=${report.errored}  adoption=${adoptionPct}%`);
  if (report.failed > 0) {
    console.error(`[proof-integrity] ${report.failed} receipt(s) FAILED verification:`);
    for (const fail of report.failures) {
      console.error(`  - ${fail.path}`);
      for (const err of fail.errors.slice(0, 3)) console.error(`      ${err}`);
    }
  }
  if (report.errored > 0) {
    console.error(`[proof-integrity] ${report.errored} file(s) UNREADABLE:`);
    for (const e of report.errors) {
      console.error(`  - ${e.path}: ${e.errors.join('; ')}`);
    }
  }
}

const exitCode = report.failed > 0 || report.errored > 0 ? 1 : 0;
process.exit(exitCode);
