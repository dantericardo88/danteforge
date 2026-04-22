// QA Runner — orchestrates browse-based QA passes (full, quick, regression).
// Delegates to browse-adapter for browser commands and qa-scorer for scoring.
import fs from 'fs/promises';
import path from 'path';
import type { BrowseAdapterConfig } from './browse-adapter.js';
import { invokeBrowse, detectBrowseBinary, getBrowseInstallInstructions } from './browse-adapter.js';
import {
  scoreAccessibility,
  scoreConsoleErrors,
  scoreNetworkFailures,
  scorePerformance,
  rankIssues,
  computeQAScoreFromIssues,
} from './qa-scorer.js';

export type QARunMode = 'full' | 'quick' | 'regression';

export interface QAIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'informational';
  category: string;
  description: string;
  element?: string;
  screenshotPath?: string;
  remediation: string;
}

export interface QAReport {
  score: number;           // 0–100
  mode: QARunMode;
  url: string;
  timestamp: string;
  issues: QAIssue[];
  screenshots: string[];
  regressions?: QAIssue[];  // set when mode === 'regression'
  baselineCompared?: string; // path to baseline used
}

export type BrowseResult = { success: boolean; stdout: string; errorMessage?: string; evidencePath?: string };

export interface QARunOptions {
  url: string;
  mode: QARunMode;
  baselinePath?: string;
  saveBaseline?: boolean;
  failBelow?: number;
  evidenceDir: string;
  browseConfig: BrowseAdapterConfig;
  /** Injected for testing — replaces invokeBrowse to avoid real browser dependency */
  _invokeBrowse?: (command: string, args: string[], config: BrowseAdapterConfig) => Promise<BrowseResult>;
  /** Injected for testing — replaces fs operations to avoid real I/O */
  _fsAdapter?: {
    mkdir: (p: string, opts: { recursive: boolean }) => Promise<string | undefined>;
    readFile: (p: string, encoding: string) => Promise<string>;
    writeFile: (p: string, content: string) => Promise<void>;
  };
}

// ── Main QA pass ────────────────────────────────────────────────────────────

export async function runQAPass(options: QARunOptions): Promise<QAReport> {
  const { url, mode, evidenceDir, browseConfig } = options;
  const browse = options._invokeBrowse ?? invokeBrowse;
  const fsOps = {
    mkdir: options._fsAdapter?.mkdir ?? ((p: string, opts: { recursive: boolean }) => fs.mkdir(p, opts)),
    readFile: options._fsAdapter?.readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding)),
    writeFile: options._fsAdapter?.writeFile ?? ((p: string, c: string) => fs.writeFile(p, c)),
  };

  // Ensure evidence directory exists
  await fsOps.mkdir(evidenceDir, { recursive: true });

  const issues: QAIssue[] = [];
  const screenshots: string[] = [];
  const timestamp = new Date().toISOString();

  // Step 1: Navigate
  const gotoResult = await browse('goto', [url], browseConfig);
  if (!gotoResult.success) {
    issues.push({
      id: 'nav-1',
      severity: 'critical',
      category: 'navigation',
      description: `Failed to navigate to ${url}: ${gotoResult.errorMessage ?? 'unknown error'}`,
      remediation: 'Check that the URL is accessible and the application is running',
    });
    // Return early — can't run further checks if navigation fails
    return {
      score: computeQAScoreFromIssues(issues),
      mode,
      url,
      timestamp,
      issues: rankIssues(issues),
      screenshots,
    };
  }

  // Step 2: Screenshot
  const screenshotResult = await browse('screenshot', [], {
    ...browseConfig,
    evidenceDir,
  });
  if (screenshotResult.success && screenshotResult.evidencePath) {
    screenshots.push(screenshotResult.evidencePath);
  }

  // Step 3: Accessibility check
  const a11yResult = await browse('accessibility', [], browseConfig);
  if (a11yResult.success) {
    issues.push(...scoreAccessibility(a11yResult.stdout));
  }

  // Quick mode stops here
  if (mode === 'quick') {
    const ranked = rankIssues(issues);
    return {
      score: computeQAScoreFromIssues(ranked),
      mode,
      url,
      timestamp,
      issues: ranked,
      screenshots,
    };
  }

  // Step 4: Console errors (full + regression only)
  const consoleResult = await browse('console', [], browseConfig);
  if (consoleResult.success) {
    issues.push(...scoreConsoleErrors(consoleResult.stdout));
  }

  // Step 5: Network failures (full + regression only)
  const networkResult = await browse('network', [], browseConfig);
  if (networkResult.success) {
    issues.push(...scoreNetworkFailures(networkResult.stdout));
  }

  // Step 6: Performance (full + regression only)
  const perfResult = await browse('perf', [], browseConfig);
  if (perfResult.success) {
    issues.push(...scorePerformance(perfResult.stdout));
  }

  const ranked = rankIssues(issues);
  const report: QAReport = {
    score: computeQAScoreFromIssues(ranked),
    mode,
    url,
    timestamp,
    issues: ranked,
    screenshots,
  };

  // Regression comparison
  if (mode === 'regression' && options.baselinePath) {
    try {
      const baselineContent = await fsOps.readFile(options.baselinePath, 'utf8');
      const baseline = JSON.parse(baselineContent) as QAReport;
      const regressions = findRegressions(baseline, report);
      report.regressions = regressions;
      report.baselineCompared = options.baselinePath;
    } catch {
      // Baseline not found or invalid — skip regression diff
    }
  }

  return report;
}

// ── Baseline management ─────────────────────────────────────────────────────

export async function saveQABaseline(
  report: QAReport,
  baselinePath: string,
  _fsAdapter?: { mkdir: (p: string, opts: { recursive: boolean }) => Promise<string | undefined>; writeFile: (p: string, content: string) => Promise<void> },
): Promise<void> {
  const fsOps = _fsAdapter ?? { mkdir: (p: string, opts: { recursive: boolean }) => fs.mkdir(p, opts), writeFile: (p: string, c: string) => fs.writeFile(p, c) };
  await fsOps.mkdir(path.dirname(baselinePath), { recursive: true });
  await fsOps.writeFile(baselinePath, JSON.stringify(report, null, 2));
}

// ── Score computation (re-export from qa-scorer) ────────────────────────────

export function computeQAScore(issues: QAIssue[]): number {
  return computeQAScoreFromIssues(issues);
}

// ── Regression detection ────────────────────────────────────────────────────

export function findRegressions(baseline: QAReport, current: QAReport): QAIssue[] {
  const baselineIds = new Set(baseline.issues.map(i => `${i.category}:${i.description}`));
  return current.issues.filter(i => !baselineIds.has(`${i.category}:${i.description}`));
}

// ── Binary requirement check ────────────────────────────────────────────────

export async function requireBrowseBinary(): Promise<string> {
  const binaryPath = await detectBrowseBinary();
  if (!binaryPath) {
    const instructions = getBrowseInstallInstructions(process.platform);
    throw new Error(instructions);
  }
  return binaryPath;
}
