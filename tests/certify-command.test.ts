import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCertify, type CertifyOptions, type QualityCertificate } from '../src/cli/commands/certify.js';
import type { ConvergenceState } from '../src/core/convergence.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function emptyConvergence(): ConvergenceState {
  return {
    version: '1.0.0',
    targetScore: 9.0,
    dimensions: [],
    cycleHistory: [],
    lastCycle: 0,
    totalCostUsd: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    adoptedPatternsSummary: [],
  };
}

function makeBaseOptions(overrides: Partial<CertifyOptions> = {}): CertifyOptions {
  return {
    cwd: '/tmp/test-project',
    _loadConvergence: async () => null,
    _writeJson: async () => {},
    _writeMarkdown: async () => {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('certify-command', () => {
  it('T1: with no convergence state → writes certificate with overallScore=0', async () => {
    const options = makeBaseOptions({
      _loadConvergence: async () => null,
    });

    const cert = await runCertify(options);

    assert.equal(cert.overallScore, 0);
    assert.deepEqual(cert.dimensions, {});
  });

  it('T2: with dimension scores → computes correct weighted average', async () => {
    const convergence: ConvergenceState = {
      ...emptyConvergence(),
      dimensions: [
        { dimension: 'testing', score: 8.0, evidence: [], scoreHistory: [8.0], converged: false },
        { dimension: 'security', score: 6.0, evidence: [], scoreHistory: [6.0], converged: false },
        { dimension: 'performance', score: 7.0, evidence: [], scoreHistory: [7.0], converged: false },
      ],
    };

    const options = makeBaseOptions({
      _loadConvergence: async () => convergence,
    });

    const cert = await runCertify(options);

    // (8 + 6 + 7) / 3 = 7.00
    assert.equal(cert.overallScore, 7.0);
    assert.equal(cert.dimensions['testing'], 8.0);
    assert.equal(cert.dimensions['security'], 6.0);
    assert.equal(cert.dimensions['performance'], 7.0);
  });

  it('T3: evidenceFingerprint is a 64-char hex string (SHA-256)', async () => {
    const options = makeBaseOptions();

    const cert = await runCertify(options);

    assert.match(
      cert.evidenceFingerprint,
      /^[0-9a-f]{64}$/,
      `evidenceFingerprint should be 64-char hex, got: "${cert.evidenceFingerprint}"`,
    );
  });

  it('T4: _writeJson injection receives valid JSON', async () => {
    let capturedPath = '';
    let capturedData = '';

    const options = makeBaseOptions({
      _writeJson: async (filePath, data) => {
        capturedPath = filePath;
        capturedData = data;
      },
    });

    await runCertify(options);

    assert.ok(capturedPath.length > 0, 'writeJson should receive a file path');
    assert.ok(capturedPath.endsWith('QUALITY_CERTIFICATE.json'), `Expected JSON certificate path, got: "${capturedPath}"`);

    // The data should be valid JSON
    let parsed: QualityCertificate;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(capturedData) as QualityCertificate;
    }, 'writeJson data should be valid JSON');

    assert.equal(parsed!.version, '1.0.0');
    assert.ok(typeof parsed!.overallScore === 'number');
    assert.ok(typeof parsed!.evidenceFingerprint === 'string');
  });

  it('T5: _writeMarkdown injection receives markdown containing "Quality Certificate"', async () => {
    let capturedMarkdown = '';

    const options = makeBaseOptions({
      _writeMarkdown: async (_filePath, data) => {
        capturedMarkdown = data;
      },
    });

    await runCertify(options);

    assert.ok(capturedMarkdown.length > 0, 'writeMarkdown should receive content');
    assert.ok(
      capturedMarkdown.includes('Quality Certificate'),
      `Expected "Quality Certificate" in markdown, got:\n${capturedMarkdown.slice(0, 200)}`,
    );
    assert.ok(
      capturedMarkdown.includes('Overall Score'),
      'Markdown should include "Overall Score"',
    );
  });

  it('T6: returns QualityCertificate with correct version="1.0.0"', async () => {
    const options = makeBaseOptions();

    const cert = await runCertify(options);

    assert.equal(cert.version, '1.0.0');
    assert.ok(typeof cert.projectName === 'string', 'projectName should be a string');
    assert.ok(cert.projectName.length > 0, 'projectName should not be empty');
    assert.ok(typeof cert.generatedAt === 'string', 'generatedAt should be an ISO timestamp string');
    assert.ok(typeof cert.certifiedBy === 'string', 'certifiedBy should be a string');
    assert.ok(cert.certifiedBy.startsWith('danteforge-'), `certifiedBy should start with "danteforge-", got: "${cert.certifiedBy}"`);
    assert.ok(typeof cert.attestation === 'string', 'attestation should be a string');
    assert.ok(cert.attestation.length > 0, 'attestation should not be empty');
  });
});
