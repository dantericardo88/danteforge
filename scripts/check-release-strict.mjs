import {
  cleanupSandbox,
  createReleaseSandbox,
  releaseEnv,
  run,
} from './release-check-utils.mjs';

const repoRoot = process.cwd();
const sandbox = await createReleaseSandbox(repoRoot, 'danteforge-release-strict-');
const env = releaseEnv(sandbox.homeDir, sandbox.xdgConfigHome);

try {
  console.log(`Creating strict release checkout in ${sandbox.checkoutDir}`);

  run('npm', ['run', 'check:repo-hygiene:strict'], sandbox.checkoutDir, env);
  run('npm', ['ci'], sandbox.checkoutDir, env);
  run('npm', ['--prefix', 'vscode-extension', 'ci'], sandbox.checkoutDir, env);
  run('npm', ['run', 'verify:all'], sandbox.checkoutDir, env);
  run('npm', ['run', 'check:cli-smoke'], sandbox.checkoutDir, env);
  run('npm', ['run', 'check:plugin-manifests'], sandbox.checkoutDir, env);
  run('npm', ['run', 'release:check:install-smoke'], sandbox.checkoutDir, env);
  run('npm', ['run', 'pack:dry-run'], sandbox.checkoutDir, env);
  run('npm', ['run', 'check:third-party-notices'], sandbox.checkoutDir, env);

  await cleanupSandbox(sandbox.tempRoot);
  console.log('Strict release check passed');
} catch (error) {
  console.error(`Strict release check failed. Temporary checkout preserved at: ${sandbox.checkoutDir}`);
  throw error;
}
