// Matrix Orchestration — Agent Capacity Detector (PRD §6.1)
//
// Detects installed providers + authentication state + practical concurrency
// per provider. Produces a `CapacityReport` and saves it under
// `.danteforge/matrix-orchestration/capacity-report.json`.
//
// All side effects flow through injection seams (`_which`, `_envHas`,
// `_benchmark`, `_now`). Tests never execute real binaries or HTTP calls.

import os from 'node:os';
import { createHash } from 'node:crypto';
import type {
  AuthStatus,
  CapacityReport,
  ProviderCapacity,
  ProviderId,
} from '../types.js';
import { saveOrch, appendAudit } from '../state-io.js';

// ── Options ─────────────────────────────────────────────────────────────────

export interface CapacityDetectorOptions {
  cwd: string;
  /** Skip the concurrency benchmark; use defaults from auth/install only. */
  skipBenchmark?: boolean;
  /** Per-provider concurrency override from the user. */
  override?: Partial<Record<ProviderId, number>>;
  /** Run id for audit log. */
  runId?: string;
  /** Detect a binary on PATH; return path or null. */
  _which?: (binary: string) => Promise<string | null>;
  /** Test for a non-empty env var. */
  _envHas?: (varName: string) => boolean;
  /** Benchmark hook — returns measured concurrency + latency. */
  _benchmark?: (
    providerId: ProviderId,
  ) => Promise<{ concurrency: number; latencyMs: number }>;
  _now?: () => string;
}

// ── Default concurrency per provider ────────────────────────────────────────
//
// These are conservative defaults tuned to a typical developer laptop. Real
// numbers will come from `_benchmark` once we wire it.

const DEFAULT_CONCURRENCY: Record<ProviderId, number> = {
  claude: 10,
  codex: 3,
  dantecode: 5,
  aider: 4,
  cursor: 0, // no headless CLI in v1
  ollama: 1,
  fake: 100,
  shell: 1,
};

// Per-1k-token cost hint (USD). 0 for local providers.
const COST_PER_K_TOKEN_USD: Record<ProviderId, number> = {
  claude: 0.015,
  codex: 0.01,
  dantecode: 0,
  aider: 0.005,
  cursor: 0.005,
  ollama: 0,
  fake: 0,
  shell: 0,
};

// ── Public API ──────────────────────────────────────────────────────────────

export async function detectCapacity(
  options: CapacityDetectorOptions,
): Promise<CapacityReport> {
  const now = options._now ?? (() => new Date().toISOString());
  const which = options._which ?? (async () => null);
  const envHas = options._envHas ?? ((v: string) => Boolean(process.env[v]));

  const startedAt = Date.now();

  const detectors: Array<() => Promise<ProviderCapacity>> = [
    () => detectClaude(which, envHas),
    () => detectCodex(which, envHas),
    () => detectDantecode(which, envHas),
    () => detectAider(which, envHas),
    () => detectCursor(which, envHas),
    () => detectOllama(which, envHas),
  ];

  const providers: ProviderCapacity[] = [];
  for (const detect of detectors) {
    try {
      providers.push(await detect());
    } catch {
      /* best-effort: a single provider failure should not poison the report */
    }
  }

  // Always include `fake` + `shell` as built-in providers — they're useful in
  // tests / scripted runs and do not depend on installation.
  providers.push(builtInProvider('fake'));
  providers.push(builtInProvider('shell'));

  // Run benchmarks when not skipped and the seam is provided.
  if (!options.skipBenchmark && options._benchmark) {
    for (const p of providers) {
      if (!isAvailable(p)) continue;
      try {
        const measured = await options._benchmark(p.providerId);
        p.concurrentInstances = clampConcurrency(measured.concurrency);
        p.benchmarkLatencyMs = measured.latencyMs;
      } catch {
        /* best-effort */
      }
    }
  }

  // Apply user override last — user override always wins.
  if (options.override) {
    for (const p of providers) {
      const ov = options.override[p.providerId];
      if (typeof ov === 'number') {
        p.concurrentInstances = clampConcurrency(ov);
        p.constraintReason = 'user override';
      }
    }
  }

  const totalPracticalConcurrency = providers
    .filter(isAvailable)
    .reduce((s, p) => s + p.concurrentInstances, 0);

  const report: CapacityReport = {
    generatedAt: now(),
    hostMachineSignature: computeHostSignature(),
    providers,
    totalPracticalConcurrency,
    benchmarkDurationMs: Date.now() - startedAt,
    ...(options.override ? { userOverride: options.override } : {}),
  };

  await saveOrch(options.cwd, 'capacityReport', report);
  await safeAudit(options, {
    component: 'capacity-detector',
    totalPracticalConcurrency,
    skipBenchmark: Boolean(options.skipBenchmark),
    overrideApplied: Boolean(options.override),
  });

  return report;
}

