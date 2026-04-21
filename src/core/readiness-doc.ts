import {
  REPO_PIPELINE_STEPS,
  renderWorkflowCodeBlock,
} from './workflow-surface.js';

export interface ReceiptSnapshot {
  id: 'verify' | 'release' | 'live';
  label: string;
  command: string;
  path: string;
  exists: boolean;
  status: string;
  timestamp: string | null;
  version: string | null;
  gitSha: string | null;
  detailLines: string[];
}

export interface SupportedSurfaceSnapshot {
  id: string;
  label: string;
  status: string;
  proof: string[];
}

export interface ReadinessDocInput {
  version: string;
  generatedAt: string;
  currentGitSha: string | null;
  receiptSnapshots: ReceiptSnapshot[];
  supportedSurfaces: SupportedSurfaceSnapshot[];
}

function normalizeStatus(status: string): string {
  return status.trim().toUpperCase() || 'UNKNOWN';
}

function table(headers: string[], rows: string[][]): string[] {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }

  return lines;
}

function buildReceiptRows(receipts: ReceiptSnapshot[]): string[][] {
  return receipts.map((receipt) => [
    receipt.label,
    normalizeStatus(receipt.status),
    receipt.version ?? 'unavailable',
    receipt.timestamp ?? 'unavailable',
    receipt.gitSha ?? 'unavailable',
    receipt.path,
  ]);
}

function buildSurfaceRows(surfaces: SupportedSurfaceSnapshot[]): string[][] {
  return surfaces.map((surface) => [
    surface.id,
    surface.label,
    normalizeStatus(surface.status),
    surface.proof.join('<br />') || 'unavailable',
  ]);
}

function deriveCurrentBlockers(receipts: ReceiptSnapshot[], version: string, currentGitSha: string | null): string[] {
  const blockers: string[] = [];

  for (const receipt of receipts) {
    if (!receipt.exists) {
      blockers.push(`${receipt.label} receipt is missing. Run \`${receipt.command}\` before treating that surface as current.`);
      continue;
    }

    if (receipt.status !== 'pass') {
      blockers.push(`${receipt.label} receipt is ${receipt.status.toUpperCase()}. Re-run \`${receipt.command}\` and inspect ${receipt.path}.`);
    }

    if (receipt.version !== null && receipt.version !== version) {
      blockers.push(`${receipt.label} receipt targets version ${receipt.version}, not the current package version ${version}.`);
    }

    if (currentGitSha && receipt.gitSha && receipt.gitSha !== currentGitSha) {
      blockers.push(`${receipt.label} receipt was captured at ${receipt.gitSha}, not the current workspace SHA ${currentGitSha}.`);
    }

    if (receipt.detailLines.some((line) => /stale|outdated|mismatch/i.test(line))) {
      blockers.push(`${receipt.label} receipt is present but marked stale or mismatched. Refresh it before claiming that surface is ready.`);
    }
  }

  if (blockers.length === 0) {
    blockers.push('No receipt-level blockers were detected in the latest local snapshots.');
  }

  return blockers;
}

export function buildOperationalReadinessDoc(input: ReadinessDocInput): string {
  const receiptRows = buildReceiptRows(input.receiptSnapshots);
  const surfaceRows = buildSurfaceRows(input.supportedSurfaces);
  const blockers = deriveCurrentBlockers(input.receiptSnapshots, input.version, input.currentGitSha);
  const lines: string[] = [
    `# DanteForge v${input.version} Operational Readiness`,
    '',
    `Version: ${input.version}`,
    `Current Git SHA: ${input.currentGitSha ?? 'unavailable'}`,
    '',
    `Generated on ${input.generatedAt} from the latest local receipt snapshots.`,
    '',
    'This guide is evidence-backed on purpose. It summarizes the latest local `verify`, `release:proof`, and `verify:live` receipts instead of hard-coding green claims into the docs.',
    'Anti-stub enforcement remains part of the readiness story: shipped implementation is expected to clear `npm run check:anti-stub` before release claims are treated as trustworthy.',
    '',
    '## Canonical Pipeline',
    '',
    renderWorkflowCodeBlock(REPO_PIPELINE_STEPS),
    '',
    '## Receipt Snapshot',
    '',
    ...table(
      ['Surface', 'Status', 'Version', 'Timestamp', 'Git SHA', 'Receipt'],
      receiptRows.length > 0 ? receiptRows : [['none', 'UNKNOWN', 'unavailable', 'unavailable', 'unavailable', 'unavailable']],
    ),
    '',
    '## Receipt Details',
    '',
  ];

  for (const receipt of input.receiptSnapshots) {
    lines.push(`### ${receipt.label}`);
    lines.push('');
    lines.push(`- Command: \`${receipt.command}\``);
    lines.push(`- Receipt: \`${receipt.path}\``);
    lines.push(`- Status: ${normalizeStatus(receipt.status)}`);
    lines.push(`- Timestamp: ${receipt.timestamp ?? 'unavailable'}`);
    lines.push(`- Version: ${receipt.version ?? 'unavailable'}`);
    lines.push(`- Git SHA: ${receipt.gitSha ?? 'unavailable'}`);
    if (receipt.detailLines.length > 0) {
      for (const detail of receipt.detailLines) {
        lines.push(`- ${detail}`);
      }
    }
    lines.push('');
  }

  lines.push('## Supported Surfaces');
  lines.push('');
  lines.push(
    ...table(
      ['ID', 'Surface', 'Status', 'Proof'],
      surfaceRows.length > 0 ? surfaceRows : [['none', 'unavailable', 'UNKNOWN', 'unavailable']],
    ),
  );
  lines.push('');
  lines.push('## Known Outstanding Work');
  lines.push('');
  for (const blocker of blockers) {
    lines.push(`- ${blocker}`);
  }
  lines.push('');
  lines.push('## Regeneration');
  lines.push('');
  lines.push('- Refresh verify evidence with `npm run verify`.');
  lines.push('- Refresh release proof with `npm run release:proof`.');
  lines.push('- Refresh live proof with `npm run verify:live` when the live environment is available.');
  lines.push('- Regenerate this guide with `npm run sync:readiness-doc`.');

  return lines.join('\n');
}
