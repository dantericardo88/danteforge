// Peer Presets — project-aware competitor seed selection.
//
// DanteForge's CLI is consumed by multiple sibling projects (DanteForge,
// DanteCode, RealEmpWeb, TitanForge, ...) each of which competes in a
// different category. A single hardcoded "canonical" peer list leaks one
// project's positioning into every other project that uses the CLI — see the
// 2026-05-13 bug where /universe in DanteCode loaded DanteForge's peer list.
//
// This module ships multiple named presets and resolves which one applies
// based on project identity (state.project, package.json#name, or an
// explicit override in .danteforge/peers.json).

import fs from 'fs/promises';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PeerPreset = 'coding-assistant' | 'dev-tool-optimizer' | 'agent-framework';

export interface PresetResolution {
  preset: PeerPreset | null;
  /** Human-readable explanation of how preset was chosen (or why null). */
  reason: string;
  /** Verbatim peer list from .danteforge/peers.json if `{ competitors: [...] }` form was used. */
  literalCompetitors?: string[];
}

interface PeersJsonOverride {
  preset?: string;
  competitors?: string[];
}

interface StateLike {
  project?: string;
  peerPreset?: PeerPreset;
  competitors?: string[];
}

// ── Preset catalog ────────────────────────────────────────────────────────────

/**
 * coding-assistant — AI coding assistants and inner-loop dev agents. Used by
 * any project whose primary category is "tool that helps a developer write
 * code." Includes IDE assistants, CLI agents, autonomous SWE-bench-class
 * agents, code review tools, and multi-agent dev frameworks.
 */
const CODING_ASSISTANT_PEERS: readonly string[] = Object.freeze([
  'Cursor',
  'GitHub Copilot Workspace',
  'Claude Code',
  'Devin (Cognition AI)',
  'Aider',
  'OpenHands (All-Hands AI)',
  'Cline',
  'Continue.dev',
  'Codex CLI (OpenAI)',
  'Gemini CLI (Google)',
  'GitHub Copilot CLI',
  'Goose (Block)',
  'Replit Agent',
  'Kilo Code',
  'SWE-Agent (Princeton)',
  'CodiumAI / Qodo',
  'CodeRabbit',
  'Kiro (AWS)',
  'Zencoder',
  'Qodo 2.0',
]);

/**
 * dev-tool-optimizer — Agentic dev-tool optimizers that sit ON TOP OF AI
 * coding assistants. This is DanteForge's own category. Peers are
 * spec-driven dev kits, skill consolidators, autonomous research loops, and
 * orchestration peers — NOT the assistants themselves (Cursor / Devin /
 * Claude Code etc., which are platforms DanteForge wraps).
 */
const DEV_TOOL_OPTIMIZER_PEERS: readonly string[] = Object.freeze([
  // Spec-driven dev kits
  'spec-kit (GitHub)',
  'BMad-METHOD',
  'OpenSpec',
  // Claude Code / agent skill consolidators
  'anthropics/claude-skills',
  'awesome-claude-code-skills',
  'cursor.directory',
  // Autonomous research / improvement loops
  'Karpathy autoresearch',
  'DSPy (Stanford)',
  // Pattern donors: orchestration peers
  'MetaGPT',
  'CrewAI',
  'AutoGen (Microsoft)',
  'GPT-Engineer',
  'OpenHands (All-Hands AI)',
  'Aider',
  'SWE-Agent (Princeton)',
  'LangChain Agents',
]);

/**
 * agent-framework — Standalone multi-agent orchestration frameworks. For
 * projects whose primary category is "framework for building agents,"
 * distinct from tools that help write code.
 */
const AGENT_FRAMEWORK_PEERS: readonly string[] = Object.freeze([
  'MetaGPT',
  'CrewAI',
  'AutoGen (Microsoft)',
  'GPT-Engineer',
  'LangChain Agents',
  'OpenHands (All-Hands AI)',
  'AutoGPT',
  'BabyAGI',
  'LangGraph',
  'Haystack Agents',
]);

const PEER_PRESETS: Record<PeerPreset, readonly string[]> = Object.freeze({
  'coding-assistant': CODING_ASSISTANT_PEERS,
  'dev-tool-optimizer': DEV_TOOL_OPTIMIZER_PEERS,
  'agent-framework': AGENT_FRAMEWORK_PEERS,
});

// ── Public accessors ──────────────────────────────────────────────────────────

export function getPeerPreset(name: PeerPreset): string[] {
  const preset = PEER_PRESETS[name];
  if (!preset) throw new Error(`Unknown peer preset: ${name}`);
  return [...preset];
}

export function listAvailablePresets(): PeerPreset[] {
  return Object.keys(PEER_PRESETS) as PeerPreset[];
}

export function isPeerPreset(value: unknown): value is PeerPreset {
  return typeof value === 'string' && value in PEER_PRESETS;
}

// ── Project-identity resolver ─────────────────────────────────────────────────

// Keywords that strongly suggest a project is a coding-assistant peer.
// (Subset of competitor-scanner.ts DEV_TOOL_KEYWORDS — these specifically
// identify the coding-assistant category vs the optimizer category.)
const CODING_ASSISTANT_KEYWORDS = [
  'ide', 'editor', 'cline', 'cursor', 'aider', 'copilot',
  'coding assistant', 'code assistant', 'pair programmer',
  'inline completion', 'autocomplete',
];

// Project names that are DanteForge itself (in any package form).
const DANTEFORGE_PROJECT_NAMES = new Set<string>([
  'danteforge', '@danteforge/cli', '@danteforge/core',
]);

