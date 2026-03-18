import {
  cleanupSandbox,
  createReleaseSandbox,
  releaseEnv,
  run,
} from './release-check-utils.mjs';

const repoRoot = process.cwd();
const sandbox = await createReleaseSandbox(repoRoot, 'danteforge-release-fresh-');
const env = releaseEnv(sandbox.homeDir, sandbox.xdgConfigHome);

try {
  console.log(`Creating simulated fresh checkout in ${sandbox.checkoutDir}`);

  run('npm', ['run', 'check:repo-hygiene:strict'], sandbox.checkoutDir, env);
  run('npm', ['ci'], sandbox.checkoutDir, env);
  run('npm', ['--prefix', 'vscode-extension', 'ci'], sandbox.checkoutDir, env);
  run('npm', ['run', 'release:check'], sandbox.checkoutDir, env);

  await cleanupSandbox(sandbox.tempRoot);
  console.log('Simulated fresh checkout release check passed');
} catch (error) {
  console.error(`Simulated fresh checkout failed. Temporary checkout preserved at: ${sandbox.checkoutDir}`);
  throw error;
}
