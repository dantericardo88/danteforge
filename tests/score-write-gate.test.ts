import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVerifiedScore } from '../src/core/write-verified-score.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Files permitted to assign `scores.self` directly:
//  - write-verified-score.ts — IS the gate (the one sanctioned door).
//  - honest-rescore.ts        — writes a deep-cloned SHADOW matrix to .honest-matrix.json
//                               for an informational diff report; never the real matrix.json.
const WHITELIST = new Set(['write-verified-score.ts', 'honest-rescore.ts']);

// Matches a real assignment to scores.self (bracket or dot form), not a comparison.
const SELF_WRITE = /\.scores\s*(?:\[\s*['"]self['"]\s*\]|\.self)\s*=(?!=)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip line + inline comments so a `// scores.self = …` mention isn't a false positive. */
function codeLines(content: string): string[] {
  return content.split('\n').map(line => {
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
    const c = line.indexOf('//');
    return c >= 0 ? line.slice(0, c) : line;
  });
}

describe('score-write gate — structural lock (the bypass is impossible to write)', () => {
  test('no src file outside the gate assigns scores.self', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (WHITELIST.has(path.basename(file))) continue;
      const lines = codeLines(fs.readFileSync(file, 'utf8'));
      lines.forEach((line, i) => {
        if (SELF_WRITE.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim()}`);
      });
    }
    assert.equal(
      offenders.length, 0,
      `Every self-score write must route through writeVerifiedScore(). Offending direct writes:\n  ${offenders.join('\n  ')}`,
    );
  });
});

// ── Behavioural guarantees of the gate itself ────────────────────────────────

function mkMatrix(over: Partial<MatrixDimension> = {}): CompeteMatrix {
  const dim: MatrixDimension = {
    id: 'd', name: 'D', weight: 1, frequency: 'medium',
    scores: { self: 0, Cursor: 8 }, gap_to_leader: 8, leader: 'Cursor',
    gap_to_closed_source_leader: 0, closed_source_leader: 'unknown',
    gap_to_oss_leader: 0, oss_leader: 'unknown',
    status: 'not-started', sprint_history: [], next_sprint_target: 9,
    ...over,
  } as MatrixDimension;
  return {
    project: 'p', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [],
    lastUpdated: '', overallSelfScore: 0, dimensions: [dim],
  };
}

describe('writeVerifiedScore — clamp, ceiling, market-cap, provenance, backstop', () => {
  test('per-dim ceiling is honored', () => {
    const m = mkMatrix({ ceiling: 7 });
    const after = writeVerifiedScore(m, 'd', 9.0, { agent: 'test' });
    assert.equal(after, 7);
    assert.equal(m.dimensions[0]!.scores['self'], 7);
  });

  test('market dim is capped at 5.0 regardless of raw score', () => {
    const m = mkMatrix({ id: 'community_adoption' });
    const after = writeVerifiedScore(m, 'community_adoption', 9.5, { agent: 'test' });
    assert.equal(after, 5.0);
  });

  test('a provenance row is recorded for every write (before/after/agent/raw)', () => {
    const m = mkMatrix();
    writeVerifiedScore(m, 'd', 6.2, { agent: 'merge', rationale: 'forged', gatesPassed: { capability_test: true } });
    const prov = m.scoreProvenance ?? [];
    assert.equal(prov.length, 1);
    assert.equal(prov[0]!.agent, 'merge');
    assert.equal(prov[0]!.before, 0);
    assert.equal(prov[0]!.after, 6.2);
    assert.equal(prov[0]!.rawScore, 6.2);
    assert.equal(prov[0]!.gatesPassed?.capability_test, true);
  });

  test('gateBackstop clamps an ungated >5.0 write to 5.0 (defense in depth)', () => {
    const m = mkMatrix();
    const after = writeVerifiedScore(m, 'd', 8.0, { agent: 'probe' }, { gateBackstop: true });
    assert.equal(after, 5.0, 'no capability_test proof → cannot exceed the cap');
  });

  test('gateBackstop allows >5.0 when capability_test is proven', () => {
    const m = mkMatrix();
    const after = writeVerifiedScore(m, 'd', 8.0, { agent: 'merge', gatesPassed: { capability_test: true } }, { gateBackstop: true });
    assert.equal(after, 8.0);
  });

  test('gap_to_leader is recomputed in lockstep with the new self score', () => {
    const m = mkMatrix();
    writeVerifiedScore(m, 'd', 6.0, { agent: 'test' });
    assert.equal(m.dimensions[0]!.gap_to_leader, 2.0, '8 (Cursor) - 6 (self)');
  });

  test('skipHistory suppresses the sprint_history record', () => {
    const m = mkMatrix();
    writeVerifiedScore(m, 'd', 6.0, { agent: 'ascend-orient' }, { skipHistory: true });
    assert.equal(m.dimensions[0]!.sprint_history.length, 0);
  });
});
