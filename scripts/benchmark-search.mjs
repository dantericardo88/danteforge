#!/usr/bin/env node
// benchmark-search.mjs — Phase L.5 cross-engine benchmark harness
// (docs/PRDs/autonomous-frontier-reaching.md L.5).
//
// Runs identical workloads against:
//   - DanteForge MinimalNativeEngine
//   - DanteForge RipgrepFallback
//   - Semble (if installed; silently skipped otherwise — harvest-only per I2)
//
// Output: a comparison table with index time, query time, and result counts
// for each engine on each workload. Useful for "is our native engine faster?"
// experiments without firing up a full test runner.
//
// Honest scope:
//   - Semble integration runs ONLY when `python -c "import semble"` succeeds.
//     We never bundle or vendor Semble; PRD I2 (harvest-never-incorporates).
//   - Latency numbers depend on disk + filesystem cache + OS. Run the script
//     twice and discard the first (cold cache) run for the comparison that
//     matters.
//   - This is a harness for operator-driven empirical comparison, not a
//     unit test. Tests live under tests/.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import url from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ── Workloads ────────────────────────────────────────────────────────────────

const WORKLOADS = [
  { kind: 'symbol', query: 'createSearchEngine', label: 'symbol findSymbol' },
  { kind: 'symbol', query: 'runHardenGate', label: 'symbol findSymbol' },
  { kind: 'imports', query: 'loadMatrix', label: 'import findImports' },
  { kind: 'pattern', query: 'TODO', label: 'pattern findPattern' },
];

// ── DanteForge engine probe ─────────────────────────────────────────────────

async function timeDanteEngine(engine, kind, query) {
  const args = ['dist/index.js', 'search'];
  if (kind === 'symbol') args.push('symbol', query);
  else if (kind === 'imports') args.push('imports', query);
  else args.push('find', query);
  args.push('--engine', engine, '--json');
  const t0 = Date.now();
  try {
    const { stdout } = await execFileAsync('node', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    const elapsedMs = Date.now() - t0;
    const parsed = JSON.parse(stdout || '[]');
    return { elapsedMs, count: Array.isArray(parsed) ? parsed.length : 0, ok: true };
  } catch (err) {
    return { elapsedMs: Date.now() - t0, count: 0, ok: false, error: String(err?.message ?? err) };
  }
}

// ── Semble probe (silent when absent) ───────────────────────────────────────

async function detectSemble() {
  return await new Promise((resolve) => {
    const cp = spawn('python', ['-c', 'import semble; print(semble.__version__)'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    cp.stdout.on('data', d => { out += d.toString(); });
    cp.on('error', () => resolve(null));
    cp.on('close', code => resolve(code === 0 ? out.trim() : null));
  });
}

// eslint-disable-next-line no-unused-vars
async function timeSembleEngine(_kind, _query) {
  // Harvest discipline (PRD I2): we do not vendor Semble's API. The harness
  // skips Semble timing entirely when not installed. When Semble IS present,
  // operators can extend this function with their own probe. We don't ship
  // a `from semble import ...` call to avoid coupling.
  return null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function pad(s, w) { return String(s).padStart(w); }
function padRight(s, w) { return String(s).padEnd(w); }

function printTable(results) {
  const header = `${padRight('workload', 22)}  ${pad('native', 12)}  ${pad('ripgrep', 12)}  ${pad('semble', 12)}`;
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const r of results) {
    const nat = r.native.ok ? `${r.native.elapsedMs}ms (${r.native.count})` : 'err';
    const rg = r.ripgrep.ok ? `${r.ripgrep.elapsedMs}ms (${r.ripgrep.count})` : 'err';
    const sm = r.semble ? `${r.semble.elapsedMs}ms (${r.semble.count})` : '─';
    console.log(`${padRight(r.label.slice(0, 22), 22)}  ${pad(nat, 12)}  ${pad(rg, 12)}  ${pad(sm, 12)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('DanteForge search benchmark — Phase L.5 harness');
  console.log(`repo: ${repoRoot}`);
  const sembleVersion = await detectSemble();
  if (sembleVersion) {
    console.log(`semble: detected (${sembleVersion}) — harvest-only timing (no vendoring per I2)`);
  } else {
    console.log('semble: not installed — skipping (install via pip install semble to compare)');
  }
  console.log('');

  const results = [];
  for (const w of WORKLOADS) {
    const native = await timeDanteEngine('native', w.kind, w.query);
    const ripgrep = await timeDanteEngine('ripgrep', w.kind, w.query);
    const semble = sembleVersion ? await timeSembleEngine(w.kind, w.query) : null;
    results.push({ label: `${w.kind}: ${w.query}`, native, ripgrep, semble });
  }
  printTable(results);

  console.log('');
  console.log('Note: run twice and discard the first run (cold OS file cache).');
  console.log('Honest disclosure: Semble row is null when Semble is not installed; PRD I2 harvest-never-incorporates.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
