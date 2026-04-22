import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-install-smoke-'));
const packDir = path.join(tempRoot, 'pack');
const projectDir = path.join(tempRoot, 'project');
const homeDir = path.join(tempRoot, 'home');

function run(command, args, cwd, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  const executable = command === 'npm'
    ? (npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'))
    : process.platform === 'win32'
      ? `${command}.cmd`
      : command;
  const resolvedArgs = command === 'npm'
    ? (npmExecPath ? [npmExecPath, ...args] : args)
    : args;
  const result = spawnSync(executable, resolvedArgs, {
    cwd,
    stdio: options.stdio ?? 'inherit',
    env: options.env ?? process.env,
    shell: process.platform === 'win32' && !npmExecPath,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}${
        result.error ? ` (${result.error.message})` : ''
      }`,
    );
  }

  return result;
}

function getLocalBinPath(projectRoot, binName) {
  const executable = process.platform === 'win32' ? `${binName}.cmd` : binName;
  return path.join(projectRoot, 'node_modules', '.bin', executable);
}

async function assertExists(targetPath, message) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(`${message}: ${targetPath}`);
  }
}

async function assertMissing(targetPath, message) {
  try {
    await fs.access(targetPath);
    throw new Error(`${message}: ${targetPath}`);
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/i.test(error.message)) {
      throw error;
    }
  }
}

async function assertFileContains(targetPath, pattern, message) {
  const content = await fs.readFile(targetPath, 'utf8');
  if (!pattern.test(content)) {
    throw new Error(`${message}: ${targetPath}`);
  }
}

async function assertFileDoesNotContain(targetPath, pattern, message) {
  const content = await fs.readFile(targetPath, 'utf8');
  if (pattern.test(content)) {
    throw new Error(`${message}: ${targetPath}`);
  }
}

try {
  console.log(`Creating install smoke workspace in ${tempRoot}`);
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });

  run('npm', ['pack', '--pack-destination', packDir], repoRoot);

  const tarballs = (await fs.readdir(packDir)).filter(name => name.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tarballs.length}.`);
  }

  const tarballPath = path.join(packDir, tarballs[0]);

  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'danteforge-install-smoke',
      private: true,
      version: '0.0.0',
    }, null, 2),
    'utf8',
  );

  const installEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    DANTEFORGE_HOME: homeDir,
  };

  if (process.platform !== 'win32') {
    installEnv.XDG_CONFIG_HOME = path.join(homeDir, '.config');
  }

  run('npm', ['install', '--no-package-lock', tarballPath], projectDir, { env: installEnv });

  await assertExists(
    getLocalBinPath(projectDir, 'danteforge'),
    'Installed danteforge binary was not created',
  );
  await assertExists(
    getLocalBinPath(projectDir, 'dforge'),
    'Installed dforge alias was not created',
  );
  await assertMissing(
    path.join(homeDir, '.codex', 'skills', 'test-driven-development', 'SKILL.md'),
    'Installed DanteForge package unexpectedly modified Codex skills during install',
  );
  await assertMissing(
    path.join(homeDir, '.codex', 'AGENTS.md'),
    'Installed DanteForge package unexpectedly modified the Codex global bootstrap during install',
  );
  await assertMissing(
    path.join(projectDir, '.cursor', 'rules', 'danteforge.mdc'),
    'Installed DanteForge package unexpectedly created Cursor bootstrap files during install',
  );

  run('npm', ['exec', '--', 'danteforge', 'review'], projectDir, { env: installEnv });
  run('npm', ['exec', '--', 'dforge', '--help'], projectDir, { env: installEnv });
  run('npm', ['exec', '--', 'danteforge', 'setup', 'assistants'], projectDir, { env: installEnv });
  run('npm', ['exec', '--', 'danteforge', 'setup', 'assistants', '--assistants', 'cursor'], projectDir, { env: installEnv });

  await assertExists(
    path.join(projectDir, '.danteforge', 'CURRENT_STATE.md'),
    'Installed DanteForge review command did not create CURRENT_STATE.md',
  );
  await assertExists(
    path.join(projectDir, '.danteforge', 'STATE.yaml'),
    'Installed DanteForge review command did not create STATE.yaml',
  );
  await assertExists(
    path.join(homeDir, '.claude', 'skills', 'test-driven-development', 'SKILL.md'),
    'Explicit assistant setup did not install Claude skills',
  );
  await assertExists(
    path.join(homeDir, '.codex', 'skills', 'test-driven-development', 'SKILL.md'),
    'Explicit assistant setup did not install Codex skills',
  );
  await assertExists(
    path.join(homeDir, '.codex', 'skills', 'danteforge-cli', 'SKILL.md'),
    'Explicit assistant setup did not install the Codex DanteForge CLI skill',
  );
  await assertExists(
    path.join(homeDir, '.gemini', 'antigravity', 'skills', 'test-driven-development', 'SKILL.md'),
    'Explicit assistant setup did not install Antigravity skills',
  );
  await assertExists(
    path.join(homeDir, '.gemini', 'antigravity', 'skills', 'danteforge-cli', 'SKILL.md'),
    'Explicit assistant setup did not install the Antigravity DanteForge CLI skill',
  );
  await assertExists(
    path.join(homeDir, '.config', 'opencode', 'skills', 'test-driven-development', 'SKILL.md'),
    'Explicit assistant setup did not install OpenCode skills',
  );
  await assertFileContains(
    path.join(homeDir, '.codex', 'config.toml'),
    /setup-assistants = "npx danteforge setup assistants --assistants codex"/,
    'Explicit assistant setup did not sync Codex utility aliases',
  );
  await assertFileContains(
    path.join(homeDir, '.codex', 'config.toml'),
    /doctor-live = "npx danteforge doctor --live"/,
    'Explicit assistant setup did not sync the Codex live-doctor alias',
  );
  await assertFileContains(
    path.join(homeDir, '.codex', 'config.toml'),
    /df-verify = "npx danteforge verify"/,
    'Explicit assistant setup did not sync the Codex df-verify alias',
  );
  await assertFileDoesNotContain(
    path.join(homeDir, '.codex', 'config.toml'),
    /^autoforge\s*=/m,
    'Explicit assistant setup still hijacks native /autoforge with a Codex shell alias',
  );
  await assertExists(
    path.join(homeDir, '.codex', 'AGENTS.md'),
    'Explicit assistant setup did not sync the Codex global bootstrap file',
  );
  await assertFileContains(
    path.join(homeDir, '.codex', 'AGENTS.md'),
    /native Codex workflow command/i,
    'Explicit assistant setup did not sync the expected Codex bootstrap instructions',
  );
  await assertExists(
    path.join(homeDir, '.codex', 'commands', 'autoforge.md'),
    'Explicit assistant setup did not sync Codex command files',
  );
  await assertExists(
    path.join(projectDir, '.cursor', 'rules', 'danteforge.mdc'),
    'Installed DanteForge setup assistants command did not create the Cursor bootstrap rule',
  );

  await fs.rm(tempRoot, { recursive: true, force: true });
  console.log('Packed CLI install smoke test passed');
} catch (error) {
  console.error(`CLI install smoke test failed. Temporary workspace preserved at: ${tempRoot}`);
  throw error;
}
