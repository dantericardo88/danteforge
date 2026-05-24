#!/usr/bin/env node
// download-swe-bench.mjs — Fetch SWE-bench Verified instances for benchmarking.
//
// Downloads N verified instances from the Hugging Face Datasets API
// (princeton-nlp/SWE-bench_Verified) and stores them in:
//   .danteforge/benchmarks/swe-bench-<N>.json
//
// Usage:
//   node scripts/download-swe-bench.mjs               # download 50 instances
//   node scripts/download-swe-bench.mjs --count 10    # smaller set
//   node scripts/download-swe-bench.mjs --offset 50   # pagination

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, def) {
  const i = args.findIndex(a => a === flag || a.startsWith(`${flag}=`));
  if (i === -1) return def;
  const direct = args[i].split('=')[1];
  return direct ?? args[i + 1] ?? def;
}

const COUNT = parseInt(getArg('--count', '50'), 10);
const OFFSET = parseInt(getArg('--offset', '0'), 10);
const OUT_DIR = path.join(process.cwd(), '.danteforge', 'benchmarks');
const OUT_FILE = path.join(OUT_DIR, `swe-bench-${COUNT}.json`);

// ── HTTP helper ───────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DanteForge-Benchmark/1.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse failed for ${url}`)); }
      });
    }).on('error', reject);
  });
}

// ── SWE-bench row normalizer ──────────────────────────────────────────────────

function normalizeRow(row) {
  // Hugging Face returns rows as { row_idx, row: { ... } } or flat objects
  const r = row.row ?? row;
  return {
    instance_id:   r.instance_id ?? r.id ?? '',
    repo:          r.repo ?? '',
    base_commit:   r.base_commit ?? '',
    problem_statement: r.problem_statement ?? r.issue ?? '',
    hints_text:    r.hints_text ?? '',
    test_patch:    r.test_patch ?? '',
    patch:         r.patch ?? '',
    created_at:    r.created_at ?? '',
    difficulty:    r.difficulty ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const url =
    `https://datasets-server.huggingface.co/rows` +
    `?dataset=princeton-nlp%2FSWE-bench_Verified` +
    `&config=default&split=test` +
    `&offset=${OFFSET}&length=${COUNT}`;

  console.log(`[swe-bench] Fetching ${COUNT} instances from Hugging Face (offset ${OFFSET})...`);
  console.log(`[swe-bench] URL: ${url}`);

  let data;
  try {
    data = await fetchJson(url);
  } catch (err) {
    console.error(`[swe-bench] Fetch failed: ${err.message}`);
    console.error('[swe-bench] Check network connectivity. HF Datasets API is public and requires no auth.');
    process.exit(1);
  }

  const rows = data.rows ?? data;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('[swe-bench] No rows returned. Response:', JSON.stringify(data).slice(0, 300));
    process.exit(1);
  }

  const instances = rows.map(normalizeRow).filter(r => r.instance_id);
  console.log(`[swe-bench] Normalized ${instances.length} instances.`);

  // Summarize difficulty distribution if available
  const difficulties = instances.map(i => i.difficulty).filter(Boolean);
  if (difficulties.length > 0) {
    const dist = {};
    for (const d of difficulties) dist[d] = (dist[d] ?? 0) + 1;
    console.log('[swe-bench] Difficulty distribution:', JSON.stringify(dist));
  }

  // Show a sample
  if (instances[0]) {
    console.log(`[swe-bench] Sample: ${instances[0].instance_id} (${instances[0].repo})`);
    console.log(`  Problem: ${(instances[0].problem_statement ?? '').slice(0, 100)}...`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = {
    downloadedAt: new Date().toISOString(),
    source: 'princeton-nlp/SWE-bench_Verified',
    count: instances.length,
    offset: OFFSET,
    instances,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[swe-bench] Saved to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('[swe-bench] Fatal:', err.message);
  process.exit(1);
});
