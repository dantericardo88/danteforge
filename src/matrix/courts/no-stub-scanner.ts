// Matrix Kernel — No-stub scanner (Phase 9 of PRD §19)
//
// Detects fake/stub/placeholder implementations the LLM tier may emit. Runs
// over changed files in a worktree and returns a list of suspect locations.
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StubFinding {
  filePath: string;
  line: number;
  kind: 'todo-comment' | 'not-implemented' | 'empty-body' | 'fake-test';
  snippet: string;
}

export interface StubScanResult {
  ok: boolean;
  findings: StubFinding[];
}

export interface StubScanInput {
  /** Files to scan, relative to worktreeRoot. */
  files: string[];
  /** Worktree root (absolute path). */
  worktreeRoot: string;
  /** Injection seam: replaces fs.readFile for tests. */
  _readFile?: (p: string) => Promise<string>;
}

export async function scanForStubs(input: StubScanInput): Promise<StubScanResult> {
  const findings: StubFinding[] = [];
  const readFile = input._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  for (const rel of input.files) {
    if (!rel.endsWith('.ts') && !rel.endsWith('.tsx')) continue;
    let content: string;
    try { content = await readFile(path.join(input.worktreeRoot, rel)); } catch { continue; }
    findings.push(...scanContent(rel, content));
  }

  return { ok: findings.length === 0, findings };
}

// ── Scanning passes ─────────────────────────────────────────────────────────

export function scanContent(filePath: string, content: string): StubFinding[] {
  const lines = content.split(/\r?\n/);
  const findings: StubFinding[] = [];

  // 1. throw new Error('not implemented') and variants
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/throw\s+new\s+Error\s*\(\s*['"`].*not\s+implemented.*['"`]\s*\)/i.test(line)) {
      findings.push({ filePath, line: i + 1, kind: 'not-implemented', snippet: line.trim() });
    } else if (/throw\s+new\s+Error\s*\(\s*['"`]\s*TODO\b/i.test(line)) {
      findings.push({ filePath, line: i + 1, kind: 'not-implemented', snippet: line.trim() });
    }
  }

  // 2. TODO/FIXME/XXX comments standing alone in function bodies (heuristic)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^\/\/\s*(TODO|FIXME|XXX)(\b|:)/i.test(line)) {
      // Only flag if next non-empty/non-comment line is a closing brace
      let j = i + 1;
      while (j < lines.length && (lines[j]!.trim() === '' || /^\/\//.test(lines[j]!.trim()))) j++;
      const nextLine = lines[j];
      if (nextLine && /^\s*\}/.test(nextLine)) {
        findings.push({ filePath, line: i + 1, kind: 'todo-comment', snippet: line });
      }
    }
  }

  // 2b. Placeholder/dummy/stub markers in comments (any line). Caught the
  // ollama llama3 live-LLM "Placeholder content to demonstrate file change"
  // stub on agent_activity_provenance that earlier patterns missed. "fake" is
  // intentionally omitted — it's a legitimate provider/role identifier in
  // matrix-kernel and would false-positive on FakeAgentAdapter's own outputs.
  const STUB_MARKER_RE = /(?:\/\/|\/\*|\*)\s*.*\b(?:placeholder|dummy|stub|not\s+implemented|coming\s+soon|demonstrate(?:s)?\s+file\s+change)\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (STUB_MARKER_RE.test(line)) {
      findings.push({ filePath, line: i + 1, kind: 'todo-comment', snippet: line.trim() });
    }
  }

  // 3. empty function bodies: `function name() {}` or `() => {}`
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(export\s+)?(async\s+)?function\s+\w+\s*\([^)]*\)\s*(:[^{]+)?\s*\{\s*\}\s*$/.test(line)) {
      findings.push({ filePath, line: i + 1, kind: 'empty-body', snippet: line.trim() });
    }
  }

  // 4. fake tests: assert(true) or expect(x).toBe(x) — only check inside .test.ts
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/\bassert\s*\.\s*ok\s*\(\s*true\s*\)/.test(line)) {
        findings.push({ filePath, line: i + 1, kind: 'fake-test', snippet: line.trim() });
      } else if (/\bassert\s*\(\s*true\s*\)/.test(line)) {
        findings.push({ filePath, line: i + 1, kind: 'fake-test', snippet: line.trim() });
      }
    }
  }

  return findings;
}
