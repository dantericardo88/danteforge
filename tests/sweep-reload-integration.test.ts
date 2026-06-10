// sweep-reload-integration.test.ts — the REAL (non-seamed) outcome → reload → derived → promote path.
// The unit seams inject scores.derived directly, which is exactly how they hid the reload bug
// (council/Codex): the chain reloaded via _fsRead, which bypasses applyOutcomeDerivedScores, so promote
// saw no fresh derived. This test runs validate on a real temp project, then proves:
//   1. loadMatrix(cwd) APPLIES the outcome-derived score (the path the fix now uses);
//   2. loadMatrix(cwd, _fsRead) does NOT (the bug — _fsRead skips derived);
//   3. promoteVerifiedScore then raises self from the real evidence.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMatrix, saveMatrix, invalidateMatrixCache } from '../src/core/compete-matrix.js';
import { promoteVerifiedScore } from '../src/core/promote-score.js';
import { runValidateCli } from '../src/cli/commands/validate.js';

const tempDirs: string[] = [];
after(async () => { for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reload-'));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  await fs.mkdir(path.join(root, '.danteforge', 'outcome-evidence'), { recursive: true });
  // A GENUINELY WIRED fixture: the callsite module exists AND a production entry imports it,
  // and the T5 outcome command runs that real entry. The previous fixture named a callsite that
  // did not exist in the temp project, so the orphan-callsite integrity gate (correctly) capped
  // derived at 7.0 and the >=8 assertions failed — the gate was right, the fixture was dishonest.
  await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'core', 'feature.mjs'),
    'export function receipt() { return "REAL RECEIPT"; }\n');
  await fs.writeFile(path.join(root, 'src', 'index.mjs'),
    'import { receipt } from "./core/feature.mjs";\nconsole.log(receipt());\n');
  const { execSync } = await import('node:child_process');
  execSync('git init && git commit --allow-empty -m init', { cwd: root, stdio: 'ignore' });
  const matrix = {
    project: 'reload-test', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: new Date().toISOString(), overallSelfScore: 5,
    dimensions: [{
      id: 'd', label: 'd', weight: 1, category: 'quality', frequency: 'high', scores: { self: 5 },
      gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '', gap_to_oss_leader: 0, oss_leader: '',
      status: 'in-progress', sprint_history: [], next_sprint_target: 8, declared_ceiling: 'T5',
      capability_test: { command: 'node src/index.mjs', description: 'real product run' },
      outcomes: [{ id: 'p', tier: 'T5', kind: 'shell', description: 'proof', command: 'node src/index.mjs', expected_exit: 0, timeout_ms: 30000, required_callsite: 'src/core/feature.mjs' }],
    }],
  };
  await fs.writeFile(path.join(root, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(matrix, null, 2));
  return root;
}

describe('real reload → derived → promote (integration)', () => {
  it('loadMatrix applies derived from evidence; _fsRead skips it; promote then raises self', async () => {
    const cwd = await makeProject();
    await runValidateCli({ dimId: 'd', cwd, forceCold: true, _onProgress: () => {}, _createTimeMachineCommit: null });

    // Strip any derived that validate persisted to matrix.json, so the only source of a derived score
    // is applyOutcomeDerivedScores reading the on-disk EVIDENCE — the exact condition where dim-dispatch's
    // _fsRead reload (which skips that apply) would see nothing. (dim-dispatch spawns `outcomes`, which
    // writes evidence; the derived must be re-applied at load, not assumed persisted.)
    const mPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
    const onDisk = JSON.parse(await fs.readFile(mPath, 'utf8'));
    delete onDisk.dimensions[0].scores.derived;
    await fs.writeFile(mPath, JSON.stringify(onDisk, null, 2));

    // (1) The fix path: invalidate + plain loadMatrix → derived is applied from the fresh evidence.
    invalidateMatrixCache();
    const applied = await loadMatrix(cwd);
    const derived = applied!.dimensions[0]!.scores['derived'];
    assert.ok(derived !== undefined && derived >= 8.0, `loadMatrix should apply T5 derived (>=8), got ${derived}`);

    // (2) The bug path: passing _fsRead bypasses applyOutcomeDerivedScores → no derived.
    invalidateMatrixCache();
    const bypassed = await loadMatrix(cwd, (p) => fs.readFile(p, 'utf8'));
    assert.equal(bypassed!.dimensions[0]!.scores['derived'], undefined, '_fsRead reload must NOT have derived applied (this was the bug)');

    // (3) promote on the derived-applied matrix raises self from real evidence, through the gate.
    const r = promoteVerifiedScore(applied!, 'd', { capabilityTestPassed: true, agent: 'integration' });
    assert.ok(r.promoted && r.after >= 8.0, `self should be promoted to the evidence-derived >=8, got ${r.after}`);
    await saveMatrix(applied!, cwd);
    invalidateMatrixCache();
    const persisted = await loadMatrix(cwd);
    assert.ok((persisted!.dimensions[0]!.scores['self'] ?? 0) >= 8.0, 'the promoted self persisted to disk through the gate');
  });
});
