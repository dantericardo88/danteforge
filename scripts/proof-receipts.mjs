import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LIVE_EVIDENCE_DIR = '.danteforge/evidence/live';
const RELEASE_EVIDENCE_DIR = '.danteforge/evidence/release';

function latestPaths(evidenceDir) {
  return {
    evidenceDir,
    jsonPath: path.join(evidenceDir, 'latest.json'),
    markdownPath: path.join(evidenceDir, 'latest.md'),
  };
}

function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\r\n', '<br />')
    .replaceAll('\n', '<br />');
}

function statusLine(status) {
  return `Status: ${String(status ?? 'unknown').toUpperCase()}`;
}

function buildTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }

  return lines;
}

function buildWorkflowContextLines(workflowContext = {}) {
  return [
    '## Workflow Context',
    '',
    `- GitHub Actions: ${workflowContext.githubActions ? 'yes' : 'no'}`,
    `- Workflow: ${workflowContext.workflow ?? 'unavailable'}`,
    `- Job: ${workflowContext.job ?? 'unavailable'}`,
    `- Run ID: ${workflowContext.runId ?? 'unavailable'}`,
    `- Ref: ${workflowContext.ref ?? 'unavailable'}`,
  ];
}

async function writeReceipt(receipt, cwd, evidenceDir, buildMarkdown) {
  const baseDir = cwd ?? process.cwd();
  const { evidenceDir: relativeDir, jsonPath, markdownPath } = latestPaths(evidenceDir);
  const absoluteEvidenceDir = path.join(baseDir, relativeDir);
  const absoluteJsonPath = path.join(baseDir, jsonPath);
  const absoluteMarkdownPath = path.join(baseDir, markdownPath);

  await fs.mkdir(absoluteEvidenceDir, { recursive: true });
  await fs.writeFile(absoluteJsonPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  await fs.writeFile(absoluteMarkdownPath, buildMarkdown(receipt) + '\n', 'utf8');

  return absoluteJsonPath;
}

async function readReceipt(cwd, evidenceDir) {
  const baseDir = cwd ?? process.cwd();
  const { jsonPath } = latestPaths(evidenceDir);

  try {
    const raw = await fs.readFile(path.join(baseDir, jsonPath), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function computeProofStatus(entries = []) {
  if (entries.some(entry => entry?.status === 'fail')) return 'fail';
  if (entries.some(entry => entry?.status && entry.status !== 'pass')) return 'warn';
  return 'pass';
}

export async function readPackageVersion(cwd = process.cwd()) {
  const pkgPath = path.join(cwd, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  return typeof pkg.version === 'string' && pkg.version.trim().length > 0 ? pkg.version.trim() : 'unknown';
}

export function readGitSha(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    return null;
  }

  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

export function getWorkflowContext(env = process.env) {
  return {
    githubActions: env.GITHUB_ACTIONS === 'true',
    workflow: env.GITHUB_WORKFLOW ?? null,
    job: env.GITHUB_JOB ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    ref: env.GITHUB_REF_NAME ?? env.GITHUB_REF ?? null,
  };
}

export function buildLiveVerifyReceiptMarkdown(receipt) {
  const providerRows = (receipt.providerResults ?? []).map(entry => [
    entry.provider,
    String(entry.status ?? 'unknown').toUpperCase(),
    entry.detail ?? '',
  ]);
  const upstreamRows = (receipt.upstreamChecks ?? []).map(entry => [
    entry.name,
    String(entry.status ?? 'unknown').toUpperCase(),
    entry.detail ?? '',
  ]);

  const lines = [
    '# DanteForge Live Verify Receipt',
    '',
    statusLine(receipt.status),
    `Timestamp: ${receipt.timestamp}`,
    `Project: ${receipt.project} v${receipt.version}`,
    `Git SHA: ${receipt.gitSha ?? 'unavailable'}`,
    `Platform: ${receipt.platform} / Node ${receipt.nodeVersion}`,
    '',
    `Providers: ${(receipt.providers ?? []).join(', ') || 'none'}`,
    '',
    '## Provider Results',
    '',
    ...buildTable(['Provider', 'Status', 'Detail'], providerRows.length > 0 ? providerRows : [['none', 'SKIP', 'No providers executed']]),
    '',
    '## Upstream Checks',
    '',
    ...buildTable(['Check', 'Status', 'Detail'], upstreamRows.length > 0 ? upstreamRows : [['none', 'SKIP', 'No upstream checks executed']]),
  ];

  if (receipt.errorMessage) {
    lines.push('', '## Failure', '', `- ${receipt.errorMessage}`);
  }

  lines.push('', ...buildWorkflowContextLines(receipt.workflowContext));
  return lines.join('\n');
}

export function buildReleaseProofReceiptMarkdown(receipt) {
  const checkRows = (receipt.checks ?? []).map(entry => [
    entry.name,
    String(entry.status ?? 'unknown').toUpperCase(),
    entry.command ?? '',
    entry.detail ?? '',
  ]);
  const artifactRows = Object.entries(receipt.artifactPaths ?? {}).map(([name, artifactPath]) => [
    name,
    artifactPath ?? 'unavailable',
  ]);
  const packagedArtifactRows = receipt.packagedArtifact
    ? [
        ['Filename', receipt.packagedArtifact.filename ?? 'unavailable'],
        ['Entries', receipt.packagedArtifact.entryCount ?? 'unavailable'],
        ['Package Size (bytes)', receipt.packagedArtifact.packageSize ?? 'unavailable'],
        ['Unpacked Size (bytes)', receipt.packagedArtifact.unpackedSize ?? 'unavailable'],
      ]
    : [['none', 'unavailable']];
  const artifactHashRows = Object.entries(receipt.artifactHashes ?? {}).map(([name, hashInfo]) => [
    name,
    hashInfo?.path ?? 'unavailable',
    hashInfo?.sha256 ?? 'unavailable',
  ]);
  const provenanceRows = receipt.provenanceSummary
    ? [
        ['npm publish --provenance', receipt.provenanceSummary.npmPublishProvenance ? 'yes' : 'no'],
        ['GitHub OIDC publish job', receipt.provenanceSummary.githubOidcPublish ? 'yes' : 'no'],
        ['Release receipt', receipt.provenanceSummary.releaseReceiptPath ?? 'unavailable'],
        ['Live receipt', receipt.provenanceSummary.liveReceiptPath ?? 'unavailable'],
        ['Third-party notices', receipt.provenanceSummary.thirdPartyNoticesPath ?? 'unavailable'],
      ]
    : [['none', 'unavailable']];

  const lines = [
    '# DanteForge Release Proof Receipt',
    '',
    statusLine(receipt.status),
    `Timestamp: ${receipt.timestamp}`,
    `Project: ${receipt.project} v${receipt.version}`,
    `Git SHA: ${receipt.gitSha ?? 'unavailable'}`,
    `Platform: ${receipt.platform} / Node ${receipt.nodeVersion}`,
    '',
    '## Checks',
    '',
    ...buildTable(
      ['Check', 'Status', 'Command', 'Detail'],
      checkRows.length > 0 ? checkRows : [['none', 'SKIP', '', 'No checks executed']],
    ),
    '',
    '## Artifacts',
    '',
    ...buildTable(['Artifact', 'Path'], artifactRows.length > 0 ? artifactRows : [['none', 'unavailable']]),
    '',
    '## Packaged npm Artifact',
    '',
    ...buildTable(['Field', 'Value'], packagedArtifactRows),
    '',
    '## Artifact Hashes',
    '',
    ...buildTable(
      ['Artifact', 'Path', 'SHA-256'],
      artifactHashRows.length > 0 ? artifactHashRows : [['none', 'unavailable', 'unavailable']],
    ),
    '',
    '## Publish Provenance',
    '',
    ...buildTable(['Field', 'Value'], provenanceRows),
  ];

  if (receipt.errorMessage) {
    lines.push('', '## Failure', '', `- ${receipt.errorMessage}`);
  }

  lines.push('', ...buildWorkflowContextLines(receipt.workflowContext));
  return lines.join('\n');
}

export async function writeLiveVerifyReceipt(receipt, cwd) {
  return writeReceipt(receipt, cwd, LIVE_EVIDENCE_DIR, buildLiveVerifyReceiptMarkdown);
}

export async function writeReleaseProofReceipt(receipt, cwd) {
  return writeReceipt(receipt, cwd, RELEASE_EVIDENCE_DIR, buildReleaseProofReceiptMarkdown);
}

export async function readLatestLiveVerifyReceipt(cwd) {
  return readReceipt(cwd, LIVE_EVIDENCE_DIR);
}

export async function readLatestReleaseProofReceipt(cwd) {
  return readReceipt(cwd, RELEASE_EVIDENCE_DIR);
}
