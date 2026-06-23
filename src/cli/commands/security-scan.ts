// security-scan.ts — `danteforge security-scan`
// Scans TypeScript source files for known risky patterns and reports findings.
// Exits 1 if any CRITICAL findings are found.

import fs from 'fs/promises';
import path from 'path';
import { logger, maskSecrets } from '../../core/logger.js';
import { validateSecurityControls } from '../../core/security-controls.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface RiskPattern {
  id: string;
  description: string;
  risk: RiskLevel;
  /** Test whether a line (with its 0-based line index) contains the pattern. */
  test: (line: string) => boolean;
}

export interface ScanFinding {
  file: string;
  line: number;
  risk: RiskLevel;
  patternId: string;
  description: string;
  snippet: string;
}

export interface SecurityScanResult {
  findings: ScanFinding[];
  filesScanned: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  passed: boolean;
  securityControls: Awaited<ReturnType<typeof validateSecurityControls>>;
}

export interface SecurityScanOptions {
  json?: boolean;
  cwd?: string;
  // Injection seam: override glob to list files (for testing)
  _glob?: (pattern: string, opts: { cwd: string; absolute: boolean }) => Promise<string[]>;
  // Injection seam: override fs.readFile
  _readFile?: (p: string) => Promise<string>;
  // Injection seam: capture stdout lines
  _stdout?: (line: string) => void;
  // Injection seam: set exit code
  _setExitCode?: (code: number) => void;
}

// ── Risk patterns ─────────────────────────────────────────────────────────────

