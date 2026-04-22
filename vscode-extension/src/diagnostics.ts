// DanteForge VS Code diagnostics — maps low-scoring artifacts to warnings/errors
// All interfaces are injectable — no real vscode imports.

export interface DiagnosticItemLike {
  severity: 'error' | 'warning' | 'information';
  message: string;
  artifactName: string;
  score: number;
}

export interface DanteForgeHoverOptions {
  _readFile?: (p: string) => Promise<string>;
  workspaceRoot?: string;
  warnThreshold?: number;   // default 60: score below = warning
  errorThreshold?: number;  // default 40: score below = error
}

/**
 * Map PDSE snapshot scores to DiagnosticItemLike[].
 * Pure function — no file I/O.
 */
export function scoresToDiagnostics(
  scores: Record<string, { score: number; decision: string }>,
  warnThreshold: number,
  errorThreshold: number,
): DiagnosticItemLike[] {
  const results: DiagnosticItemLike[] = [];

  for (const [artifact, data] of Object.entries(scores)) {
    if (data.score < errorThreshold) {
      const artifactName = artifact;
      const score = data.score;
      results.push({
        severity: 'error',
        message: formatDiagnosticMessage({ severity: 'error', artifactName, score }),
        artifactName,
        score,
      });
    } else if (data.score < warnThreshold) {
      const artifactName = artifact;
      const score = data.score;
      results.push({
        severity: 'warning',
        message: formatDiagnosticMessage({ severity: 'warning', artifactName, score }),
        artifactName,
        score,
      });
    }
  }

  return results;
}

/**
 * Format a human-readable diagnostic message for a low-scoring artifact.
 */
export function formatDiagnosticMessage(item: Pick<DiagnosticItemLike, 'artifactName' | 'score' | 'severity'>): string {
  const cmd = artifactToCommand(item.artifactName);
  const level = item.severity === 'error' ? 'needs immediate attention' : 'needs attention';
  return `${item.artifactName} score ${item.score}/100 — ${level}. Run: danteforge ${cmd}`;
}

/**
 * Read latest-pdse.json and return diagnostics for low-scoring artifacts.
 */
export async function buildDiagnostics(opts: DanteForgeHoverOptions = {}): Promise<DiagnosticItemLike[]> {
  const warnThreshold = opts.warnThreshold ?? 60;
  const errorThreshold = opts.errorThreshold ?? 40;
  const workspaceRoot = opts.workspaceRoot;

  if (!workspaceRoot) return [];

  const readFile = opts._readFile ?? (async (p: string) => {
    const { readFile: fsRead } = await import('fs/promises');
    return fsRead(p, 'utf8');
  });

  try {
    const snapshotPath = `${workspaceRoot}/.danteforge/latest-pdse.json`;
    const raw = await readFile(snapshotPath);
    const snapshot = JSON.parse(raw) as { scores: Record<string, { score: number; decision: string }> };
    return scoresToDiagnostics(snapshot.scores ?? {}, warnThreshold, errorThreshold);
  } catch {
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ARTIFACT_COMMANDS: Record<string, string> = {
  CONSTITUTION: 'constitution',
  SPEC: 'specify',
  PLAN: 'plan',
  TASKS: 'tasks',
  FORGE: 'forge 1',
  TESTS: 'verify',
};

function artifactToCommand(artifact: string): string {
  return ARTIFACT_COMMANDS[artifact.toUpperCase()] ?? 'review';
}
