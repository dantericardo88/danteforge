// src/dossier/fetcher.ts — HTTP fetcher with 24h disk cache and 1 req/2s rate limiter

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export type FetchFn = typeof globalThis.fetch;
export type WriteFileFn = (p: string, d: string) => Promise<void>;
export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type StatFn = (p: string) => Promise<{ mtimeMs: number }>;
export type MkdirFn = (p: string, opts: { recursive: boolean }) => Promise<unknown>;
export type SleepFn = (ms: number) => Promise<void>;

export interface FetcherDeps {
  _fetch?: FetchFn;
  _writeFile?: WriteFileFn;
  _readFile?: ReadFileFn;
  _stat?: StatFn;
  _mkdir?: MkdirFn;
  _sleep?: SleepFn;
}

export interface FetchResult {
  content: string;
  fromCache: boolean;
  hash: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_MS = 2000;                 // 1 req per 2s per domain

// Module-level rate limiter: domain → last fetch timestamp
const domainLastFetch = new Map<string, number>();

function cacheDirFor(cwd: string, competitor: string): string {
  return path.join(cwd, '.danteforge', 'dossier-cache', competitor);
}

function cacheKeyFor(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function cachePathFor(cwd: string, competitor: string, urlHash: string): string {
  return path.join(cacheDirFor(cwd, competitor), `${urlHash}.txt`);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function stripHtml(raw: string): string {
  // Remove script, style, nav, header, footer blocks with their content
  let text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to 50,000 chars to stay within LLM context limits
  if (text.length > 50_000) {
    text = text.slice(0, 50_000);
  }
  return text;
}

async function isCacheFresh(
  cachePath: string,
  statFn: StatFn,
): Promise<boolean> {
  try {
    const stat = await statFn(cachePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function enforceRateLimit(domain: string, sleepFn: SleepFn): Promise<void> {
  const last = domainLastFetch.get(domain);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < RATE_LIMIT_MS) {
      await sleepFn(RATE_LIMIT_MS - elapsed);
    }
  }
  domainLastFetch.set(domain, Date.now());
}

export async function fetchSource(
  url: string,
  competitor: string,
  cwd: string,
  deps: FetcherDeps = {},
): Promise<FetchResult> {
  const fetchFn: FetchFn = deps._fetch ?? globalThis.fetch;
  const writeFile: WriteFileFn = deps._writeFile ?? ((p, d) => fs.writeFile(p, d));
  const readFile: ReadFileFn = deps._readFile ?? ((p, e) => fs.readFile(p, e as BufferEncoding));
  const statFn: StatFn = deps._stat ?? fs.stat;
  const mkdirFn: MkdirFn = deps._mkdir ?? ((p, o) => fs.mkdir(p, o));
  const sleepFn: SleepFn = deps._sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const urlHash = cacheKeyFor(url);
  const cachePath = cachePathFor(cwd, competitor, urlHash);
  const hash = `sha256:${urlHash}`;

  // Cache hit?
  if (await isCacheFresh(cachePath, statFn)) {
    const content = await readFile(cachePath, 'utf8');
    return { content, fromCache: true, hash };
  }

  // Rate limit before fetching
  const domain = extractDomain(url);
  await enforceRateLimit(domain, sleepFn);

  // Fetch
  let rawHtml: string;
  try {
    const response = await fetchFn(url, {
      headers: {
        'User-Agent': 'DanteForge-Dossier/1.0 (competitive intelligence bot)',
        'Accept': 'text/html,text/plain,application/json',
      },
    });
    rawHtml = await response.text();
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${String(err)}`);
  }

  const content = stripHtml(rawHtml);

  // Write to cache
  await mkdirFn(cacheDirFor(cwd, competitor), { recursive: true });
  await writeFile(cachePath, content);

  return { content, fromCache: false, hash };
}

// Exported for testing
export { stripHtml, cacheKeyFor, extractDomain };
