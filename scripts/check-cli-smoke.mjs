import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const distEntry = path.join(root, 'dist', 'index.js');
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'danteforge-cli-smoke-'));

function run(args, expectedPatterns) {
  const result = spawnSync(process.execPath, [distEntry, ...args], {
    cwd: smokeRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      `CLI smoke command failed: danteforge ${args.join(' ')}\n` +
      `exit=${result.status}\nstdout=${stdout}\nstderr=${stderr}`,
    );
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  for (const pattern of expectedPatterns) {
    if (!pattern.test(output)) {
      throw new Error(
        `CLI smoke command did not match ${pattern}:\n` +
        `danteforge ${args.join(' ')}\n${output}`,
      );
    }
  }

  console.log(`ok - danteforge ${args.join(' ') || '--help'}`);
}

function runNotContains(args, forbiddenPatterns) {
  const result = spawnSync(process.execPath, [distEntry, ...args], {
    cwd: smokeRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) {
    throw result.error;
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(output)) {
      throw new Error(
        `CLI smoke command matched forbidden pattern ${pattern}:\n` +
        `danteforge ${args.join(' ')}\n${output}`,
      );
    }
  }

  console.log(`ok (not-contains) - danteforge ${args.join(' ')}`);
}

try {
  run(['--help'], [/autoforge/i, /awesome-scan/i]);
  run(['party', '--help'], [/--isolation/i]);
  run(['autoforge', '--help'], [/autoforge .*?\[goal\]/i]);
  run(['rubric-score', '--help'], [/--matrix/i, /diff \[options\]/i]);
  run(['autoforge', '--dry-run'], [/AutoForge/i, /Plan/i]);
  run(['awesome-scan'], [/Skill Scanner/i, /Total:\s+\d+\s+skill/i]);

  // Beginner command gates verify source truth matches shipped truth.
  run(['explain', 'magic'], [/MAGIC|magic/i, /preset|power/i]);
  run(['demo', '--help'], [/demo/i, /fixture/i]);
  run(['help'], [/danteforge plan/i, /danteforge explain/i, /danteforge go/i]);
  run(['go', '--help'], [/--yes/i, /--simple/i]);
  runNotContains(['help'], [/danteforge magic\s/]);

  // Launch hardening gates.
  run(['measure'], [/\/10/i]);
  run(['demo'], [/danteforge go/i]);
  run(['quickstart', '--help'], [/quickstart/i, /simple/i]);
  runNotContains(['demo'], [/quickstart/i]);
  runNotContains(['measure'], [/needs-work/i]);

  console.log('CLI smoke checks passed');
} finally {
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}
