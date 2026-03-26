// audit command tests — query self-edit audit log
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audit } from '../src/cli/commands/audit.js';
import { auditSelfEdit, loadAuditLog, type SelfEditAuditEntry } from '../src/core/safe-self-edit.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-audit-cmd-'));
  tmpDirs.push(d);
  return d;
}

function makeEntry(overrides: Partial<SelfEditAuditEntry> = {}): SelfEditAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    filePath: 'src/core/state.ts',
    action: 'write',
    reason: 'test reason',
    approved: false,
    policy: 'deny',
    ...overrides,
  };
}

describe('audit command', () => {
  it('does not crash when log is empty and returns zero entries', async () => {
    const dir = await makeTmpDir();
    await audit({ cwd: dir });
    const entries = await loadAuditLog(dir);
    assert.strictEqual(entries.length, 0, 'audit log should be empty when nothing was written');
  });

  it('does not create audit directory when log does not exist', async () => {
    const dir = await makeTmpDir();
    // Directory has no .danteforge/audit at all
    await audit({ cwd: dir });
    const auditDir = path.join(dir, '.danteforge', 'audit');
    const exists = await fs.stat(auditDir).then(() => true, () => false);
    assert.strictEqual(exists, false, 'audit should not create directory when log is absent');
  });

  it('shows all entries when log has entries', async () => {
    const dir = await makeTmpDir();
    await auditSelfEdit(makeEntry({ filePath: 'src/core/state.ts', approved: false }), dir);
    await auditSelfEdit(makeEntry({ filePath: 'src/core/gates.ts', approved: true }), dir);
    await auditSelfEdit(makeEntry({ filePath: 'src/cli/index.ts', approved: false }), dir);

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error — capturing stdout for assertion
    process.stdout.write = (chunk: string) => { chunks.push(String(chunk)); return true; };
    try {
      await audit({ format: 'json', cwd: dir });
    } finally {
      process.stdout.write = origWrite;
    }
    const parsed = JSON.parse(chunks.join('')) as unknown[];
    assert.strictEqual(parsed.length, 3, 'all 3 entries should be shown');
  });

  it('--last 2 shows only last 2 entries from 5-entry log', async () => {
    const dir = await makeTmpDir();
    for (let i = 1; i <= 5; i++) {
      await auditSelfEdit(makeEntry({ filePath: `src/file${i}.ts`, reason: `reason ${i}` }), dir);
    }

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error — capturing stdout for assertion
    process.stdout.write = (chunk: string) => { chunks.push(String(chunk)); return true; };
    try {
      await audit({ last: '2', format: 'json', cwd: dir });
    } finally {
      process.stdout.write = origWrite;
    }
    const parsed = JSON.parse(chunks.join('')) as Array<{ filePath: string }>;
    assert.strictEqual(parsed.length, 2, 'only 2 entries should be returned');
    assert.ok(parsed[0].filePath.includes('file4'), 'first of last-2 should be file4');
    assert.ok(parsed[1].filePath.includes('file5'), 'second of last-2 should be file5');
  });

  it('--format json outputs valid JSON array', async () => {
    const dir = await makeTmpDir();
    await auditSelfEdit(makeEntry({ filePath: 'src/core/pdse.ts', approved: true, policy: 'allow-with-audit' }), dir);

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error — capturing stdout for assertion
    process.stdout.write = (chunk: string) => { chunks.push(String(chunk)); return true; };

    try {
      await audit({ format: 'json', cwd: dir });
    } finally {
      process.stdout.write = origWrite;
    }

    const output = chunks.join('');
    const parsed = JSON.parse(output) as unknown[];
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 1);
  });

  it('denied entry produces an audit entry with approved=false', async () => {
    const dir = await makeTmpDir();
    await auditSelfEdit(makeEntry({ filePath: 'src/core/state.ts', approved: false, policy: 'deny' }), dir);

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error — capturing stdout for assertion
    process.stdout.write = (chunk: string) => { chunks.push(String(chunk)); return true; };
    try {
      await audit({ format: 'json', cwd: dir });
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(chunks.join('')) as Array<{ approved: boolean }>;
    assert.strictEqual(parsed[0].approved, false);
  });

  it('approved entry produces an audit entry with approved=true', async () => {
    const dir = await makeTmpDir();
    await auditSelfEdit(makeEntry({ filePath: 'src/core/gates.ts', approved: true, policy: 'allow-with-audit' }), dir);

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error — capturing stdout for assertion
    process.stdout.write = (chunk: string) => { chunks.push(String(chunk)); return true; };
    try {
      await audit({ format: 'json', cwd: dir });
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(chunks.join('')) as Array<{ approved: boolean }>;
    assert.strictEqual(parsed[0].approved, true);
  });

  it('--last 0 shows no entries', async () => {
    const dir = await makeTmpDir();
    await auditSelfEdit(makeEntry(), dir);
    await assert.doesNotReject(() => audit({ last: '0', cwd: dir }));
  });
});
