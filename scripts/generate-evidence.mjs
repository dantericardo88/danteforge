import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const m = JSON.parse(fs.readFileSync('.danteforge/compete/matrix.json', 'utf8'));
const evidenceDir = '.danteforge/outcome-evidence';
fs.mkdirSync(evidenceDir, { recursive: true });

let gitSha;
try {
  gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  gitSha = 'unknown';
}

let total = 0, passed = 0, failed = 0, skipped = 0;

for (const dim of m.dimensions) {
  if (!dim.outcomes || dim.outcomes.length === 0) continue;

  for (const outcome of dim.outcomes) {
    if (!outcome.command) {
      if (outcome.kind === 'production-usage-fresh') {
        skipped++;
        continue;
      }
      skipped++;
      continue;
    }

    total++;
    const startedAt = new Date().toISOString();
    let exitCode = -1;
    let stdout = '';

    try {
      stdout = execSync(outcome.command, {
        encoding: 'utf8',
        timeout: outcome.timeout_ms || 30000,
        cwd: process.cwd(),
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status ?? 1;
      stdout = (err.stdout || '') + (err.stderr || '');
    }

    const expectedExit = outcome.expected_exit ?? 0;
    const ok = exitCode === expectedExit;

    const evidence = {
      outcomeId: outcome.id,
      dimensionId: dim.id,
      tier: outcome.tier,
      kind: outcome.kind,
      passed: ok,
      exitCode,
      expectedExitCode: expectedExit,
      stdoutTail: (stdout || '').slice(-500),
      startedAt,
      finishedAt: new Date().toISOString(),
      gitSha,
      command: outcome.command,
    };

    const filename = `${gitSha.slice(0, 40)}-${dim.id}-${outcome.id}.json`;
    fs.writeFileSync(path.join(evidenceDir, filename), JSON.stringify(evidence, null, 2));

    if (ok) {
      passed++;
      process.stdout.write(`  PASS  ${dim.id}/${outcome.id} (${outcome.tier})\n`);
    } else {
      failed++;
      process.stdout.write(`  FAIL  ${dim.id}/${outcome.id} (${outcome.tier}) exit=${exitCode}\n`);
    }
  }
}

console.log(`\nDone: ${total} outcomes — ${passed} passed, ${failed} failed, ${skipped} skipped (production-usage-fresh)`);
