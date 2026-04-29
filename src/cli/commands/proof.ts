import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  HashChain,
  ReceiptChain,
  hashDict,
  verifyBundle,
  verifyReceipt,
  type EvidenceBundle,
  type HashChainEntry,
  type Receipt,
  type VerificationResult,
} from '@danteforge/evidence-chain';
import { runProof, generateProofReport } from '../../core/proof-engine.js';
import type { ProofEngineOptions, ProofReport, PipelineProofOptions, PipelineProofReport, ConvergenceProofOptions, ConvergenceProofReport } from '../../core/proof-engine.js';
import type { SemanticScoringOptions } from '../../core/pdse-semantic.js';
import type { ScoreHistoryEntry } from '../../core/state.js';

// ── Score Arc ─────────────────────────────────────────────────────────────────

export interface ScoreArcReport {
  before: number;
  after: number;
  gain: number;
  entries: ScoreHistoryEntry[];
  html: string;
  markdown: string;
}

/** Pure function — builds a score arc report from a slice of history entries. */
export function buildScoreArc(
  since: string,
  history: ScoreHistoryEntry[],
  currentScore: number,
): ScoreArcReport {
  // Find entries at or after `since` (supports ISO date prefix or git SHA)
  const sinceEntries = history.filter(e => {
    if (since.length <= 10) {
      // date-only prefix comparison (YYYY-MM-DD)
      return e.timestamp.slice(0, 10) >= since;
    }
    return e.gitSha === since || e.timestamp >= since;
  });

  const before = sinceEntries.length > 0
    ? sinceEntries[sinceEntries.length - 1].displayScore
    : currentScore;
  const after = currentScore;
  const gain = +(after - before).toFixed(2);

  const gainStr = gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1);
  const arrow = gain > 0.05 ? '▲' : gain < -0.05 ? '▼' : '─';

  const markdown = [
    `## Score Arc — since ${since}`,
    '',
    `| | Score |`,
    `|---|---|`,
    `| **Before** | ${before.toFixed(1)}/10 |`,
    `| **After** | ${after.toFixed(1)}/10 |`,
    `| **Gain** | ${arrow} ${gainStr} |`,
    '',
    `_${sinceEntries.length} measurement${sinceEntries.length !== 1 ? 's' : ''} in window_`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Score Arc</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px}