const RISK_PATTERNS: RiskPattern[] = [
  {
    id: 'eval-usage',
    description: 'eval() or new Function() executes arbitrary code — code injection risk',
    risk: 'CRITICAL',
    test: (line) => /\beval\s*\(|new\s+Function\s*\(/.test(line),
  },
  {
    id: 'exec-non-literal',
    description: 'child_process.exec() with non-literal arg — command injection risk',
    risk: 'CRITICAL',
    test: (line) => /child_process\.exec\s*\(/.test(line) && !/child_process\.exec\s*\(\s*['"`]/.test(line),
  },
  {
    id: 'innerhtml-assignment',
    description: 'innerHTML assignment may allow XSS if content is user-controlled',
    risk: 'HIGH',
    test: (line) => /innerHTML\s*[+]?=/.test(line),
  },
  {
    id: 'hardcoded-api-key',
    description: 'Hardcoded API key pattern (sk-, Bearer, ghp_) found in source',
    risk: 'CRITICAL',
    test: (line) => {
      // Only flag lines with what looks like an actual key value, not just references
      return (
        /(?:sk-[A-Za-z0-9]{20,})/.test(line) ||
        /(?:ghp_[A-Za-z0-9]{36,})/.test(line) ||
        /(?:xai-[A-Za-z0-9]{20,})/.test(line)
      );
    },
  },
  {
    id: 'math-random-security',
    description: 'Math.random() used in a security context — use crypto.getRandomValues() instead',
    risk: 'HIGH',
    test: (line) =>
      /Math\.random\s*\(\s*\)/.test(line) &&
      /\b(token|password|secret|key|nonce|salt|csrf|uuid|id)\b/i.test(line),
  },
];

// ── Comment detection helpers ─────────────────────────────────────────────────

/**
 * Returns true if the line appears to be a full-line comment (`//` or `*`).
 * Does not detect inline comments — that would require a full parser.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

const CREDENTIAL_SNIPPET_ASSIGNMENT_REGEX =
  /\b([A-Za-z_$][\w$-]*)\b(\s*[:=]\s*)(['"`])([^'"`\s]{8,})(\3)/g;

const CREDENTIAL_NAME_FRAGMENTS = [
  'apikey',
  'accesstoken',
  'authtoken',
  'providertoken',
  'clientsecret',
  'privatekey',
  'password',
  'secret',
];

function isCredentialLikeName(name: string): boolean {
  const normalized = name.replace(/[_-]/g, '').toLowerCase();
  return CREDENTIAL_NAME_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
    normalized.endsWith('token');
}

function redactFindingSnippet(line: string): string {
  const maskedKnownProviders = maskSecrets(line.trim());
  return maskedKnownProviders.replace(
    CREDENTIAL_SNIPPET_ASSIGNMENT_REGEX,
    (match, name: string, separator: string, quote: string, _value: string, closingQuote: string) => {
      if (!isCredentialLikeName(name)) return match;
      return `${name}${separator}${quote}****${closingQuote}`;
    },
  );
}

// ── Scanner ───────────────────────────────────────────────────────────────────

async function scanFile(
  filePath: string,
  cwd: string,
  readFile: (p: string) => Promise<string>,
): Promise<ScanFinding[]> {
  let content: string;
  try {
    content = await readFile(filePath);
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const findings: ScanFinding[] = [];
  const relPath = path.relative(cwd, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    for (const pattern of RISK_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          file: relPath,
          line: i + 1,
          risk: pattern.risk,
          patternId: pattern.id,
          description: pattern.description,
          snippet: redactFindingSnippet(line).slice(0, 120),
        });
      }
    }
  }

  return findings;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatFindings(result: SecurityScanResult, emit: (l: string) => void): void {
  emit('');
  emit('## DanteForge Security Scan');
  emit(`Files scanned: ${result.filesScanned}`);
  emit(`Findings: CRITICAL=${result.criticalCount} HIGH=${result.highCount} MEDIUM=${result.mediumCount}`);
  if (result.securityControls.issues.length > 0) {
    emit(`Security controls: ${result.securityControls.issues.length} issue(s)`);
  }
  emit('');

  if (result.findings.length === 0 && result.securityControls.issues.length === 0) {
    emit('No security findings. All clear.');
  } else if (result.findings.length === 0) {
    emit('No source pattern findings.');
  } else {
    emit('| File | Line | Risk | Pattern | Description |');
    emit('|------|------|------|---------|-------------|');

    for (const f of result.findings) {
      emit(`| ${f.file} | ${f.line} | ${f.risk} | ${f.patternId} | ${f.description} |`);
    }

    emit('');
  }

  if (result.securityControls.issues.length > 0) {
    emit('### Security Controls');
    for (const issue of result.securityControls.issues) emit(`- ${issue}`);
    emit('');
  }

  if (!result.passed) {
    emit('CRITICAL findings detected — fix before merging.');
  }
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function securityScan(options: SecurityScanOptions = {}): Promise<SecurityScanResult> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((l: string) => logger.info(l));
  const setExitCode = options._setExitCode ?? ((c: number) => { process.exitCode = c; });
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  const globFn = options._glob ?? (async (pattern: string, opts: { cwd: string; absolute: boolean }) => {
    const { glob: nodeGlob } = await import('glob');
    return nodeGlob(pattern, opts);
  });

  // Exclude security tooling files — they define patterns as regex literals
  // which the scanner matches against itself (false positives).
  const SCANNER_OWN_FILES = new Set([
    'src/cli/commands/security-scan.ts',
    'src/core/paranoid-review.ts',
    'src/core/pattern-security-scanner.ts',
    'src/matrix/courts/security-red-team.ts',
  ]);
  const files = (await globFn('src/**/*.ts', { cwd, absolute: true }))
    .filter(f => !SCANNER_OWN_FILES.has(path.relative(cwd, f).replace(/\\/g, '/')));

  const allFindings: ScanFinding[] = [];

  await Promise.all(
    files.map(async (f) => {
      const findings = await scanFile(f, cwd, readFile);
      allFindings.push(...findings);
    }),
  );

  // Sort: CRITICAL first, then HIGH, then MEDIUM, then by file+line
  const rankOf: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  allFindings.sort((a, b) => {
    const rd = rankOf[a.risk] - rankOf[b.risk];
    if (rd !== 0) return rd;
    const fd = a.file.localeCompare(b.file);
    if (fd !== 0) return fd;
    return a.line - b.line;
  });

  const securityControls = await validateSecurityControls({ cwd, checkSecrets: true });
  const secretControlCriticalCount = securityControls.issues.filter((issue) =>
    issue.startsWith('Potential secret in '),
  ).length;

  const criticalCount = allFindings.filter((f) => f.risk === 'CRITICAL').length + secretControlCriticalCount;
  const highCount = allFindings.filter((f) => f.risk === 'HIGH').length;
  const mediumCount = allFindings.filter((f) => f.risk === 'MEDIUM').length;
  const passed = criticalCount === 0;

  const result: SecurityScanResult = {
    findings: allFindings,
    filesScanned: files.length,
    criticalCount,
    highCount,
    mediumCount,
    passed,
    securityControls,
  };

  if (options.json) {
    emit(JSON.stringify(result, null, 2));
  } else {
    formatFindings(result, emit);
  }

  if (!passed) {
    setExitCode(1);
  }

  return result;
}
