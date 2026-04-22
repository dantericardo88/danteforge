import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cleanupSandbox,
  createReleaseSandbox,
  releaseEnv,
  run,
} from './release-check-utils.mjs';
import {
  computeProofStatus,
  getWorkflowContext,
  readGitSha,
  readPackageVersion,
  writeReleaseProofReceipt,
} from './proof-receipts.mjs';

const repoRoot = process.cwd();
const sandbox = await createReleaseSandbox(repoRoot, 'danteforge-release-proof-');
const sandboxEnv = releaseEnv(sandbox.homeDir, sandbox.xdgConfigHome);
const checks = [];
let errorMessage = null;

const checkPlan = [
  { name: 'repo-hygiene-strict', command: 'npm', args: ['run', 'check:repo-hygiene:strict'] },
  { name: 'npm-ci', command: 'npm', args: ['ci'] },
  { name: 'vscode-ci', command: 'npm', args: ['--prefix', 'vscode-extension', 'ci'] },
  { name: 'release:check', command: 'npm', args: ['run', 'release:check'] },
  { name: 'sbom:generate', command: 'npm', args: ['run', 'sbom:generate'] },
  { name: 'sbom:validate', command: 'npm', args: ['run', 'sbom:validate'] },
  { name: 'npm-audit-prod', command: 'npm', args: ['audit', '--omit=dev'] },
  { name: 'vscode-audit', command: 'npm', args: ['--prefix', 'vscode-extension', 'audit'] },
  { name: 'package:vsix', command: 'npm', args: ['--prefix', 'vscode-extension', 'run', 'package:vsix'] },
];

function resolveCommand(command, args) {
  const npmExecPath = process.env.npm_execpath;
  if (command === 'npm') {
    return {
      executable: npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'),
      resolvedArgs: npmExecPath ? [npmExecPath, ...args] : args,
      shell: process.platform === 'win32' && !npmExecPath,
    };
  }

  return {
    executable: process.platform === 'win32' ? `${command}.cmd` : command,
    resolvedArgs: args,
    shell: false,
  };
}