.card{border:1px solid #ddd;border-radius:8px;padding:20px;text-align:center}
.before{color:#888}.after{color:#2a7ae2;font-size:2em;font-weight:bold}
.gain{font-size:1.4em;color:${gain >= 0 ? '#27ae60' : '#c0392b'}}</style>
</head>
<body>
<h1>Score Arc — since ${since}</h1>
<div class="card">
  <p class="before">Before: ${before.toFixed(1)}/10</p>
  <p class="after">After: ${after.toFixed(1)}/10</p>
  <p class="gain">${arrow} ${gainStr}</p>
</div>
</body></html>`;

  return { before, after, gain, entries: sinceEntries, html, markdown };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProofCommandOptions {
  prompt?: string;
  pipeline?: boolean;
  convergence?: boolean;
  verify?: string;
  verifyAll?: string;
  skipGit?: boolean;
  strictGitBinding?: boolean;
  since?: string;
  cwd?: string;
  semantic?: boolean;
  _runProof?: (rawPrompt: string, opts?: ProofEngineOptions) => Promise<ProofReport>;
  _runPipelineProof?: (opts?: PipelineProofOptions) => Promise<PipelineProofReport>;
  _runConvergenceProof?: (opts?: ConvergenceProofOptions) => Promise<ConvergenceProofReport>;
  _loadScoreHistory?: (cwd: string) => Promise<{ history: ScoreHistoryEntry[]; currentScore: number }>;
  _stdout?: (line: string) => void;
  _semanticOpts?: SemanticScoringOptions;
}

const execFileAsync = promisify(execFile);

export async function proof(options: ProofCommandOptions = {}): Promise<void> {
  const out = options._stdout ?? console.log;
  const cwd = options.cwd ?? process.cwd();

  if (options.verify) {
    const report = await verifyProofFile(options.verify, { cwd, skipGit: options.skipGit, strictGitBinding: options.strictGitBinding });
    out(JSON.stringify(report, null, 2));
    if (!report.valid && !options._stdout) process.exitCode = 1;
    return;
  }

  if (options.verifyAll) {
    const report = await verifyProofCorpus(options.verifyAll, { cwd, skipGit: options.skipGit, strictGitBinding: options.strictGitBinding });
    out(JSON.stringify(report, null, 2));
    if (report.failed > 0 && !options._stdout) process.exitCode = 1;
    return;
  }

  if (options.since) {
    const loadHistory = options._loadScoreHistory ?? defaultLoadScoreHistory;
    const { history, currentScore } = await loadHistory(cwd);
    const arc = buildScoreArc(options.since, history, currentScore);
    for (const line of arc.markdown.split('\n')) {
      out(line);
    }
    return;
  }

  if (options.convergence) {
    const { runConvergenceProof } = await import('../../core/proof-engine.js');
    const runner = options._runConvergenceProof ?? runConvergenceProof;
    const report = await runner({ cwd: options.cwd });
    out(JSON.stringify(report, null, 2));
    return;
  }

  if (options.pipeline) {
    const { runPipelineProof } = await import('../../core/proof-engine.js');
    const runner = options._runPipelineProof ?? runPipelineProof;
    const report = await runner({ cwd: options.cwd });
    out(JSON.stringify(report, null, 2));
    return;
  }

  if (!options.prompt) {
    out('Usage: danteforge proof --prompt "Your raw prompt here"');
    out('       danteforge proof --pipeline');
    out('       danteforge proof --convergence');
    out('       danteforge proof --verify <receipt.json>');
    out('       danteforge proof --verify-all <directory>');
    out('');
    out('Scores your raw prompt against DanteForge structured artifacts and shows the improvement.');
    out('Flags:');
    out('  --pipeline     Generate structured pipeline execution evidence report');
    out('  --convergence  Generate structured convergence & self-healing evidence report');
    out('  --verify       Verify an evidence-chain receipt, bundle, or proof-bearing JSON file');
    out('  --verify-all   Recursively verify every receipt under <directory>; report corpus stats');
    out('  --semantic     Enhance PDSE scoring with LLM semantic assessment (requires LLM connection)');
    return;
  }

  const runner = options._runProof ?? runProof;
  const engineOpts: ProofEngineOptions = { cwd: options.cwd };

  if (options.semantic) {
    out('[semantic] LLM-enhanced scoring enabled');
  }

  const report = await runner(options.prompt, engineOpts);
  const reportText = generateProofReport(report);

  for (const line of reportText.split('\n')) {
    out(line);
  }
}

interface ProofVerifyOptions {
  cwd: string;
  skipGit?: boolean;
  strictGitBinding?: boolean;
}

interface GitBindingCheck {
  valid: boolean;
  skipped: boolean;
  expected: string | null;
  current: string | null;
  reason?: string;
}

export interface ProofVerifyReport {
  valid: boolean;
  target: string;
  detected: string[];
  checks: Record<string, VerificationResult | GitBindingCheck>;
  errors: string[];
}

export async function verifyProofFile(target: string, options: ProofVerifyOptions): Promise<ProofVerifyReport> {
  const raw = await fs.readFile(target, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const checks: Record<string, VerificationResult | GitBindingCheck> = {};
  const detected: string[] = [];
  const errors: string[] = [];
  const gitShas: Array<string | null | undefined> = [];

  if (isReceipt(parsed)) {
    detected.push('receipt');
    checks.receiptIntegrity = verifyReceipt(parsed);
    gitShas.push(parsed.gitSha);
  }

  if (isEvidenceBundle(parsed)) {
    detected.push('evidenceBundle');
    checks.bundleIntegrity = verifyBundle(parsed);
    gitShas.push(parsed.gitSha);
  }

  if (isObject(parsed) && isEvidenceBundle(parsed.proof)) {
    detected.push('proofEnvelope');
    checks.bundleIntegrity = verifyBundle(parsed.proof);
    checks.envelopeBinding = verifyEnvelopeBinding(parsed, parsed.proof);
    gitShas.push(parsed.proof.gitSha);
  } else if (isObject(parsed) && isReceipt(parsed.proof)) {
    detected.push('proofReceipt');
    checks.receiptIntegrity = verifyReceipt(parsed.proof);
    checks.envelopeBinding = verifyReceiptEnvelopeBinding(parsed, parsed.proof);
    gitShas.push(parsed.proof.gitSha);
  }

  if (isObject(parsed) && Array.isArray(parsed.entries) && parsed.entries.every(isHashChainEntry)) {
    detected.push('hashChain');
    checks.hashChainContinuity = HashChain.verifyEntries(parsed.entries);
  }

  if (isObject(parsed) && Array.isArray(parsed.receipts) && parsed.receipts.every(isReceipt)) {
    detected.push('receiptChain');
    checks.receiptChainContinuity = ReceiptChain.verifyReceipts(parsed.receipts);
    gitShas.push(...parsed.receipts.map(receipt => receipt.gitSha));
  }

  if (Array.isArray(parsed) && parsed.every(isReceipt)) {
    detected.push('receiptChain');
    checks.receiptChainContinuity = ReceiptChain.verifyReceipts(parsed);
    gitShas.push(...parsed.map(receipt => receipt.gitSha));
  }

  if (detected.length === 0) {
    checks.format = { valid: false, errors: ['no evidence-chain receipt, bundle, chain, or proof envelope detected'] };
  }

  checks.gitShaBinding = await verifyGitBinding(gitShas, options);

  for (const [name, check] of Object.entries(checks)) {
    if (!check.valid) {
      if ('errors' in check) {
        errors.push(...check.errors.map((error: string) => `${name}: ${error}`));
      } else {
        errors.push(`${name}: ${check.reason ?? 'invalid'}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    target,
    detected,
    checks,
    errors,
  };
}

