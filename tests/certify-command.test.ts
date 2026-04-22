import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCertify } from '../src/cli/commands/certify.js';

function makeConvergence(dimensions = []) {
  return {
    targetScore: 9.0,
    dimensions,
    lastCycle: 3,
    adoptedPatternsSummary: ['pattern-a'],
  };
}

describe('runCertify', () => {
  it('returns a quality certificate with correct structure', async () => {
    const cert = await runCertify({
      _loadConvergence: async () => makeConvergence([]),
      _computeHash: (data) => 'fakehash123',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.version, '1.0.0');
    assert.ok(typeof cert.projectName === 'string');
    assert.ok(typeof cert.overallScore === 'number');
    assert.ok(typeof cert.evidenceFingerprint === 'string');
    assert.ok(typeof cert.attestation === 'string');
  });

  it('uses injected hash function', async () => {
    const cert = await runCertify({
      _loadConvergence: async () => makeConvergence([]),
      _computeHash: () => 'custom-hash-value',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.evidenceFingerprint, 'custom-hash-value');
  });

  it('builds dimensions from convergence state', async () => {
    const convergence = makeConvergence([
      { dimension: 'testing', score: 8.5, target: 9, converged: false, scoreHistory: [8.5] },
      { dimension: 'functionality', score: 9.0, target: 9, converged: true, scoreHistory: [9.0] },
    ]);
    const cert = await runCertify({
      _loadConvergence: async () => convergence,
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.dimensions['testing'], 8.5);
    assert.equal(cert.dimensions['functionality'], 9.0);
  });

  it('computes overall score as average of dimensions', async () => {
    const convergence = makeConvergence([
      { dimension: 'd1', score: 8.0, target: 9, converged: false, scoreHistory: [8.0] },
      { dimension: 'd2', score: 6.0, target: 9, converged: false, scoreHistory: [6.0] },
    ]);
    const cert = await runCertify({
      _loadConvergence: async () => convergence,
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.overallScore, 7.0);
  });

  it('handles null convergence gracefully', async () => {
    const cert = await runCertify({
      _loadConvergence: async () => null,
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.overallScore, 0);
    assert.deepEqual(cert.dimensions, {});
  });

  it('testsPassing is false when no dimensions', async () => {
    const cert = await runCertify({
      _loadConvergence: async () => makeConvergence([]),
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.testsPassing, false);
  });

  it('testsPassing is true when all dimensions have score > 0', async () => {
    const convergence = makeConvergence([
      { dimension: 'd1', score: 8.0, target: 9, converged: false, scoreHistory: [8.0] },
    ]);
    const cert = await runCertify({
      _loadConvergence: async () => convergence,
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.testsPassing, true);
  });

  it('testsPassing is false when any dimension has score 0', async () => {
    const convergence = makeConvergence([
      { dimension: 'd1', score: 8.0, target: 9, converged: false, scoreHistory: [8.0] },
      { dimension: 'd2', score: 0, target: 9, converged: false, scoreHistory: [0] },
    ]);
    const cert = await runCertify({
      _loadConvergence: async () => convergence,
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.equal(cert.testsPassing, false);
  });

  it('writes json and markdown via injected writers', async () => {
    const written: string[] = [];
    await runCertify({
      _loadConvergence: async () => makeConvergence([]),
      _computeHash: () => 'hash',
      _writeJson: async (p, data) => { written.push('json:' + p); },
      _writeMarkdown: async (p, data) => { written.push('md:' + p); },
    });
    assert.ok(written.some(w => w.startsWith('json:')));
    assert.ok(written.some(w => w.startsWith('md:')));
  });

  it('attestation mentions project name and score', async () => {
    const convergence = makeConvergence([
      { dimension: 'd1', score: 9.0, target: 9, converged: true, scoreHistory: [9.0] },
    ]);
    const cert = await runCertify({
      _loadConvergence: async () => convergence,
      _computeHash: () => 'hash',
      _writeJson: async () => {},
      _writeMarkdown: async () => {},
    });
    assert.ok(cert.attestation.includes('9.00'));
    assert.ok(cert.attestation.includes('Enterprise-Grade') || cert.attestation.includes('Production'));
  });
});
