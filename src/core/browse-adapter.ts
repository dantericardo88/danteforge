// Browse Adapter — binary detection, invocation, response parsing for gstack browse daemon.
// Local-first: daemon binds to localhost only, no remote endpoints.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

export type BrowseSubcommand =
  | 'goto' | 'screenshot' | 'text' | 'html' | 'links' | 'forms'
  | 'accessibility' | 'click' | 'fill' | 'select' | 'snapshot'
  | 'js' | 'eval' | 'css' | 'attrs' | 'console' | 'network'
  | 'dialog' | 'cookies' | 'storage' | 'perf' | 'diff'
  | 'chain' | 'cookie-import' | 'tabs' | 'newtab' | 'closetab';

export interface BrowseAdapterConfig {
  binaryPath: string;
  port?: number;           // default: 9400, or derived from worktree context
  workspaceId?: string;    // for multi-workspace isolation
  timeoutMs?: number;      // default: 10000
  evidenceDir?: string;    // default: .danteforge/evidence/
}

export interface BrowseResult {
  success: boolean;
  stdout: string;
  exitCode: number;
  evidencePath?: string;  // set when screenshot/pdf was written
  errorMessage?: string;
}

export interface BrowseBinaryInfo {
  path: string;
  version?: string;
}

// ── Default config ──────────────────────────────────────────────────────────

const DEFAULT_PORT = 9400;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EVIDENCE_DIR = '.danteforge/evidence';

// ── Binary detection ────────────────────────────────────────────────────────

/** Consolidated injection seam options for browse-adapter testing */
export interface BrowseAdapterTestOpts {
  _exec?: (bin: string, args: string[], opts: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string; stderr: string }>;
  _mkdir?: (p: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  _fsAccess?: (p: string) => Promise<void>;
  _checkHealth?: (targetPort: number) => Promise<boolean>;
}

const BINARY_NAMES = ['browse', 'browse.exe'];
const COMMON_LOCATIONS = [
  './bin/browse',
  './node_modules/.bin/browse',
];

export async function detectBrowseBinary(
  opts?: BrowseAdapterTestOpts,
): Promise<string | null> {
  const checkAccess = opts?._fsAccess ?? ((p: string) => fs.access(p));

  // 1. Check common project-local locations
  for (const loc of COMMON_LOCATIONS) {
    try {
      await checkAccess(loc);
      return loc;
    } catch {
      // Not found, continue
    }
  }

  // 2. Search PATH
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    for (const name of BINARY_NAMES) {
      const candidate = path.join(dir, name);
      try {
        await checkAccess(candidate);
        return candidate;
      } catch {
        // Not found, continue
      }
    }
  }

  return null;
}

// ── Port derivation ─────────────────────────────────────────────────────────

export function getBrowsePort(worktreeId?: string, conductorPort?: number): number {
  if (conductorPort) return conductorPort;
  if (!worktreeId) return DEFAULT_PORT;
  // Derive a deterministic port from worktree ID
  let hash = 0;
  for (let i = 0; i < worktreeId.length; i++) {
    hash = ((hash << 5) - hash + worktreeId.charCodeAt(i)) | 0;
  }
  // Map to port range 9400–9499
  return DEFAULT_PORT + (Math.abs(hash) % 100);
}

// ── Invocation ──────────────────────────────────────────────────────────────

export async function invokeBrowse(
  subcommand: BrowseSubcommand,
  args: string[],
  config: BrowseAdapterConfig,
  opts?: BrowseAdapterTestOpts,
): Promise<BrowseResult> {
  const exec = opts?._exec ?? execFileAsync;
  const mkdir = opts?._mkdir ?? ((p: string, o: { recursive: boolean }) => fs.mkdir(p, o));

  const port = config.port ?? DEFAULT_PORT;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const evidenceDir = config.evidenceDir ?? DEFAULT_EVIDENCE_DIR;

  // For screenshot subcommand, auto-generate evidence path
  let evidencePath: string | undefined;
  if (subcommand === 'screenshot') {
    await mkdir(evidenceDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    evidencePath = path.join(evidenceDir, `screenshot-${timestamp}.png`);
    args = [...args, '--output', evidencePath];
  }

  const fullArgs = [subcommand, '--port', String(port), ...args];

  try {
    const { stdout, stderr } = await exec(config.binaryPath, fullArgs, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    if (stderr && stderr.trim()) {
      // stderr is informational, not failure
    }

    return {
      success: true,
      stdout: stdout.trim(),
      exitCode: 0,
      evidencePath,
    };
  } catch (err) {
    const error = err as { code?: string; killed?: boolean; stdout?: string; stderr?: string; status?: number };
    const exitCode = error.status ?? 1;
    const errorMessage = error.killed
      ? `Browse command timed out after ${timeoutMs}ms`
      : error.stderr ?? error.stdout ?? String(err);

    return {
      success: false,
      stdout: error.stdout ?? '',
      exitCode,
      errorMessage: typeof errorMessage === 'string' ? errorMessage : String(errorMessage),
    };
  }
}

// ── Daemon check ────────────────────────────────────────────────────────────

export async function isBrowseDaemonRunning(
  port?: number,
  opts?: BrowseAdapterTestOpts,
): Promise<boolean> {
  const targetPort = port ?? DEFAULT_PORT;
  if (opts?._checkHealth) return opts._checkHealth(targetPort);
  try {
    const http = await import('node:http');
    return new Promise<boolean>((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: targetPort, path: '/health', method: 'GET', timeout: 2000 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  } catch {
    return false;
  }
}

// ── Install instructions ────────────────────────────────────────────────────

export function getBrowseInstallInstructions(platform: NodeJS.Platform): string {
  const lines = [
    'Browse binary not found. Install with:',
    '',
  ];

  switch (platform) {
    case 'darwin':
      lines.push('  brew install gstack/tap/browse');
      lines.push('  # or download from https://github.com/gstack/browse/releases');
      break;
    case 'linux':
      lines.push('  curl -fsSL https://get.gstack.dev/browse | sh');
      lines.push('  # or download from https://github.com/gstack/browse/releases');
      break;
    case 'win32':
      lines.push('  winget install gstack.browse');
      lines.push('  # or download from https://github.com/gstack/browse/releases');
      break;
    default:
      lines.push('  Download from https://github.com/gstack/browse/releases');
  }

  lines.push('');
  lines.push('After installation, re-run your command.');
  return lines.join('\n');
}