// Known sibling projects that use the DanteForge CLI and compete in the
// coding-assistant category (AI coding agents / IDE harnesses, NOT optimizers).
// Add entries as new siblings ship.
const CODING_ASSISTANT_SIBLINGS = new Set<string>([
  'dantecode', '@dantecode/core', '@dantecode/vscode',
]);

// Known sibling projects that compete in the agent-framework category
// (multi-agent orchestration frameworks, NOT IDE assistants or optimizers).
const AGENT_FRAMEWORK_SIBLINGS = new Set<string>([
  'danteagents', '@danteagents/core',
]);

// Keywords that strongly suggest agent-framework category. Conservative — must
// be a multi-word match or specific term so we don't false-positive on the
// loose word "agent" (which appears in everything from "code agent" to
// "user agent" to "AI agent CLI").
const AGENT_FRAMEWORK_KEYWORDS = [
  'multi-agent', 'multi agent', 'agent framework', 'agent orchestrat',
  'autonomous agent', 'agent swarm', 'agent crew', 'crewai',
];

// Generic dev-tool keywords (broader bucket). When matched without a more
// specific sibling registration, defaults to coding-assistant since that's
// the more common sibling-project category. Note: bare "agent" was removed
// here because it's too aggressive — see AGENT_FRAMEWORK_KEYWORDS for the
// more specific multi-word match that routes to agent-framework instead.
const GENERIC_DEV_TOOL_KEYWORDS = [
  'cli', 'coding', 'devtool', 'dev tool',
  'workflow', 'agentic',
  'programming', 'software engineer',
];

async function readPeersJsonOverride(cwd: string): Promise<PeersJsonOverride | null> {
  const peersPath = path.join(cwd, '.danteforge', 'peers.json');
  try {
    const content = await fs.readFile(peersPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as PeersJsonOverride;
    return null;
  } catch {
    return null;
  }
}

async function readPackageName(cwd: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as { name?: unknown };
    return typeof pkg.name === 'string' ? pkg.name : null;
  } catch {
    return null;
  }
}

function presetForName(name: string | null | undefined): PeerPreset | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  // 1. Exact-name sibling registrations (highest specificity)
  if (DANTEFORGE_PROJECT_NAMES.has(lower) || lower.startsWith('@danteforge/')) {
    return 'dev-tool-optimizer';
  }
  if (CODING_ASSISTANT_SIBLINGS.has(lower) || lower.startsWith('@dantecode/')) {
    return 'coding-assistant';
  }
  if (AGENT_FRAMEWORK_SIBLINGS.has(lower) || lower.startsWith('@danteagents/')) {
    return 'agent-framework';
  }
  // 2. Agent-framework specific keywords (multi-word, more selective —
  //    checked before coding-assistant keywords to win the bare "agent" case)
  if (AGENT_FRAMEWORK_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'agent-framework';
  }
  // 3. Coding-assistant specific keywords
  if (CODING_ASSISTANT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'coding-assistant';
  }
  // 4. Generic dev-tool keywords → default to coding-assistant
  if (GENERIC_DEV_TOOL_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'coding-assistant';
  }
  return null;
}

/**
 * Resolve which preset applies to the project at `cwd`, in priority order:
 *   1. .danteforge/peers.json explicit override (preset OR literal list)
 *   2. state.peerPreset field if present
 *   3. package.json#name keyword match
 *   4. state.project keyword match
 *   5. null (caller decides — typically: surface a configuration hint)
 *
 * Never throws. Always returns a `reason` explaining the resolution path.
 */
export async function resolveProjectPreset(
  cwd: string,
  state?: StateLike,
): Promise<PresetResolution> {
  // 1. Explicit override file
  const override = await readPeersJsonOverride(cwd);
  if (override?.competitors && Array.isArray(override.competitors) && override.competitors.length > 0) {
    return {
      preset: null,
      reason: `.danteforge/peers.json provided ${override.competitors.length} literal competitor(s)`,
      literalCompetitors: [...override.competitors],
    };
  }
  if (override?.preset && isPeerPreset(override.preset)) {
    return {
      preset: override.preset,
      reason: `.danteforge/peers.json explicit preset="${override.preset}"`,
    };
  }

  // 2. State field
  if (state?.peerPreset && isPeerPreset(state.peerPreset)) {
    return {
      preset: state.peerPreset,
      reason: `state.peerPreset="${state.peerPreset}"`,
    };
  }

  // 3. package.json name
  const pkgName = await readPackageName(cwd);
  const pkgPreset = presetForName(pkgName);
  if (pkgPreset) {
    return {
      preset: pkgPreset,
      reason: `package.json name="${pkgName}" → ${pkgPreset}`,
    };
  }

  // 4. state.project
  const statePreset = presetForName(state?.project);
  if (statePreset) {
    return {
      preset: statePreset,
      reason: `state.project="${state?.project}" → ${statePreset}`,
    };
  }

  // 5. Unknown
  return {
    preset: null,
    reason: 'unknown project type — set state.peerPreset, create .danteforge/peers.json, or run `danteforge compete --reset --preset <name>`',
  };
}

/**
 * Convenience: resolve the preset and return its competitor list, or null if
 * no preset applies and no literal override is set. Callers that want a
 * non-null fallback should provide one.
 */
export async function resolveProjectCompetitors(
  cwd: string,
  state?: StateLike,
): Promise<{ competitors: string[]; preset: PeerPreset | null; reason: string }> {
  const resolution = await resolveProjectPreset(cwd, state);
  if (resolution.literalCompetitors) {
    return { competitors: resolution.literalCompetitors, preset: null, reason: resolution.reason };
  }
  if (resolution.preset) {
    return { competitors: getPeerPreset(resolution.preset), preset: resolution.preset, reason: resolution.reason };
  }
  return { competitors: [], preset: null, reason: resolution.reason };
}
