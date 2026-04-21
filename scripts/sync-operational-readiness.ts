import fs from 'node:fs/promises';

import {
  buildOperationalReadinessDoc,
  type ReceiptSnapshot,
  type SupportedSurfaceSnapshot,
} from '../src/core/readiness-doc.js';
import { readGitSha } from './proof-receipts.mjs';

type ReceiptRecord = Record<string, unknown>;

async function readJsonIfPresent(filePath: string): Promise<ReceiptRecord | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as ReceiptRecord;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function detailLinesForReceipt(
  id: ReceiptSnapshot['id'],
  receipt: ReceiptRecord | null,
  version: string,
  currentGitSha: string | null,
): string[] {
  if (!receipt) {
    return ['No local receipt was found for this surface.'];
  }

  const details: string[] = [];
  const receiptVersion = asString(receipt['version']);
  const receiptGitSha = asString(receipt['gitSha']);
  if (receiptVersion && receiptVersion !== version) {
    details.push(`Receipt version ${receiptVersion} does not match the current package version ${version}.`);
  }
  if (currentGitSha && receiptGitSha && receiptGitSha !== currentGitSha) {
    details.push(`Receipt git SHA ${receiptGitSha} does not match the current workspace SHA ${currentGitSha}.`);
  }

  if (id === 'verify') {
    if (receipt['currentStateFresh'] === false) {
      details.push('Receipt reports the current workspace state as stale.');
    }
    const failures = Array.isArray(receipt['failures']) ? receipt['failures'] as unknown[] : [];
    if (failures.length > 0) {
      details.push(`Recorded failures: ${failures.length}.`);
    }
  }

  if (id === 'release') {
    const checks = Array.isArray(receipt['checks']) ? receipt['checks'] as unknown[] : [];
    details.push(`Recorded release checks: ${checks.length}.`);
  }

  if (id === 'live') {
    const providers = Array.isArray(receipt['providers']) ? receipt['providers'] as unknown[] : [];
    details.push(`Recorded live providers: ${providers.length}.`);
  }

  return details;
}

function buildReceiptSnapshot(
  id: ReceiptSnapshot['id'],
  label: string,
  command: string,
  relativePath: string,
  version: string,
  currentGitSha: string | null,
  receipt: ReceiptRecord | null,
): ReceiptSnapshot {
  return {
    id,
    label,
    command,
    path: relativePath,
    exists: receipt !== null,
    status: asString(receipt?.['status']) ?? 'missing',
    timestamp: asString(receipt?.['timestamp']),
    version: asString(receipt?.['version']),
    gitSha: asString(receipt?.['gitSha']),
    detailLines: detailLinesForReceipt(id, receipt, version, currentGitSha),
  };
}

function buildSupportedSurfaces(receipt: ReceiptRecord | null): SupportedSurfaceSnapshot[] {
  const surfaces = Array.isArray(receipt?.['supportedSurfaces'])
    ? receipt?.['supportedSurfaces'] as ReceiptRecord[]
    : [];

  return surfaces.map((surface) => ({
    id: asString(surface['id']) ?? 'unknown',
    label: asString(surface['label']) ?? 'unknown',
    status: asString(surface['status']) ?? 'unknown',
    proof: Array.isArray(surface['proof'])
      ? (surface['proof'] as unknown[]).map((entry) => String(entry))
      : [],
  }));
}

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
const version = pkg.version;
const currentGitSha = readGitSha(process.cwd());
const verifyPath = '.danteforge/evidence/verify/latest.json';
const releasePath = '.danteforge/evidence/release/latest.json';
const livePath = '.danteforge/evidence/live/latest.json';

const [verifyReceipt, releaseReceipt, liveReceipt] = await Promise.all([
  readJsonIfPresent(verifyPath),
  readJsonIfPresent(releasePath),
  readJsonIfPresent(livePath),
]);

const receiptSnapshots: ReceiptSnapshot[] = [
  buildReceiptSnapshot('verify', 'Repo verify', 'npm run verify', verifyPath, version, currentGitSha, verifyReceipt),
  buildReceiptSnapshot('release', 'Release proof', 'npm run release:proof', releasePath, version, currentGitSha, releaseReceipt),
  buildReceiptSnapshot('live', 'Live verification', 'npm run verify:live', livePath, version, currentGitSha, liveReceipt),
];

const doc = buildOperationalReadinessDoc({
  version,
  generatedAt: new Date().toISOString(),
  currentGitSha,
  receiptSnapshots,
  supportedSurfaces: buildSupportedSurfaces(releaseReceipt),
});

const outputPath = `docs/Operational-Readiness-v${version}.md`;
await fs.writeFile(outputPath, doc + '\n', 'utf8');
process.stdout.write(`Operational readiness guide synced: ${outputPath}\n`);
