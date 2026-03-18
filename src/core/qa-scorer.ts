// QA Scorer — converts browse outputs to health score + ranked issues.
// Pure computation, no side effects.
import type { QAIssue } from './qa-runner.js';

// ── Scoring weights ─────────────────────────────────────────────────────────

const SEVERITY_WEIGHTS: Record<QAIssue['severity'], number> = {
  critical: 25,
  high: 10,
  medium: 3,
  informational: 0,
};

// ── Accessibility scoring ───────────────────────────────────────────────────

export function scoreAccessibility(accessibilityOutput: string): QAIssue[] {
  const issues: QAIssue[] = [];
  const lines = accessibilityOutput.split('\n');

  // Common accessibility patterns to detect
  const patterns = [
    { regex: /missing alt/i, category: 'accessibility', severity: 'high' as const, description: 'Image missing alt text', remediation: 'Add descriptive alt attributes to all <img> elements' },
    { regex: /empty link/i, category: 'accessibility', severity: 'medium' as const, description: 'Empty link found', remediation: 'Add visible text or aria-label to links' },
    { regex: /missing label/i, category: 'accessibility', severity: 'high' as const, description: 'Form input missing label', remediation: 'Add <label> elements or aria-label to form inputs' },
    { regex: /low contrast/i, category: 'accessibility', severity: 'medium' as const, description: 'Low color contrast ratio', remediation: 'Increase contrast ratio to at least 4.5:1 for normal text' },
    { regex: /missing heading/i, category: 'accessibility', severity: 'medium' as const, description: 'Missing heading structure', remediation: 'Add proper heading hierarchy (h1, h2, h3)' },
    { regex: /missing lang/i, category: 'accessibility', severity: 'high' as const, description: 'Missing lang attribute on <html>', remediation: 'Add lang attribute to the <html> element' },
    { regex: /tabindex/i, category: 'accessibility', severity: 'informational' as const, description: 'Non-standard tabindex detected', remediation: 'Review tabindex values — avoid positive tabindex values' },
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        issues.push({
          id: `a11y-${issues.length + 1}`,
          severity: pattern.severity,
          category: pattern.category,
          description: pattern.description,
          element: line.trim(),
          remediation: pattern.remediation,
        });
      }
    }
  }

  return issues;
}

// ── Console error scoring ───────────────────────────────────────────────────

export function scoreConsoleErrors(consoleOutput: string): QAIssue[] {
  const issues: QAIssue[] = [];
  const lines = consoleOutput.split('\n').filter(l => l.trim());

  for (const line of lines) {
    if (/error/i.test(line) && !/warning/i.test(line)) {
      issues.push({
        id: `console-${issues.length + 1}`,
        severity: /uncaught|unhandled|fatal|crash/i.test(line) ? 'critical' : 'high',
        category: 'console',
        description: `Console error: ${line.trim().substring(0, 200)}`,
        remediation: 'Fix the JavaScript error shown in the browser console',
      });
    } else if (/warning/i.test(line)) {
      issues.push({
        id: `console-${issues.length + 1}`,
        severity: 'informational',
        category: 'console',
        description: `Console warning: ${line.trim().substring(0, 200)}`,
        remediation: 'Review and resolve browser console warnings',
      });
    }
  }

  return issues;
}

// ── Network failure scoring ─────────────────────────────────────────────────

export function scoreNetworkFailures(networkOutput: string): QAIssue[] {
  const issues: QAIssue[] = [];
  const lines = networkOutput.split('\n').filter(l => l.trim());

  for (const line of lines) {
    // Detect HTTP error status codes
    const statusMatch = line.match(/\b(4\d{2}|5\d{2})\b/);
    if (statusMatch) {
      const code = parseInt(statusMatch[1], 10);
      const severity = code >= 500 ? 'critical' as const : 'high' as const;
      issues.push({
        id: `net-${issues.length + 1}`,
        severity,
        category: 'network',
        description: `HTTP ${code} response: ${line.trim().substring(0, 200)}`,
        remediation: code >= 500
          ? 'Fix server error — check application logs for stack traces'
          : 'Fix client error — check request URL, authentication, and parameters',
      });
    }

    // Detect failed fetch / connection refused
    if (/failed|refused|timeout|ERR_/i.test(line) && !statusMatch) {
      issues.push({
        id: `net-${issues.length + 1}`,
        severity: 'high',
        category: 'network',
        description: `Network failure: ${line.trim().substring(0, 200)}`,
        remediation: 'Check that the target service is running and accessible',
      });
    }
  }

  return issues;
}

