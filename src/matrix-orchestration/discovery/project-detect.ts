// project-detect.ts — infer a ProjectIntent from a COLD repo (package.json + README), so a project
// with NO PRD can still bootstrap the competitive matrix. This is the "works on someone else's repo"
// on-ramp: the PRD-reader path (prd-reader.ts) needs an authored PRD; this path needs only the repo.
//
// Honest by construction: `confidence` scales with the signal actually present. A bare repo (no
// package.json, no README) yields a low-confidence intent (<0.6) the caller is expected to reject or
// refine — never a confident guess from nothing.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectIntent, ProjectType, TargetUser, ConstraintEmphasis } from '../types.js';

interface Pkg {
  name?: string; description?: string; keywords?: unknown;
  bin?: unknown; main?: unknown; module?: unknown; exports?: unknown;
  dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

export interface DetectIntentOptions {
  _readFile?: (p: string) => Promise<string>;
  _now?: () => string;
}

export async function detectProjectIntent(cwd: string, opts: DetectIntentOptions = {}): Promise<ProjectIntent> {
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const now = opts._now ?? (() => new Date().toISOString());

  const pkg = await readPkg(readFile, path.join(cwd, 'package.json'));
  const readme = await readReadme(readFile, cwd);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const keywords = Array.isArray(pkg?.keywords) ? (pkg!.keywords as unknown[]).filter((k): k is string => typeof k === 'string') : [];

  const projectName = pkg?.name ? cleanName(pkg.name) : path.basename(path.resolve(cwd)) || 'project';
  const description = (pkg?.description ?? '').trim();
  const projectType = detectType(pkg, deps, keywords);
  const goal = description || firstParagraph(readme) || `Reach the competitive frontier for ${projectName}`;

  return {
    sourcePath: pkg ? path.join(cwd, 'package.json') : cwd,
    projectName,
    goal,
    projectType,
    targetUser: detectTargetUser(keywords, description),
    keyFeatures: deriveFeatures(keywords, readme, description),
    constraintEmphasis: detectConstraints(keywords, description),
    nonGoals: [],
    competitiveCategoryBoundary: { direct: deriveCategories(projectType, keywords), adjacent: [], research: [] },
    frontierFraming: { target: 'oss_frontier', matchLeaderOn: [], exceedLeaderOn: [], defineNewCategoryOn: [] },
    confidence: scoreConfidence(!!pkg, description, keywords, readme),
    extractedAt: now(),
  };
}

// ── Detection heuristics ───────────────────────────────────────────────────────

function detectType(pkg: Pkg | null, deps: Record<string, string>, keywords: string[]): ProjectType {
  const has = (n: string): boolean => n in deps;
  const blob = (keywords.join(' ') + ' ' + (pkg?.description ?? '')).toLowerCase();
  // Order matters: a VS Code extension may also depend on react (webview), a CLI agent may depend on
  // an LLM SDK — the more specific signal wins first.
  if (pkg?.engines?.vscode || has('vscode') || /vs[\s-]?code extension/.test(blob) || keywords.includes('vscode-extension')) return 'ide_extension';
  if (has('react-native') || has('expo')) return 'mobile_app';
  if (has('react') || has('next') || has('vue') || has('svelte') || has('@angular/core')) return 'web_app';
  if (has('express') || has('fastify') || has('koa') || has('@nestjs/core')) return 'saas';
  if (pkg?.bin) return 'cli_tool';
  if ((has('@anthropic-ai/sdk') || has('openai') || has('langchain') || has('@langchain/core')) && /\bagent|\bllm\b|autonomous/.test(blob)) return 'agent_runtime';
  if (pkg && (pkg.main || pkg.module || pkg.exports)) return 'library';
  return 'other';
}

function detectTargetUser(keywords: string[], description: string): TargetUser {
  const blob = (keywords.join(' ') + ' ' + description).toLowerCase();
  if (/enterprise|compliance|soc ?2|saml|sso\b/.test(blob)) return 'enterprise';
  if (/research|academ|scientif/.test(blob)) return 'researcher';
  return 'developer';
}

function detectConstraints(keywords: string[], description: string): ConstraintEmphasis[] {
  const blob = (keywords.join(' ') + ' ' + description).toLowerCase();
  const out: ConstraintEmphasis[] = [];
  if (/secur|auth|encrypt|crypto|vulnerab/.test(blob)) out.push('security_critical');
  if (/performan|fast|low.?latency|speed|throughput|realtime/.test(blob)) out.push('performance_critical');
  if (/\bux\b|design|accessib|onboarding|polish/.test(blob)) out.push('ux_critical');
  if (/integrat|plugin|extensib|\bapi\b|\bsdk\b|mcp\b/.test(blob)) out.push('integration_critical');
  return out;
}

function deriveCategories(projectType: ProjectType, keywords: string[]): string[] {
  const cats = new Set<string>();
  cats.add(projectType.replace(/_/g, ' '));
  for (const k of keywords.slice(0, 7)) { const t = k.toLowerCase().trim(); if (t) cats.add(t); }
  return [...cats].filter(Boolean).slice(0, 8);
}

function deriveFeatures(keywords: string[], readme: string, description: string): string[] {
  const feats: string[] = [];
  for (const line of readme.split('\n')) {
    const bullet = /^\s*[-*]\s+(.{4,80}?)\s*$/.exec(line);
    if (bullet) feats.push(bullet[1]!.trim());
    const heading = /^#{2,3}\s+(.{3,60}?)\s*$/.exec(line);
    if (heading && !/^(install|usage|license|contribut|getting started|table of contents|requirements|setup|quick ?start)/i.test(heading[1]!)) {
      feats.push(heading[1]!.trim());
    }
    if (feats.length >= 14) break;
  }
  if (feats.length < 3) for (const k of keywords) feats.push(k);
  if (feats.length === 0 && description) feats.push(description.slice(0, 80));
  return dedupe(feats.map(f => f.replace(/[`*_#]/g, '').trim()).filter(f => f.length >= 3)).slice(0, 12);
}

function scoreConfidence(hasPkg: boolean, description: string, keywords: string[], readme: string): number {
  let c = 0.35;
  if (hasPkg) c += 0.2;
  if (description) c += 0.2;
  if (keywords.length >= 2) c += 0.15;
  if (readme.length > 200) c += 0.1;
  return Math.min(0.9, Math.round(c * 100) / 100);
}

// ── Small parsers ──────────────────────────────────────────────────────────────

async function readPkg(readFile: (p: string) => Promise<string>, p: string): Promise<Pkg | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(p));
    return parsed && typeof parsed === 'object' ? (parsed as Pkg) : null;
  } catch { return null; }
}

async function readReadme(readFile: (p: string) => Promise<string>, cwd: string): Promise<string> {
  for (const n of ['README.md', 'readme.md', 'README.markdown', 'README', 'Readme.md', 'docs/README.md']) {
    try { return await readFile(path.join(cwd, n)); } catch { /* try next */ }
  }
  return '';
}

function cleanName(n: string): string { return n.replace(/^@[^/]+\//, '').trim(); }

function firstParagraph(md: string): string {
  for (const block of md.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith('#') || t.startsWith('![') || t.startsWith('[!') || t.startsWith('<') || t.startsWith('>')) continue;
    return t.replace(/\s+/g, ' ').slice(0, 200);
  }
  return '';
}

function dedupe(arr: string[]): string[] { return Array.from(new Set(arr)); }
