// Matrix Kernel — Security Red-Team Court
// Checks agent-produced files for OWASP Top 10 vulnerability patterns before merge.
// Blocks merge (BLOCKED_BY_SECURITY) on CRITICAL findings; warns on HIGH.

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export type SecurityRiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface SecurityFinding {
  file: string;
  line: number;
  owaspCategory: string;
  riskLevel: SecurityRiskLevel;
  patternId: string;
  description: string;
  snippet: string;
}

export interface SecurityCourtReport {
  filesChecked: number;
  findings: SecurityFinding[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  recommendation: 'allow_merge' | 'block_merge';
  blockedBy: string[];
}

export interface SecurityCourtOptions {
  _readFile?: (p: string) => Promise<string>;
  _exists?: (p: string) => Promise<boolean>;
}

interface OwaspPattern {
  id: string;
  owaspCategory: string;
  riskLevel: SecurityRiskLevel;
  description: string;
  test: (line: string) => boolean;
}

// ── OWASP Top 10 patterns ────────────────────────────────────────────────────

const OWASP_PATTERNS: OwaspPattern[] = [
  // A01 — Broken Access Control
  {
    id: 'path-traversal',
    owaspCategory: 'A01:Broken-Access-Control',
    riskLevel: 'CRITICAL',
    description: 'Path traversal via user-controlled input — sanitize before joining paths',
    test: (l) => /path\.join\s*\([^)]*req\.(params|query|body)/.test(l) ||
                  /resolve\s*\([^)]*req\.(params|query|body)/.test(l),
  },
  {
    id: 'missing-auth-middleware',
    owaspCategory: 'A01:Broken-Access-Control',
    riskLevel: 'HIGH',
    description: 'Express route defined without auth middleware call',
    test: (l) => /app\.(get|post|put|patch|delete)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*async/.test(l) &&
                  !/authenticate|authorize|requireAuth|isAuthenticated|verifyToken|checkAuth/.test(l),
  },

  // A02 — Cryptographic Failures
  {
    id: 'weak-hash-md5',
    owaspCategory: 'A02:Cryptographic-Failures',
    riskLevel: 'HIGH',
    description: 'MD5 used for hashing — use SHA-256 or bcrypt for security-sensitive data',
    test: (l) => /createHash\s*\(\s*['"`]md5['"`]\)/.test(l),
  },
  {
    id: 'weak-hash-sha1',
    owaspCategory: 'A02:Cryptographic-Failures',
    riskLevel: 'HIGH',
    description: 'SHA-1 used for hashing — use SHA-256+ for security-sensitive data',
    test: (l) => /createHash\s*\(\s*['"`]sha1['"`]\)/.test(l),
  },
  {
    id: 'hardcoded-secret',
    owaspCategory: 'A02:Cryptographic-Failures',
    riskLevel: 'CRITICAL',
    description: 'Hardcoded secret/key/token literal in source — use environment variables',
    test: (l) => {
      if (/^\s*\/\/|^\s*\*/.test(l)) return false;
      return (
        /(?:sk-[A-Za-z0-9]{20,})/.test(l) ||
        /(?:ghp_[A-Za-z0-9]{36,})/.test(l) ||
        /(?:xai-[A-Za-z0-9]{20,})/.test(l) ||
        /(?:password|secret|apiKey|api_key)\s*[:=]\s*['"`][A-Za-z0-9!@#$%^&*()_+]{8,}['"`]/.test(l)
      );
    },
  },
  {
    id: 'http-not-https',
    owaspCategory: 'A02:Cryptographic-Failures',
    riskLevel: 'MEDIUM',
    description: 'Hardcoded HTTP URL — use HTTPS for any external service calls',
    test: (l) => /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(l),
  },

  // A03 — Injection
  {
    id: 'eval-injection',
    owaspCategory: 'A03:Injection',
    riskLevel: 'CRITICAL',
    description: 'eval() or new Function() executes arbitrary code — code injection risk',
    test: (l) => /\beval\s*\(|new\s+Function\s*\(/.test(l),
  },
  {
    id: 'command-injection',
    owaspCategory: 'A03:Injection',
    riskLevel: 'CRITICAL',
    description: 'exec() with non-literal argument — command injection risk',
    test: (l) => /(?:child_process\.)?exec\s*\(/.test(l) &&
                  !/exec\s*\(\s*['"`]/.test(l) &&
                  !/execFile|execSync|spawnSync/.test(l),
  },
  {
    id: 'sql-concatenation',
    owaspCategory: 'A03:Injection',
    riskLevel: 'CRITICAL',
    description: 'SQL query built via string concatenation — use parameterized queries',
    test: (l) => /(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*\+\s*(?:req\.|user\.|params\.|query\.|body\.|\$\{)/.test(l),
  },
  {
    id: 'nosql-where-injection',
    owaspCategory: 'A03:Injection',
    riskLevel: 'HIGH',
    description: 'NoSQL $where with dynamic value — prototype pollution / injection risk',
    test: (l) => /\$where\s*:\s*(?!['"`])/.test(l),
  },

  // A05 — Security Misconfiguration
  {
    id: 'cors-wildcard',
    owaspCategory: 'A05:Security-Misconfiguration',
    riskLevel: 'HIGH',
    description: 'CORS origin set to * — restrict to known origins in production',
    test: (l) => /origin\s*:\s*['"`]\*['"`]/.test(l),
  },
  {
    id: 'debug-mode-production',
    owaspCategory: 'A05:Security-Misconfiguration',
    riskLevel: 'MEDIUM',
    description: 'Hardcoded debug:true or NODE_ENV bypass — never force debug in production',
    test: (l) => /debug\s*:\s*true/.test(l) || /NODE_ENV\s*!==\s*['"`]production['"`]/.test(l),
  },

  // A07 — Identification and Authentication Failures
  {
    id: 'jwt-no-expiry',
    owaspCategory: 'A07:Auth-Failures',
    riskLevel: 'HIGH',
    description: 'JWT signed without expiry (expiresIn) — tokens never expire',
    test: (l) => /sign\s*\([^)]*\)/.test(l) && !/expiresIn|exp:/.test(l) && /jwt\.sign|jsonwebtoken/.test(l),
  },
  {
    id: 'weak-session-secret',
    owaspCategory: 'A07:Auth-Failures',
    riskLevel: 'CRITICAL',
    description: 'Session secret is a short hardcoded string — use a long random secret from env',
    test: (l) => /secret\s*:\s*['"`][a-zA-Z0-9]{1,15}['"`]/.test(l) &&
                  /session|cookie/.test(l),
  },

  // A08 — Software and Data Integrity Failures
  {
    id: 'prototype-pollution',
    owaspCategory: 'A08:Integrity-Failures',
    riskLevel: 'HIGH',
    description: 'Object.assign or spread with user-controlled input — prototype pollution risk',
    test: (l) => /Object\.assign\s*\(\s*\w+\s*,\s*req\.(body|query|params)/.test(l) ||
                  /\.\.\.\s*req\.(body|query|params)/.test(l),
  },

  // A09 — Security Logging Failures
  {
    id: 'sensitive-data-logged',
    owaspCategory: 'A09:Logging-Failures',
    riskLevel: 'HIGH',
    description: 'Sensitive field name logged via console — may expose credentials in log streams',
    test: (l) => /console\.(log|error|warn|info)\s*\(/.test(l) &&
                  /\b(password|secret|token|apiKey|api_key|authorization|creditCard)\b/i.test(l),
  },

  // A10 — Server-Side Request Forgery
  {
    id: 'ssrf-unvalidated-url',
    owaspCategory: 'A10:SSRF',
    riskLevel: 'CRITICAL',
    description: 'fetch/axios called with user-controlled URL — SSRF risk; validate/allowlist URLs',
    test: (l) => /(?:fetch|axios\.get|axios\.post|http\.get|https\.get)\s*\(\s*(?:req\.|params\.|query\.|body\.|`\$\{)/.test(l),
  },

  // XSS (cross-cutting)
  {
    id: 'xss-innerhtml',
    owaspCategory: 'A03:Injection',
    riskLevel: 'HIGH',
    description: 'innerHTML/outerHTML/document.write with dynamic content — XSS risk',
    test: (l) => /(?:innerHTML|outerHTML|document\.write)\s*[+]?=/.test(l),
  },
];

// ── Scanner ──────────────────────────────────────────────────────────────────

async function scanFile(
  absPath: string,
  relPath: string,
  readFile: (p: string) => Promise<string>,
): Promise<SecurityFinding[]> {
  let content: string;
  try {
    content = await readFile(absPath);
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const findings: SecurityFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    for (const pattern of OWASP_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          file: relPath,
          line: i + 1,
          owaspCategory: pattern.owaspCategory,
          riskLevel: pattern.riskLevel,
          patternId: pattern.id,
          description: pattern.description,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }

  return findings;
}

// ── Court runner ─────────────────────────────────────────────────────────────

export async function runSecurityCourt(
  filesChanged: string[],
  cwd: string,
  opts: SecurityCourtOptions = {},
): Promise<SecurityCourtReport> {
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const existsFn = opts._exists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });

  const tsFiles = filesChanged.filter(
    f => (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx'))
      && !f.endsWith('.d.ts')
      && !f.includes('/dist/')
      && !f.includes('node_modules'),
  );

  const allFindings: SecurityFinding[] = [];

  for (const f of tsFiles) {
    const abs = path.isAbsolute(f) ? f : path.join(cwd, f);
    if (!(await existsFn(abs))) continue;
    const rel = path.isAbsolute(f) ? path.relative(cwd, f) : f;
    const findings = await scanFile(abs, rel, readFile);
    allFindings.push(...findings);
  }

  const criticalCount = allFindings.filter(f => f.riskLevel === 'CRITICAL').length;
  const highCount = allFindings.filter(f => f.riskLevel === 'HIGH').length;
  const mediumCount = allFindings.filter(f => f.riskLevel === 'MEDIUM').length;

  const blockedBy = allFindings
    .filter(f => f.riskLevel === 'CRITICAL')
    .map(f => `${f.file}:${f.line} [${f.patternId}] ${f.description.slice(0, 60)}`);

  return {
    filesChecked: tsFiles.length,
    findings: allFindings,
    criticalCount,
    highCount,
    mediumCount,
    recommendation: criticalCount > 0 ? 'block_merge' : 'allow_merge',
    blockedBy,
  };
}
