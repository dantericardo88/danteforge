// src/scoring/dimensions.ts — 28-dimension registry (dimension-agnostic, extendable)

import type { DimensionDefinition } from './types.js';

export const DIMENSIONS_28: DimensionDefinition[] = [
  {
    id: 'ghost_text_fim',
    name: 'Ghost text / inline completions',
    category: 'Core Completion',
    maxScore: 10,
    description: 'Fill-in-middle completions with low latency and multi-line support',
    requiredEvidenceTypes: ['code', 'benchmark'],
  },
  {
    id: 'chat_ux',
    name: 'Chat interface UX',
    category: 'Core Completion',
    maxScore: 10,
    description: 'Conversational coding interface quality and responsiveness',
    requiredEvidenceTypes: ['code', 'manual_verification'],
  },
  {
    id: 'semantic_search',
    name: 'Semantic codebase search',
    category: 'Context & Search',
    maxScore: 10,
    description: 'Semantic vector or LLM-based codebase search',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'repo_context',
    name: 'Repository context management',
    category: 'Context & Search',
    maxScore: 10,
    description: 'Intelligent context window management for large repos',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'agentic_edit',
    name: 'Agentic code editing',
    category: 'Agentic Capabilities',
    maxScore: 10,
    description: 'Multi-step autonomous code editing with plan-execute loop',
    requiredEvidenceTypes: ['code', 'test', 'manual_verification'],
  },
  {
    id: 'multi_file_edit',
    name: 'Multi-file editing',
    category: 'Agentic Capabilities',
    maxScore: 10,
    description: 'Coordinated edits across multiple files in one operation',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'terminal_integration',
    name: 'Terminal / shell integration',
    category: 'Agentic Capabilities',
    maxScore: 10,
    description: 'Shell command execution and terminal interaction',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'test_generation',
    name: 'Test generation',
    category: 'Quality Automation',
    maxScore: 10,
    description: 'Automated test case generation from code or spec',
    requiredEvidenceTypes: ['code', 'test', 'manual_verification'],
  },
  {
    id: 'error_diagnosis',
    name: 'Error diagnosis & auto-repair',
    category: 'Quality Automation',
    maxScore: 10,
    description: 'Automatic error detection and fix suggestion or application',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'code_review',
    name: 'Code review assistance',
    category: 'Quality Automation',
    maxScore: 10,
    description: 'Automated code review with actionable feedback',
    requiredEvidenceTypes: ['code', 'manual_verification'],
  },
  {
    id: 'refactoring',
    name: 'Refactoring tools',
    category: 'Quality Automation',
    maxScore: 10,
    description: 'Structured refactoring with safety and test coverage',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'spec_planning',
    name: 'Spec / planning pipeline',
    category: 'Planning & Intelligence',
    maxScore: 10,
    description: 'Structured spec generation and task decomposition',
    requiredEvidenceTypes: ['code', 'test', 'doc'],
  },
  {
    id: 'autonomy',
    name: 'Autonomous improvement loop',
    category: 'Planning & Intelligence',
    maxScore: 10,
    description: 'Self-directed quality improvement without human intervention',
    requiredEvidenceTypes: ['code', 'test', 'benchmark'],
    hardCeiling: 8,
  },
  {
    id: 'multi_agent',
    name: 'Multi-agent orchestration',
    category: 'Planning & Intelligence',
    maxScore: 10,
    description: 'Parallel agent coordination with role separation',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'oss_harvesting',
    name: 'OSS pattern harvesting',
    category: 'Planning & Intelligence',
    maxScore: 10,
    description: 'Automated discovery and adoption of OSS patterns',
    requiredEvidenceTypes: ['code', 'test', 'external_source'],
  },
  {
    id: 'llm_routing',
    name: 'LLM routing & cost management',
    category: 'Infrastructure',
    maxScore: 10,
    description: 'Dynamic provider routing with cost controls and fallbacks',
    requiredEvidenceTypes: ['code', 'test', 'benchmark'],
  },
  {
    id: 'ide_integration',
    name: 'IDE integration depth',
    category: 'Infrastructure',
    maxScore: 10,
    description: 'Native IDE plugin quality and command coverage',
    requiredEvidenceTypes: ['code', 'manual_verification'],
  },
  {
    id: 'streaming_quality',
    name: 'Streaming output quality',
    category: 'Infrastructure',
    maxScore: 10,
    description: 'Real-time streaming with cancellation and backpressure',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'context_window_mgmt',
    name: 'Context window management',
    category: 'Infrastructure',
    maxScore: 10,
    description: 'Token estimation, chunking, and compaction strategies',
    requiredEvidenceTypes: ['code', 'test', 'benchmark'],
  },
  {
    id: 'mcp_plugin',
    name: 'MCP / plugin ecosystem',
    category: 'Ecosystem',
    maxScore: 10,
    description: 'Model Context Protocol server with registered tools',
    requiredEvidenceTypes: ['code', 'test', 'doc'],
  },
  {
    id: 'doc_generation',
    name: 'Documentation generation',
    category: 'Ecosystem',
    maxScore: 10,
    description: 'Automated doc generation from code and specs',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'security',
    name: 'Security awareness',
    category: 'Reliability',
    maxScore: 10,
    description: 'Input sanitization, injection prevention, rate limiting, safe eval',
    requiredEvidenceTypes: ['code', 'test', 'manual_verification'],
    hardCeiling: 9,
  },
  {
    id: 'self_improvement',
    name: 'Self-improvement / lessons',
    category: 'Reliability',
    maxScore: 10,
    description: 'Correction capture, lessons persistence, and feedback loops',
    requiredEvidenceTypes: ['code', 'test'],
  },
  {
    id: 'onboarding',
    name: 'Onboarding experience',
    category: 'Ecosystem',
    maxScore: 10,
    description: 'Time-to-value for a new user in the first 5 minutes',
    requiredEvidenceTypes: ['doc', 'manual_verification'],
  },
  {
    id: 'configuration',
    name: 'Configuration simplicity',
    category: 'Ecosystem',
    maxScore: 10,
    description: 'Zero-config defaults with progressive disclosure of power features',
    requiredEvidenceTypes: ['code', 'doc', 'manual_verification'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise features',
    category: 'Reliability',
    maxScore: 10,
    description: 'Audit logging, RBAC, SSO, compliance controls',
    requiredEvidenceTypes: ['code', 'doc', 'external_source'],
    hardCeiling: 7,
  },
  {
    id: 'performance',
    name: 'Performance (latency / throughput)',
    category: 'Reliability',
    maxScore: 10,
    description: 'Measured latency and throughput under realistic workloads',
    requiredEvidenceTypes: ['benchmark', 'test'],
  },
  {
    id: 'reliability',
    name: 'Reliability (error recovery)',
    category: 'Reliability',
    maxScore: 10,
    description: 'Circuit breakers, retry logic, graceful degradation',
    requiredEvidenceTypes: ['code', 'test'],
  },
];

export function getDimension(id: string): DimensionDefinition | undefined {
  return DIMENSIONS_28.find((d) => d.id === id);
}

export function getDimensionsByCategory(): Map<string, DimensionDefinition[]> {
  const map = new Map<string, DimensionDefinition[]>();
  for (const dim of DIMENSIONS_28) {
    const list = map.get(dim.category) ?? [];
    list.push(dim);
    map.set(dim.category, list);
  }
  return map;
}

export function getCategories(): string[] {
  return [...new Set(DIMENSIONS_28.map((d) => d.category))];
}
