import fs from 'fs/promises';
import path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadState, saveState } from './state.js';

type ToolResult = CallToolResult;

function resolveCwd(args: Record<string, unknown>): string {
  return typeof args._cwd === 'string' ? args._cwd : process.cwd();
}

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

async function auditLog(entry: string, cwd?: string): Promise<void> {
  try {
    const state = await loadState({ cwd });
    state.auditLog.push(`${new Date().toISOString()} | mcp: ${entry}`);
    await saveState(state, { cwd });
  } catch { /* best-effort */ }
}

export async function handleAdoptionQueue(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const queuePath = path.join(cwd, '.danteforge', 'ADOPTION_QUEUE.md');
    const content = await fs.readFile(queuePath, 'utf8');
    return jsonResult({ content, path: queuePath });
  } catch {
    return jsonResult({ content: '# Adoption Queue\n\n_(empty â€” run oss-intel to populate)_', path: null });
  }
}

export async function handleQualityCertificate(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const certPath = path.join(cwd, '.danteforge', 'QUALITY_CERTIFICATE.json');
    const content = await fs.readFile(certPath, 'utf8');
    return jsonResult(JSON.parse(content) as unknown);
  } catch {
    return jsonResult({ error: 'No quality certificate found. Run danteforge certify to generate one.' });
  }
}

export async function handlePatternCoverage(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const coveragePath = path.join(cwd, '.danteforge', 'PATTERN_COVERAGE.md');
    const content = await fs.readFile(coveragePath, 'utf8');
    return jsonResult({ content, path: coveragePath });
  } catch {
    return jsonResult({ content: '# Pattern Coverage\n\n_(not yet generated â€” run danteforge spec-match to compute)_', path: null });
  }
}

