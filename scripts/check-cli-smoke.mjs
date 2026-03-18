import { spawnSync } from 'node:child_process';

const root = process.cwd();
const distEntry = 'dist/index.js';

function run(args, expectedPatterns) {
  const result = spawnSync(process.execPath, [distEntry, ...args], {
    cwd: root,
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

run(['--help'], [/autoforge/i, /awesome-scan/i]);
run(['party', '--help'], [/--isolation/i]);
run(['autoforge', '--help'], [/autoforge .*?\[goal\]/i]);
run(['autoforge', '--dry-run'], [/AutoForge/i, /Plan/i]);
run(['awesome-scan'], [/Skill Scanner/i, /Total:\s+\d+\s+skill/i]);

console.log('CLI smoke checks passed');