// ── Performance scoring ─────────────────────────────────────────────────────

export function scorePerformance(perfOutput: string): QAIssue[] {
  const issues: QAIssue[] = [];

  // Parse performance metrics from perf output
  const lcpMatch = perfOutput.match(/LCP[:\s]*(\d+(?:\.\d+)?)/i);
  const clsMatch = perfOutput.match(/CLS[:\s]*(\d+(?:\.\d+)?)/i);
  const fidMatch = perfOutput.match(/FID[:\s]*(\d+(?:\.\d+)?)/i);
  const loadMatch = perfOutput.match(/load[:\s]*(\d+(?:\.\d+)?)\s*(?:ms|s)/i);

  if (lcpMatch) {
    const lcp = parseFloat(lcpMatch[1]);
    if (lcp > 4000) {
      issues.push({
        id: 'perf-lcp',
        severity: 'high',
        category: 'performance',
        description: `Largest Contentful Paint is ${lcp}ms (target: < 2500ms)`,
        remediation: 'Optimize largest contentful paint — check image sizes, server response time, and render-blocking resources',
      });
    } else if (lcp > 2500) {
      issues.push({
        id: 'perf-lcp',
        severity: 'medium',
        category: 'performance',
        description: `Largest Contentful Paint is ${lcp}ms (target: < 2500ms)`,
        remediation: 'Improve largest contentful paint — consider lazy loading, image optimization, or preloading',
      });
    }
  }

  if (clsMatch) {
    const cls = parseFloat(clsMatch[1]);
    if (cls > 0.25) {
      issues.push({
        id: 'perf-cls',
        severity: 'high',
        category: 'performance',
        description: `Cumulative Layout Shift is ${cls} (target: < 0.1)`,
        remediation: 'Fix layout shifts — add explicit width/height to images and embeds, avoid inserting content above existing content',
      });
    } else if (cls > 0.1) {
      issues.push({
        id: 'perf-cls',
        severity: 'medium',
        category: 'performance',
        description: `Cumulative Layout Shift is ${cls} (target: < 0.1)`,
        remediation: 'Reduce layout shifts — review dynamic content insertion and font loading',
      });
    }
  }

  if (fidMatch) {
    const fid = parseFloat(fidMatch[1]);
    if (fid > 300) {
      issues.push({
        id: 'perf-fid',
        severity: 'high',
        category: 'performance',
        description: `First Input Delay is ${fid}ms (target: < 100ms)`,
        remediation: 'Reduce main thread blocking — break up long tasks, defer non-critical JavaScript',
      });
    }
  }

  if (loadMatch) {
    const load = parseFloat(loadMatch[1]);
    const loadMs = loadMatch[0].includes('s') && !loadMatch[0].includes('ms') ? load * 1000 : load;
    if (loadMs > 10000) {
      issues.push({
        id: 'perf-load',
        severity: 'high',
        category: 'performance',
        description: `Page load time is ${loadMs}ms (target: < 3000ms)`,
        remediation: 'Investigate slow page load — check server response time, bundle size, and third-party scripts',
      });
    }
  }

  return issues;
}

// ── Issue ranking ───────────────────────────────────────────────────────────

export function rankIssues(issues: QAIssue[]): QAIssue[] {
  const severityOrder: Record<QAIssue['severity'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    informational: 3,
  };

  return [...issues].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

// ── Compute aggregate score ─────────────────────────────────────────────────

export function computeQAScoreFromIssues(issues: QAIssue[]): number {
  let deductions = 0;
  for (const issue of issues) {
    deductions += SEVERITY_WEIGHTS[issue.severity];
  }
  return Math.max(0, 100 - deductions);
}