export async function handleHarvestNextPattern(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  // Safety gate: dryRun=true by default â€” this tool writes files and must not auto-execute
  const dryRun = args['dryRun'] !== false; // default true unless explicitly set to false

  try {
    const queuePath = path.join(cwd, '.danteforge', 'ADOPTION_QUEUE.md');
    const content = await fs.readFile(queuePath, 'utf8');

    // Extract first pattern name from queue
    const firstPatternMatch = content.match(/^##\s+(.+)$/m);
    const patternName = firstPatternMatch?.[1] ?? 'unknown';

    if (dryRun) {
      return jsonResult({
        dryRun: true,
        nextPattern: patternName,
        message: `Would adopt "${patternName}". Set dryRun=false to execute (requires human approval policy).`,
        policy: 'confirm',
        warning: 'This tool writes files and may run tests. Human approval required.',
      });
    }

    // Non-dry-run: return authorization required message
    // Full adoption requires safe-self-edit approval flow â€” not auto-executed via MCP
    return jsonResult({
      requiresApproval: true,
      nextPattern: patternName,
      message: `Adopting "${patternName}" requires human approval. Use the CLI: danteforge oss-intel --adopt ${patternName}`,
      policy: 'confirm',
    });
  } catch {
    return jsonResult({ error: 'No adoption queue found. Run oss-intel first.' });
  }
}

export async function handleExplainScore(args: Record<string, unknown>): Promise<ToolResult> {
  const dimension = String(args['dimension'] ?? '');
  if (!dimension) return errorResult('Missing required parameter: dimension');

  const cwd = resolveCwd(args);
  const score = typeof args['score'] === 'number' ? args['score'] : null;

  // Load score from state if not provided
  let resolvedScore = score;
  if (resolvedScore === null) {
    try {
      const stateDir = path.join(cwd, '.danteforge');
      const competitorPath = path.join(stateDir, 'COMPETITOR_MATRIX.md');
      const maturityPath = path.join(stateDir, 'MATURITY_REPORT.md');
      for (const p of [maturityPath, competitorPath]) {
        try {
          const content = await fs.readFile(p, 'utf8');
          const match = content.match(new RegExp(`${dimension}[^\\d]*(\\d+\\.?\\d*)\\/10`));
          if (match) { resolvedScore = parseFloat(match[1]); break; }
        } catch { /* keep looking */ }
      }
    } catch { /* best-effort */ }
  }

  const scoreLabel = resolvedScore !== null ? `${resolvedScore}/10` : 'unknown';

  const DIMENSION_EXPLANATIONS: Record<string, { what: string; why: string; howToImprove: string }> = {
    'circuit-breaker-reliability': {
      what: 'Measures whether external calls (LLM, API, DB) are wrapped in circuit breakers that open on repeated failure and recover gracefully.',
      why: 'Without it, one flaky provider cascades into full system downtime. Circuit breakers contain blast radius.',
      howToImprove: 'Add CLOSED/OPEN/HALF_OPEN state machine per provider; wrap callLLM with circuit-breaker check; add backoff strategy.',
    },
    'test-injection-discipline': {
      what: 'Measures whether tests use injected dependencies (_llmCaller, _isLLMAvailable, _readFile etc.) instead of real I/O.',
      why: 'Real I/O in tests causes 200x+ slowdowns, non-determinism, and CI failures. Injection seams are the antidote.',
      howToImprove: 'Add _fnName? optional params to all functions that call LLM or FS; use them in tests via stub injection.',
    },
  };

  const explanation = DIMENSION_EXPLANATIONS[dimension] ?? {
    what: `"${dimension}" measures this dimension of software maturity in your codebase.`,
    why: 'Higher scores on this dimension indicate production-readiness and reduced operational risk.',
    howToImprove: `Review the ${dimension} section in MATURITY_REPORT.md or run: danteforge assess`,
  };

  return jsonResult({
    dimension,
    score: scoreLabel,
    what: explanation.what,
    why: explanation.why,
    howToImprove: explanation.howToImprove,
    nextAction: resolvedScore !== null && resolvedScore < 7
      ? `Run: danteforge oss-intel --focus ${dimension} to find patterns that improve this score`
      : 'Score looks healthy. Run danteforge assess to see full picture.',
  });
}

export async function handleLeapfrogOpportunities(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const maxOpportunities = typeof args['maxOpportunities'] === 'number' ? args['maxOpportunities'] : 5;

  try {
    const stateDir = path.join(cwd, '.danteforge');

    // Read competitor matrix and harvest queue to find leapfrog gaps
    let competitorContent = '';
    let queueContent = '';
    try { competitorContent = await fs.readFile(path.join(stateDir, 'COMPETITOR_MATRIX.md'), 'utf8'); } catch {}
    try { queueContent = await fs.readFile(path.join(stateDir, 'ADOPTION_QUEUE.md'), 'utf8'); } catch {}

    // Parse dimensions where we score lower than competitors
    const opportunities: Array<{ dimension: string; ourScore: number; competitorScore: number; gap: number; patternAvailable: boolean }> = [];

    // Extract score comparisons from competitor matrix (format: "| dimension | ourScore | competitorScore |")
    const tableRows = competitorContent.matchAll(/\|\s*([^|]+)\s*\|\s*(\d+\.?\d*)\s*\|\s*(\d+\.?\d*)\s*\|/g);
    for (const row of tableRows) {
      const dimension = row[1].trim();
      const ourScore = parseFloat(row[2]);
      const competitorScore = parseFloat(row[3]);
      if (!isNaN(ourScore) && !isNaN(competitorScore) && competitorScore > ourScore + 1) {
        const patternAvailable = queueContent.toLowerCase().includes(dimension.toLowerCase());
        opportunities.push({ dimension, ourScore, competitorScore, gap: competitorScore - ourScore, patternAvailable });
      }
    }

    // Sort by gap size (biggest opportunity first)
    opportunities.sort((a, b) => b.gap - a.gap);
    const top = opportunities.slice(0, maxOpportunities);

    if (top.length === 0) {
      return jsonResult({
        opportunities: [],
        message: 'No leapfrog opportunities found. Run: danteforge universe-scan to populate competitor data.',
        nextAction: 'danteforge universe-scan',
      });
    }

    return jsonResult({
      opportunities: top.map(o => ({
        dimension: o.dimension,
        ourScore: o.ourScore,
        competitorAverage: o.competitorScore,
        gap: Math.round(o.gap * 10) / 10,
        patternAvailable: o.patternAvailable,
        action: o.patternAvailable
          ? `danteforge oss-intel --focus ${o.dimension} (pattern queued)`
          : `danteforge harvest --focus ${o.dimension} (needs discovery)`,
      })),
      totalOpportunities: opportunities.length,
      nextAction: `danteforge oss-intel --focus ${top[0].dimension}`,
    });
  } catch (err) {
    return jsonResult({
      opportunities: [],
      error: err instanceof Error ? err.message : String(err),
      nextAction: 'danteforge universe-scan',
    });
  }
}

export async function handlePatternSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const keyword = typeof args['keyword'] === 'string' ? args['keyword'].toLowerCase() : '';
  const category = typeof args['category'] === 'string' ? args['category'] : undefined;
  const maxComplexity = typeof args['maxComplexity'] === 'string'
    ? (args['maxComplexity'] as 'low' | 'medium' | 'high')
    : undefined;
  const minAvgRoi = typeof args['minAvgRoi'] === 'number' ? args['minAvgRoi'] : 0;
  const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;

  try {
    const { queryLibrary } = await import('./global-pattern-library.js');
    const results = await queryLibrary({ category, maxComplexity, minAvgRoi, limit: limit * 2 });

    // Apply keyword filter client-side
    const filtered = keyword
      ? results.filter(e =>
          e.patternName.toLowerCase().includes(keyword) ||
          e.whyItWorks.toLowerCase().includes(keyword) ||
          e.category.toLowerCase().includes(keyword),
        )
      : results;

    const top = filtered.slice(0, limit);

    if (top.length === 0) {
      return jsonResult({
        patterns: [],
        message: `No patterns found matching "${keyword || '(all)'}". Run danteforge oss-intel to populate the library.`,
        totalInLibrary: results.length,
      });
    }

    return jsonResult({
      patterns: top.map(e => ({
        name: e.patternName,
        category: e.category,
        complexity: e.adoptionComplexity,
        avgRoi: Math.round(e.avgRoi * 100) + '%',
        useCount: e.useCount,
        sourceRepo: e.sourceRepo,
        whyItWorks: e.whyItWorks.slice(0, 200),
        adoptAction: `danteforge oss-intel --adopt "${e.patternName}"`,
      })),
      totalMatched: filtered.length,
      totalInLibrary: results.length,
    });
  } catch (err) {
    return jsonResult({
      patterns: [],
      error: err instanceof Error ? err.message : String(err),
      message: 'Global pattern library unavailable. Run danteforge oss-intel to populate it.',
    });
  }
}