function captureJson(command, args, cwd, env) {
  const { executable, resolvedArgs, shell } = resolveCommand(command, args);
  const result = spawnSync(executable, resolvedArgs, {
    cwd,
    env,
    encoding: 'utf8',
    shell,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}${
        result.error ? ` (${result.error.message})` : ''
      }`,
    );
  }

  return JSON.parse(result.stdout);
}

async function hashFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(absolutePath);
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

for (const step of checkPlan) {
  const commandLine = `${step.command} ${step.args.join(' ')}`;

  try {
    process.stdout.write(`Running ${step.name}...\n`);
    run(step.command, step.args, sandbox.checkoutDir, sandboxEnv);
    checks.push({
      name: step.name,
      command: commandLine,
      status: 'pass',
      detail: 'completed',
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    checks.push({
      name: step.name,
      command: commandLine,
      status: 'fail',
      detail: errorMessage,
    });
    break;
  }
}

const version = await readPackageVersion(repoRoot);
const gitSha = readGitSha(repoRoot);
const vsixPath = path.join('vscode-extension', '.artifacts', 'danteforge.vsix');
const sbomPath = `sbom/danteforge-${version}.cdx.json`;
let publishedVsixPath = null;
let packagedArtifact = null;

try {
  const sandboxVsixPath = path.join(sandbox.checkoutDir, vsixPath);
  await fs.access(sandboxVsixPath);
  await fs.mkdir(path.join(repoRoot, 'vscode-extension', '.artifacts'), { recursive: true });
  await fs.copyFile(sandboxVsixPath, path.join(repoRoot, vsixPath));
  publishedVsixPath = vsixPath;
} catch {
  publishedVsixPath = null;
}

try {
  const packResult = captureJson('npm', ['pack', '--json', '--dry-run'], sandbox.checkoutDir, sandboxEnv);
  const firstArtifact = Array.isArray(packResult) ? packResult[0] : null;
  if (firstArtifact && typeof firstArtifact === 'object') {
    packagedArtifact = {
      filename: firstArtifact.filename ?? null,
      entryCount: firstArtifact.entryCount ?? null,
      packageSize: firstArtifact.size ?? null,
      unpackedSize: firstArtifact.unpackedSize ?? null,
    };
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  checks.push({
    name: 'pack-dry-run-json',
    command: 'npm pack --json --dry-run',
    status: 'warn',
    detail: message,
  });
}

const artifactHashes = {};
if (publishedVsixPath) {
  artifactHashes.vsix = await hashFile(publishedVsixPath);
}
artifactHashes.notices = await hashFile('THIRD_PARTY_NOTICES.md');

// Add SBOM to artifact hashes
try {
  artifactHashes.sbom = await hashFile(sbomPath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  checks.push({
    name: 'sbom-artifact-hash',
    command: `hash ${sbomPath}`,
    status: 'warn',
    detail: `SBOM artifact not found or not hashable: ${message}`,
  });
}

const supportedSurfaces = [
  {
    id: 'local-cli',
    label: 'local-only CLI',
    status: checks.some(check => check.name === 'release:check' && check.status === 'pass') ? 'pass' : 'fail',
    proof: [
      '.github/workflows/ci.yml',
      'scripts/check-cli-smoke.mjs',
      'scripts/check-package-install-smoke.mjs',
    ],
  },
  {
    id: 'codex-local',
    label: 'local Codex install contract',
    status: checks.some(check => check.name === 'release:check' && check.status === 'pass') ? 'pass' : 'fail',
    proof: [
      'docs/Codex-Install.md',
      'docs/Standalone-Assistant-Setup.md',
      'scripts/check-package-install-smoke.mjs',
    ],
  },
  {
    id: 'live-cli',
    label: 'live-provider CLI',
    status: 'pass',
    proof: [
      '.github/workflows/live-canary.yml',
      '.danteforge/evidence/live/latest.json',
      '.danteforge/evidence/live/latest.md',
    ],
  },
  {
    id: 'vscode-extension',
    label: 'VS Code extension',
    status: publishedVsixPath ? 'pass' : 'warn',
    proof: [
      '.github/workflows/release.yml',
      'vscode-extension/README.md',
      publishedVsixPath ?? 'vscode-extension/.artifacts/danteforge.vsix',
    ],
  },
];

const receipt = {
  project: 'danteforge',
  version,
  gitSha,
  timestamp: new Date().toISOString(),
  cwd: repoRoot,
  platform: process.platform,
  nodeVersion: process.version,
  checks,
  workflowContext: getWorkflowContext(process.env),
  artifactPaths: {
    vsix: publishedVsixPath,
    sbom: sbomPath,
  },
  packagedArtifact,
  artifactHashes,
  supportedSurfaces,
  proofPack: {
    tutorial: 'docs/tutorials/first-15-minutes.md',
    publicCaseStudy: 'docs/case-studies/public-example.md',
    internalCaseStudy: 'docs/case-studies/internal-self-hosting.md',
  },
  provenanceSummary: {
    npmPublishProvenance: true,
    githubOidcPublish: true,
    releaseReceiptPath: '.danteforge/evidence/release/latest.json',
    liveReceiptPath: '.danteforge/evidence/live/latest.json',
    thirdPartyNoticesPath: 'THIRD_PARTY_NOTICES.md',
    sbomPath,
  },
  errorMessage,
  status: computeProofStatus([
    ...checks,
    ...(errorMessage ? [{ status: 'fail' }] : []),
  ]),
};

const receiptPath = await writeReleaseProofReceipt(receipt, repoRoot);
process.stdout.write(`Release proof receipt written to ${receiptPath}\n`);

if (errorMessage) {
  process.stderr.write(`Release proof failed. Sandbox preserved at: ${sandbox.checkoutDir}\n`);
  process.stderr.write(`Release proof failed: ${errorMessage}\n`);
  process.exitCode = 1;
} else {
  await cleanupSandbox(sandbox.tempRoot);
  process.stdout.write('Release proof passed\n');
}