// ── Per-provider detection ──────────────────────────────────────────────────

async function detectClaude(
  which: (b: string) => Promise<string | null>,
  envHas: (v: string) => boolean,
): Promise<ProviderCapacity> {
  const binary = (await which('claude')) ?? (await which('claude-code'));
  const installed = binary !== null;
  const authed = envHas('ANTHROPIC_API_KEY') || envHas('CLAUDE_API_KEY');
  return makeCapacity('claude', installed, authed);
}

async function detectCodex(
  which: (b: string) => Promise<string | null>,
  envHas: (v: string) => boolean,
): Promise<ProviderCapacity> {
  const binary = (await which('codex')) ?? (await which('openai'));
  const authed = envHas('OPENAI_API_KEY') || envHas('OPENAI_BASE_URL');
  // Codex/OpenAI does not require a binary on PATH — API key suffices.
  const installed = binary !== null || authed;
  return makeCapacity('codex', installed, authed);
}

async function detectDantecode(
  which: (b: string) => Promise<string | null>,
  envHas: (v: string) => boolean,
): Promise<ProviderCapacity> {
  const binary = envHas('DANTECODE_BIN') ? '<env>' : await which('dantecode');
  const installed = binary !== null;
  // DanteCode runs locally; treat as authenticated when installed.
  return makeCapacity('dantecode', installed, installed);
}

async function detectAider(
  which: (b: string) => Promise<string | null>,
  envHas: (v: string) => boolean,
): Promise<ProviderCapacity> {
  const binary = await which('aider');
  const installed = binary !== null;
  // Aider relies on OPENAI_API_KEY (or similar) for the backend.
  const authed = envHas('OPENAI_API_KEY') || envHas('ANTHROPIC_API_KEY');
  return makeCapacity('aider', installed, authed);
}

async function detectCursor(
  which: (b: string) => Promise<string | null>,
  _envHas: (v: string) => boolean,
): Promise<ProviderCapacity> {
  const binary =
    (await which('cursor-cli')) ?? (await which('cursor-agent'));
  const installed = binary !== null;
  return makeCapacity('cursor', installed, /*authed*/ installed);
}

async function detectOllama(
  which: (b: string) => Promise<string | null>,
  _envHas: (v: string) => boolean,
): Promise<ProviderCapacity> {
  const binary = await which('ollama');
  const installed = binary !== null;
  // Ollama is local; we treat installation as auth.
  return makeCapacity('ollama', installed, installed);
}

function builtInProvider(id: ProviderId): ProviderCapacity {
  return {
    providerId: id,
    installed: true,
    authStatus: 'authenticated',
    concurrentInstances: DEFAULT_CONCURRENCY[id],
    costPerKTokenUsd: COST_PER_K_TOKEN_USD[id],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCapacity(
  providerId: ProviderId,
  installed: boolean,
  authed: boolean,
): ProviderCapacity {
  const authStatus: AuthStatus = installed
    ? authed
      ? 'authenticated'
      : 'unauthenticated'
    : 'unknown';
  const concurrentInstances =
    installed && authed ? DEFAULT_CONCURRENCY[providerId] : 0;
  const cap: ProviderCapacity = {
    providerId,
    installed,
    authStatus,
    concurrentInstances,
    costPerKTokenUsd: COST_PER_K_TOKEN_USD[providerId],
  };
  if (!installed) cap.constraintReason = 'binary not found on PATH';
  else if (!authed) cap.constraintReason = 'authentication missing';
  return cap;
}

function isAvailable(p: ProviderCapacity): boolean {
  return (
    p.installed &&
    p.authStatus === 'authenticated' &&
    p.concurrentInstances > 0
  );
}

function clampConcurrency(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1000) return 1000;
  return Math.floor(n);
}

function computeHostSignature(): string {
  const seed = [
    process.version,
    process.platform,
    process.arch,
    String(os.cpus().length),
  ].join('|');
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

async function safeAudit(
  options: CapacityDetectorOptions,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await appendAudit(options.cwd, {
      ts: options._now ? options._now() : new Date().toISOString(),
      runId: options.runId ?? 'capacity-detector',
      kind: 'capacity_constraint',
      stage: 'detecting_capacity',
      payload,
    });
  } catch {
    /* best-effort */
  }
}

// ── Re-exports for test ergonomics ──────────────────────────────────────────

export const __internal = {
  DEFAULT_CONCURRENCY,
  COST_PER_K_TOKEN_USD,
  computeHostSignature,
  clampConcurrency,
  isAvailable,
};
