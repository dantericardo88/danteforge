// Tests for src/matrix-orchestration/capacity/detector.ts
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  detectCapacity,
  __internal,
} from '../../src/matrix-orchestration/capacity/detector.js';
import type { CapacityReport } from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-'));
  tmpDirs.push(d);
  return d;
}

describe('detectCapacity', () => {
  it('returns only fake + shell built-ins when nothing is installed', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      _which: async () => null,
      _envHas: () => false,
      _now: () => '2026-05-12T00:00:00.000Z',
    });
    const claude = report.providers.find((p) => p.providerId === 'claude')!;
    assert.equal(claude.installed, false);
    assert.equal(claude.authStatus, 'unknown');
    assert.equal(claude.concurrentInstances, 0);

    const fake = report.providers.find((p) => p.providerId === 'fake')!;
    assert.equal(fake.installed, true);
    assert.equal(fake.concurrentInstances, 100);

    // totalPracticalConcurrency includes fake (100) + shell (1) = 101.
    assert.equal(report.totalPracticalConcurrency, 101);
  });

  it('detects claude when binary present and API key set', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      _which: async (b) => (b === 'claude' ? '/usr/local/bin/claude' : null),
      _envHas: (v) => v === 'ANTHROPIC_API_KEY',
      _now: () => 'now',
    });
    const claude = report.providers.find((p) => p.providerId === 'claude')!;
    assert.equal(claude.installed, true);
    assert.equal(claude.authStatus, 'authenticated');
    assert.equal(claude.concurrentInstances, __internal.DEFAULT_CONCURRENCY.claude);
  });

  it('marks claude unauthenticated when binary present but no API key', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      _which: async (b) => (b === 'claude' ? '/usr/local/bin/claude' : null),
      _envHas: () => false,
      _now: () => 'now',
    });
    const claude = report.providers.find((p) => p.providerId === 'claude')!;
    assert.equal(claude.installed, true);
    assert.equal(claude.authStatus, 'unauthenticated');
    assert.equal(claude.concurrentInstances, 0);
    assert.equal(claude.constraintReason, 'authentication missing');
  });

  it('codex counts as installed when only API key is present (no binary)', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      _which: async () => null,
      _envHas: (v) => v === 'OPENAI_API_KEY',
      _now: () => 'now',
    });
    const codex = report.providers.find((p) => p.providerId === 'codex')!;
    assert.equal(codex.installed, true);
    assert.equal(codex.authStatus, 'authenticated');
    assert.equal(codex.concurrentInstances, __internal.DEFAULT_CONCURRENCY.codex);
  });

  it('ollama is available when binary present', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      _which: async (b) => (b === 'ollama' ? '/usr/local/bin/ollama' : null),
      _envHas: () => false,
      _now: () => 'now',
    });
    const ollama = report.providers.find((p) => p.providerId === 'ollama')!;
    assert.equal(ollama.installed, true);
    assert.equal(ollama.authStatus, 'authenticated');
    assert.equal(ollama.concurrentInstances, 1);
  });

  it('user override always wins over detection and benchmark', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      override: { claude: 2, fake: 0 },
      _which: async (b) => (b === 'claude' ? '/usr/local/bin/claude' : null),
      _envHas: (v) => v === 'ANTHROPIC_API_KEY',
      _benchmark: async () => ({ concurrency: 99, latencyMs: 50 }),
      _now: () => 'now',
    });
    const claude = report.providers.find((p) => p.providerId === 'claude')!;
    assert.equal(claude.concurrentInstances, 2);
    assert.equal(claude.constraintReason, 'user override');
    const fake = report.providers.find((p) => p.providerId === 'fake')!;
    assert.equal(fake.concurrentInstances, 0);
  });

  it('skipBenchmark=true short-circuits the benchmark seam', async () => {
    const cwd = await makeCwd();
    let benchCalls = 0;
    await detectCapacity({
      cwd,
      skipBenchmark: true,
      _which: async (b) => (b === 'claude' ? '/usr/local/bin/claude' : null),
      _envHas: (v) => v === 'ANTHROPIC_API_KEY',
      _benchmark: async () => {
        benchCalls += 1;
        return { concurrency: 50, latencyMs: 25 };
      },
      _now: () => 'now',
    });
    assert.equal(benchCalls, 0);
  });

  it('totalPracticalConcurrency sums only available providers', async () => {
    const cwd = await makeCwd();
    const report = await detectCapacity({
      cwd,
      _which: async (b) => (b === 'claude' ? '/usr/local/bin/claude' : null),
      _envHas: (v) => v === 'ANTHROPIC_API_KEY',
      _now: () => 'now',
    });
    // claude=10, fake=100, shell=1 → 111. Others unavailable.
    assert.equal(report.totalPracticalConcurrency, 111);
  });

  it('hostMachineSignature is deterministic on the same host', async () => {
    const cwd = await makeCwd();
    const r1 = await detectCapacity({
      cwd,
      _which: async () => null,
      _envHas: () => false,
      _now: () => 'now',
    });
    const r2 = await detectCapacity({
      cwd,
      _which: async () => null,
      _envHas: () => false,
      _now: () => 'now',
    });
    assert.equal(r1.hostMachineSignature, r2.hostMachineSignature);
    assert.ok(r1.hostMachineSignature.length > 0);
  });

  it('persists capacity report to canonical path', async () => {
    const cwd = await makeCwd();
    await detectCapacity({
      cwd,
      _which: async () => null,
      _envHas: () => false,
      _now: () => 'now',
    });
    const raw = await fs.readFile(
      path.join(cwd, '.danteforge/matrix-orchestration/capacity-report.json'),
      'utf8',
    );
    const persisted = JSON.parse(raw) as CapacityReport;
    assert.equal(persisted.providers.length, 8);
    assert.ok(persisted.totalPracticalConcurrency >= 101);
  });
});

describe('__internal helpers', () => {
  it('clampConcurrency clamps negatives and infinities to 0 and large to 1000', () => {
    assert.equal(__internal.clampConcurrency(-5), 0);
    assert.equal(__internal.clampConcurrency(Number.POSITIVE_INFINITY), 0);
    assert.equal(__internal.clampConcurrency(1e9), 1000);
    assert.equal(__internal.clampConcurrency(7.9), 7);
  });
});
