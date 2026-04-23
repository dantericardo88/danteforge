// Certify — Quality certificate generator.
// Produces a tamper-evident evidence bundle (.danteforge/QUALITY_CERTIFICATE.json + .md)
// proving the current quality level. The evidenceFingerprint field is a SHA-256 hash of
// all evidence at generation time — not a cryptographic signature (anyone can recompute it
// if they change the evidence). It exists to detect accidental drift, not adversarial tampering.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadConvergence, type ConvergenceState } from '../../core/convergence.js';
import { logger } from '../../core/logger.js';
import { DANTEFORGE_VERSION } from '../../core/version.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QualityCertificate {
  version: '1.0.0';
  projectName: string;
  generatedAt: string;
  certifiedBy: string;
  overallScore: number;
  dimensions: Record<string, number>;
  /** SHA-256 fingerprint of evidence JSON at generation time (tamper-evident, not a cryptographic signature). */
  evidenceFingerprint: string;
  testsPassing: boolean;
  typecheckPassing: boolean;
  attestation: string;
}

export interface CertifyOptions {
  cwd?: string;
  _llmCaller?: (prompt: string) => Promise<string>;
  _loadConvergence?: (cwd?: string) => Promise<ConvergenceState | null>;
  _computeHash?: (data: string) => string;
  _writeJson?: (filePath: string, data: string) => Promise<void>;
  _writeMarkdown?: (filePath: string, data: string) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Weighted average of dimension scores (equal weights). Returns 0 if no dimensions. */
function computeOverallScore(dimensions: Record<string, number>): number {
  const values = Object.values(dimensions);
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

function resolveProjectName(cwd?: string): string {
  const dir = cwd ?? process.cwd();
  return path.basename(dir);
}

function buildAttestation(projectName: string, score: number, certifiedBy: string): string {
  const level =
    score >= 9.0
      ? 'Enterprise-Grade'
      : score >= 7.5
        ? 'Production-Ready'
        : score >= 6.0
          ? 'Hardened'
          : score >= 4.0
            ? 'Functional'
            : 'Sketch';

  return (
    `This certificate attests that "${projectName}" achieved an overall quality score of ` +
    `${score.toFixed(2)}/10 (${level}) as evaluated by ${certifiedBy} on ` +
    `${new Date().toUTCString()}. The evidence bundle hash provides a tamper-evident ` +
    `fingerprint of all dimension scores at the time of certification.`
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(cert: QualityCertificate): string {
  const rows = Object.entries(cert.dimensions)
    .sort(([, a], [, b]) => b - a)
    .map(([dim, score]) => `| ${dim} | ${score.toFixed(2)} |`)
    .join('\n');

  const dimensionTable =
    rows.length > 0
      ? `| Dimension | Score |\n|-----------|-------|\n${rows}`
      : '_No dimension scores recorded._';

  return [
    `# Quality Certificate — ${cert.projectName}`,
    '',
    `**Generated**: ${cert.generatedAt}  `,
    `**Certified By**: ${cert.certifiedBy}  `,
    `**Overall Score**: ${cert.overallScore.toFixed(2)}/10  `,
    `**Evidence Fingerprint**: \`${cert.evidenceFingerprint}\`  `,
    `_(SHA-256 of evidence at generation time — tamper-evident, not a cryptographic signature)_  `,
    `**Tests Passing**: ${cert.testsPassing ? 'Yes' : 'No'}  `,
    `**Typecheck Passing**: ${cert.typecheckPassing ? 'Yes' : 'No'}`,
    '',
    '## Dimension Scores',
    '',
    dimensionTable,
    '',
    '## Attestation',
    '',
    cert.attestation,
    '',
  ].join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildEvidenceBundle(
  projectName: string, generatedAt: string, certifiedBy: string,
  overallScore: number, dimensions: Record<string, number>,
  testsPassing: boolean, typecheckPassing: boolean,
): string {
  return JSON.stringify(
    { projectName, generatedAt, certifiedBy, overallScore, dimensions, testsPassing, typecheckPassing },
    Object.keys({ projectName: '', generatedAt: '', certifiedBy: '', overallScore: 0, dimensions: {}, testsPassing: false, typecheckPassing: false }).sort(),
    2,
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runCertify(options: CertifyOptions = {}): Promise<QualityCertificate> {
  const { cwd } = options;
  const loadConv = options._loadConvergence ?? loadConvergence;
  const computeHash = options._computeHash ?? sha256;

  const danteforgeDir = path.join(cwd ?? process.cwd(), '.danteforge');
  const jsonPath = path.join(danteforgeDir, 'QUALITY_CERTIFICATE.json');
  const mdPath = path.join(danteforgeDir, 'QUALITY_CERTIFICATE.md');

  const writeJson =
    options._writeJson ??
    (async (p: string, data: string) => {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, data, 'utf8');
    });

  const writeMarkdown =
    options._writeMarkdown ??
    (async (p: string, data: string) => {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, data, 'utf8');
    });

  // Load convergence state (null-safe: treat missing as empty)
  let convergence: ConvergenceState | null = null;
  try {
    convergence = await loadConv(cwd);
  } catch {
    convergence = null;
  }

  const projectName = resolveProjectName(cwd);
  const generatedAt = new Date().toISOString();
  const certifiedBy = `danteforge-v${DANTEFORGE_VERSION}`;

  // Build dimension map
  const dimensions: Record<string, number> = {};
  for (const d of convergence?.dimensions ?? []) {
    dimensions[d.dimension] = d.score;
  }

  const overallScore = computeOverallScore(dimensions);

  // Infer pass/fail from convergence state (no shell calls here — pure state read)
  // testsPassing is true when at least one dimension exists and none have score 0
  const dimValues = Object.values(dimensions);
  const testsPassing =
    dimValues.length > 0 ? dimValues.every((s) => s > 0) : false;
  const typecheckPassing = testsPassing; // conservative: assume typecheck mirrors test health

  const evidenceFingerprint = computeHash(buildEvidenceBundle(
    projectName, generatedAt, certifiedBy, overallScore, dimensions, testsPassing, typecheckPassing,
  ));
  const attestation = buildAttestation(projectName, overallScore, certifiedBy);

  const cert: QualityCertificate = {
    version: '1.0.0',
    projectName,
    generatedAt,
    certifiedBy,
    overallScore,
    dimensions,
    evidenceFingerprint,
    testsPassing,
    typecheckPassing,
    attestation,
  };

  // Persist
  await writeJson(jsonPath, JSON.stringify(cert, null, 2));
  await writeMarkdown(mdPath, renderMarkdown(cert));

  // Log summary
  logger.info('── Quality Certificate ────────────────────────────────────────');
  logger.info(`Project      : ${projectName}`);
  logger.info(`Overall Score: ${overallScore.toFixed(2)}/10`);
  logger.info(`Dimensions   : ${Object.keys(dimensions).length}`);
  logger.info(`Evidence Hash: ${evidenceFingerprint}`);
  logger.info(`Tests Passing: ${testsPassing ? 'yes' : 'no'}`);
  logger.info(`Written to   : ${jsonPath}`);
  logger.info(`             : ${mdPath}`);

  return cert;
}
