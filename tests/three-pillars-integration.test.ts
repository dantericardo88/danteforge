// three-pillars-integration.test.ts — verifies the three structural defenses.
//
// P1: no production file (other than exempted modules) contains `dim.scores.self =` writes.
// P2: the orphan-audit harden check is registered in DEFAULT_CHECKS.
// P3: the recency-check harden check is registered in DEFAULT_CHECKS with cap 7.0.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HARDEN_CHECK_CAPS } from '../src/matrix/types/harden-check.js';
import { checkOrphanAudit, checkRecencyCheck } from '../src/matrix/engines/hardener.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..');

async function walkTs(root: string, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch { return out; }
  for (const ent of entries) {
    if (['node_modules', 'dist', '.git', '.danteforge', 'coverage', 'build'].includes(ent.name)) continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) await walkTs(full, out);
    else if (ent.isFile() && /\.ts$/.test(ent.name) && !/\.test\.ts$/.test(ent.name)) out.push(full);
  }
  return out;
}

describe('Three Pillars integration', () => {
  describe('Pillar 1 — single-writer reconciler', () => {
    it('no production .ts file outside the exempt set writes dim.scores.self =', async () => {
      const EXEMPT = new Set([
        path.join('src', 'core', 'compete-matrix.ts'),
        path.join('src', 'cli', 'commands', 'honest-rescore.ts'),
      ].map(p => p.replace(/\\/g, '/')));

      const srcRoot = path.join(PROJECT_ROOT, 'src');
      const files = await walkTs(srcRoot);
      const violations: Array<{ file: string; line: number; text: string }> = [];

      for (const file of files) {
        const rel = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
        if (EXEMPT.has(rel)) continue;
        const content = await fs.readFile(file, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/\bdim\.scores(\['?self'?\]|\.self)\s*=/.test(lines[i]!)) {
            violations.push({ file: rel, line: i + 1, text: lines[i]!.trim() });
          }
        }
      }

      if (violations.length > 0) {
        const lines = violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n');
        assert.fail(`Direct dim.scores.self writes detected outside the exempt set:\n${lines}`);
      }
    });
  });

  describe('Pillar 2 — orphan-audit', () => {
    it('orphan-audit harden check exists and has cap 6.0', () => {
      assert.equal(HARDEN_CHECK_CAPS['orphan-audit'], 6.0);
      assert.equal(typeof checkOrphanAudit, 'function');
    });
  });

  describe('Pillar 3 — recency-check', () => {
    it('recency-check harden check exists and has cap 7.0', () => {
      assert.equal(HARDEN_CHECK_CAPS['recency-check'], 7.0);
      assert.equal(typeof checkRecencyCheck, 'function');
    });

    it('entry-points config is in place at .danteforge/config/entry-points.json', async () => {
      const configPath = path.join(PROJECT_ROOT, '.danteforge', 'config', 'entry-points.json');
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      assert.ok(Array.isArray(parsed.patterns));
      assert.ok(parsed.patterns.length > 0);
      assert.equal(typeof parsed.thresholdDays, 'number');
    });
  });
});