function verifyEnvelopeBinding(container: Record<string, unknown>, proof: EvidenceBundle<unknown>): VerificationResult {
  const { proof: _proof, ...payload } = container;
  const expectedPayloadHash = hashDict([payload]);
  const errors = proof.payloadHash === expectedPayloadHash ? [] : ['proof payloadHash does not match enclosing JSON'];
  return {
    valid: errors.length === 0,
    errors,
    expectedHash: expectedPayloadHash,
    actualHash: proof.payloadHash,
  };
}

function verifyReceiptEnvelopeBinding(container: Record<string, unknown>, proof: Receipt<unknown>): VerificationResult {
  const { proof: _proof, ...payload } = container;
  const expectedPayloadHash = hashDict(payload);
  const errors = proof.payloadHash === expectedPayloadHash ? [] : ['proof payloadHash does not match enclosing JSON'];
  return {
    valid: errors.length === 0,
    errors,
    expectedHash: expectedPayloadHash,
    actualHash: proof.payloadHash,
  };
}

// ── Corpus-wide verifier ──────────────────────────────────────────────────────

export interface ProofCorpusEntry {
  path: string;
  status: 'verified' | 'failed' | 'skipped' | 'errored';
  detected: string[];
  errors: string[];
}

export interface ProofCorpusReport {
  root: string;
  scannedAt: string;
  totalFiles: number;
  verified: number;
  failed: number;
  skipped: number;       // files without any detected proof envelope
  errored: number;       // unreadable / unparseable files
  proofAdoptionRate: number;  // verified / (verified + failed + skipped)
  failures: ProofCorpusEntry[];
  errors: ProofCorpusEntry[];
}

async function listJsonFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await listJsonFilesRecursive(full)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