// ---------------------------------------------------------------------------
// COFL handler
// ---------------------------------------------------------------------------

export async function handleCofl(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { cofl } = await import('../cli/commands/cofl.js');
    const hasFlag = (key: string) => args[key] === true;
    const anyFlagSet = ['universe', 'harvest', 'prioritize', 'guards', 'reframe', 'report'].some(hasFlag);
    const options = {
      universe: hasFlag('universe'),
      harvest: hasFlag('harvest'),
      prioritize: hasFlag('prioritize'),
      guards: hasFlag('guards'),
      reframe: hasFlag('reframe'),
      report: hasFlag('report'),
      auto: hasFlag('auto') || !anyFlagSet, // default to auto when no specific phase flag given
    };
    const result = await cofl(options, { _cwd: cwd });
    await auditLog(`cofl: cycle ${result?.cycleNumber ?? '?'}, patterns=${result?.extractedPatterns?.length ?? 0}`, cwd);
    return jsonResult(result ?? { error: 'COFL returned no result â€” check matrix and registry' });
  } catch (err) {
    return errorResult(`COFL failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------

export async function handleDossierBuild(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const competitor = String(args['competitor'] ?? '');
  if (!competitor) return errorResult('Missing required parameter: competitor');
  const sources = Array.isArray(args['sources'])
    ? (args['sources'] as string[])
    : undefined;
  const since = args['since'] ? String(args['since']) : undefined;
  try {
    const { buildDossier } = await import('../dossier/builder.js');
    const dossier = await buildDossier({ cwd, competitor, sources, since });
    return jsonResult({
      competitor: dossier.competitor,
      displayName: dossier.displayName,
      composite: dossier.composite,
      lastBuilt: dossier.lastBuilt,
      dimCount: Object.keys(dossier.dimensions).length,
    });
  } catch (err) {
    return errorResult(`dossier build failed: ${String(err)}`);
  }
}

export async function handleDossierGet(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const competitor = String(args['competitor'] ?? '');
  if (!competitor) return errorResult('Missing required parameter: competitor');
  const dim = args['dim'] !== undefined ? Number(args['dim']) : undefined;
  try {
    const { loadDossier } = await import('../dossier/builder.js');
    const dossier = await loadDossier(cwd, competitor);
    if (!dossier) return errorResult(`No dossier found for "${competitor}"`);
    if (dim !== undefined) {
      const dimDef = dossier.dimensions[String(dim)];
      if (!dimDef) return errorResult(`Dimension ${dim} not found in dossier`);
      return jsonResult(dimDef);
    }
    return jsonResult(dossier);
  } catch (err) {
    return errorResult(`dossier get failed: ${String(err)}`);
  }
}

export async function handleDossierList(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { listDossiers } = await import('../dossier/builder.js');
    const dossiers = await listDossiers(cwd);
    const summary = dossiers
      .sort((a, b) => b.composite - a.composite)
      .map((d) => ({
        competitor: d.competitor,
        displayName: d.displayName,
        composite: d.composite,
        type: d.type,
        lastBuilt: d.lastBuilt,
      }));
    return jsonResult({ count: dossiers.length, dossiers: summary });
  } catch (err) {
    return errorResult(`dossier list failed: ${String(err)}`);
  }
}

export async function handleLandscapeBuild(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { buildLandscape } = await import('../dossier/landscape.js');
    const matrix = await buildLandscape(cwd);
    return jsonResult({
      generatedAt: matrix.generatedAt,
      rubricVersion: matrix.rubricVersion,
      competitorCount: matrix.competitors.length,
      topRankings: matrix.rankings.slice(0, 5),
    });
  } catch (err) {
    return errorResult(`landscape build failed: ${String(err)}`);
  }
}

export async function handleLandscapeDiff(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const {
      diffLandscape,
      isLandscapeStale,
      loadLandscape,
      loadPreviousLandscape,
    } = await import('../dossier/landscape.js');
    const landscape = await loadLandscape(cwd);
    if (!landscape) return jsonResult({ status: 'no_landscape', message: 'Run danteforge landscape to build' });
    const previous = await loadPreviousLandscape(cwd);
    if (!previous) {
      return jsonResult({
        status: 'no_previous_snapshot',
        generatedAt: landscape.generatedAt,
        rubricVersion: landscape.rubricVersion,
        competitorCount: landscape.competitors.length,
        stale: isLandscapeStale(landscape),
      });
    }

    return jsonResult({
      status: 'ok',
      generatedAt: landscape.generatedAt,
      previousGeneratedAt: previous.generatedAt,
      stale: isLandscapeStale(landscape),
      diff: diffLandscape(previous, landscape),
    });
  } catch (err) {
    return errorResult(`landscape diff failed: ${String(err)}`);
  }
}

export async function handleRubricGet(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const dim = args['dim'] !== undefined ? Number(args['dim']) : undefined;
  try {
    const { getRubric, getDimCriteria } = await import('../dossier/rubric.js');
    const rubric = await getRubric(cwd);
    if (dim !== undefined) {
      const dimDef = getDimCriteria(rubric, dim);
      if (!dimDef) return errorResult(`Dimension ${dim} not found in rubric`);
      return jsonResult({ dim, ...dimDef });
    }
    return jsonResult(rubric);
  } catch (err) {
    return errorResult(`rubric get failed: ${String(err)}`);
  }
}

export async function handleScoreCompetitor(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const competitor = String(args['competitor'] ?? '');
  if (!competitor) return errorResult('Missing required parameter: competitor');
  try {
    const { loadDossier } = await import('../dossier/builder.js');
    const dossier = await loadDossier(cwd, competitor);
    if (!dossier) return errorResult(`No dossier found for "${competitor}". Run: danteforge dossier build ${competitor}`);
    const dimSummary: Record<string, number> = {};
    for (const [k, v] of Object.entries(dossier.dimensions)) {
      dimSummary[k] = v.humanOverride ?? v.score;
    }
    return jsonResult({
      competitor: dossier.competitor,
      displayName: dossier.displayName,
      composite: dossier.composite,
      dimensions: dimSummary,
      lastBuilt: dossier.lastBuilt,
    });
  } catch (err) {
    return errorResult(`score competitor failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
