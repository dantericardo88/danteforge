/**
 * One-time cleanup: reset scores.self to evidence_integrity.auditedSelfScore,
 * recalculate gap_to_leader/leader, and purge corrupted sprint_history entries.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const matrixPath = path.join('.danteforge', 'compete', 'matrix.json');
const raw = await fs.readFile(matrixPath, 'utf8');
const matrix = JSON.parse(raw);

let changed = 0;

for (const dim of matrix.dimensions) {
  const ei = dim.evidence_integrity;
  if (!ei || typeof ei.auditedSelfScore !== 'number') continue;

  const auditedScore = ei.auditedSelfScore;
  const oldSelf = dim.scores['self'];

  // 1. Reset self score to audited value
  dim.scores['self'] = auditedScore;

  // 2. Recalculate leader / gap_to_leader across all scores
  const entries = Object.entries(dim.scores);
  const maxScore = Math.max(...entries.map(([, v]) => Number(v)));
  const leader = entries.find(([, v]) => Number(v) === maxScore)?.[0] ?? 'unknown';
  dim.leader = leader;
  dim.gap_to_leader = +(Math.max(0, maxScore - auditedScore).toFixed(1));

  // 3. Clean sprint_history: drop entries with out-of-range values and strict duplicates
  if (Array.isArray(dim.sprint_history)) {
    const seen = new Set();
    const cleaned = dim.sprint_history.filter(entry => {
      const before = Number(entry.before);
      const after = Number(entry.after);
      const valid = before >= 0 && before <= 10 && after >= 0 && after <= 10;
      if (!valid) return false;
      const key = `${before}|${after}|${entry.date ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const removed = dim.sprint_history.length - cleaned.length;
    if (removed > 0) {
      console.log(`  [${dim.id}] sprint_history: removed ${removed} corrupted/duplicate entries`);
    }
    dim.sprint_history = cleaned;
  }

  if (oldSelf !== auditedScore) {
    console.log(`  [${dim.id}] scores.self: ${oldSelf} → ${auditedScore}, leader: ${leader}, gap: ${dim.gap_to_leader}`);
    changed++;
  }
}

await fs.writeFile(matrixPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
console.log(`\nDone. ${changed} dimension(s) had self-score corrected.`);