export async function verifyProofCorpus(rootDir: string, options: ProofVerifyOptions): Promise<ProofCorpusReport> {
  const files = await listJsonFilesRecursive(rootDir);
  const failures: ProofCorpusEntry[] = [];
  const errors: ProofCorpusEntry[] = [];
  let verified = 0;
  let failed = 0;
  let skipped = 0;
  let errored = 0;

  for (const path of files) {
    try {
      const report = await verifyProofFile(path, options);
      const hasProof = report.detected.some(d => d !== 'format');
      if (!hasProof) {
        skipped++;
        continue;
      }
      if (report.valid) {
        verified++;
      } else {
        failed++;
        failures.push({ path, status: 'failed', detected: report.detected, errors: report.errors });
      }
    } catch (err) {
      errored++;
      errors.push({
        path,
        status: 'errored',
        detected: [],
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const proofablePopulation = verified + failed + skipped;
  const proofAdoptionRate = proofablePopulation === 0 ? 0 : Math.round((verified / proofablePopulation) * 1000) / 1000;

  return {
    root: rootDir,
    scannedAt: new Date().toISOString(),
    totalFiles: files.length,
    verified,
    failed,
    skipped,
    errored,
    proofAdoptionRate,
    failures,
    errors,
  };
}

async function verifyGitBinding(gitShas: Array<string | null | undefined>, options: ProofVerifyOptions): Promise<GitBindingCheck> {
  const expected = gitShas.find((sha): sha is string => typeof sha === 'string' && sha.length > 0) ?? null;
  if (!expected) return { valid: true, skipped: true, expected, current: null, reason: 'no gitSha in proof' };
  if (options.skipGit) return { valid: true, skipped: true, expected, current: null, reason: 'git binding skipped' };
  let current: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: options.cwd, encoding: 'utf8' });
    current = stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, skipped: false, expected, current: null, reason: message };
  }
  // Strict mode: snapshot equality (release/audit artifacts where the bound commit must equal current HEAD).
  if (options.strictGitBinding) {
    return { valid: current === expected, skipped: false, expected, current, reason: current === expected ? undefined : 'strict mode: HEAD !== expected gitSha' };
  }
  // Default: continuity. The bound commit must be reachable from current HEAD (ancestor).
  // Equality is a special case of ancestry; check it first to avoid spawning git for the common case.
  if (current === expected) return { valid: true, skipped: false, expected, current };
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', expected, current], { cwd: options.cwd });
    // Exit 0 means `expected` is an ancestor of `current`. Continuity verified.
    return { valid: true, skipped: false, expected, current };
  } catch (err) {
    // Non-zero exit means `expected` is NOT in `current`'s ancestry. Could mean: parallel branch, deleted commit, or non-existent SHA.
    const reason = err instanceof Error && /not\s+a\s+valid\s+commit|unknown\s+revision|bad\s+revision/i.test(err.message)
      ? `expected gitSha ${expected} is not a known commit in this repo`
      : `expected gitSha ${expected} is not an ancestor of HEAD ${current}`;
    return { valid: false, skipped: false, expected, current, reason };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReceipt(value: unknown): value is Receipt<unknown> {
  return isObject(value)
    && value.schemaVersion === 'evidence-chain.v1'
    && typeof value.receiptId === 'string'
    && typeof value.action === 'string'
    && typeof value.payloadHash === 'string'
    && typeof value.prevHash === 'string'
    && typeof value.hash === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'payload');
}

function isEvidenceBundle(value: unknown): value is EvidenceBundle<unknown> {
  return isObject(value)
    && value.schemaVersion === 'evidence-chain.v1'
    && typeof value.bundleId === 'string'
    && typeof value.payloadHash === 'string'
    && typeof value.prevHash === 'string'
    && typeof value.merkleRoot === 'string'
    && typeof value.hash === 'string'
    && Array.isArray(value.evidence)
    && Array.isArray(value.evidenceHashes)
    && Array.isArray(value.inclusionProofs);
}

function isHashChainEntry(value: unknown): value is HashChainEntry<unknown> {
  return isObject(value)
    && typeof value.index === 'number'
    && typeof value.payloadHash === 'string'
    && typeof value.prevHash === 'string'
    && typeof value.hash === 'string'
    && typeof value.createdAt === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'payload');
}

async function defaultLoadScoreHistory(cwd: string): Promise<{ history: ScoreHistoryEntry[]; currentScore: number }> {
  const { loadState } = await import('../../core/state.js');
  const { computeHarshScore } = await import('../../core/harsh-scorer.js');
  const [state, result] = await Promise.all([
    loadState({ cwd }),
    computeHarshScore({ cwd }),
  ]);
  return { history: state.scoreHistory ?? [], currentScore: result.displayScore };
}
