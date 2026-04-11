// Comprehensive error catalog with user-friendly error codes and remediation
export type DanteErrorCode = string;

export type ErrorCategory = 'setup' | 'config' | 'workflow' | 'execution' | 'verification';

export interface CatalogedError {
  code: string; // DF-SETUP-001, DF-CONFIG-001, etc.
  internalCode: DanteErrorCode; // Maps to existing DanteError codes
  category: ErrorCategory;
  title: string;
  message: string;
  remedy: string;
  helpUrl: string; // URL to TROUBLESHOOTING.md anchor
}

/**
 * User-friendly error catalog with remediation steps
 */
export const ERROR_CATALOG: Record<string, CatalogedError> = {
  // === SETUP ERRORS ===
  'DF-SETUP-001': {
    code: 'DF-SETUP-001',
    internalCode: 'LLM_UNAVAILABLE',
    category: 'setup',
    title: 'Ollama Not Installed',
    message: 'Ollama is not installed on this system.',
    remedy: 'Install Ollama from https://ollama.com/download and restart your terminal.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-ollama-connection',
  },
  'DF-SETUP-002': {
    code: 'DF-SETUP-002',
    internalCode: 'LLM_UNAVAILABLE',
    category: 'setup',
    title: 'Ollama Not Running',
    message: 'Ollama server is not running at http://localhost:11434.',
    remedy: 'Start Ollama by running: ollama serve',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-ollama-connection',
  },
  'DF-SETUP-003': {
    code: 'DF-SETUP-003',
    internalCode: 'MODEL_NOT_AVAILABLE',
    category: 'setup',
    title: 'Ollama Model Not Pulled',
    message: 'The configured Ollama model is not available locally.',
    remedy: 'Pull the model by running: ollama pull qwen2.5-coder:32b (or your configured model)',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-ollama-connection',
  },
  'DF-SETUP-004': {
    code: 'DF-SETUP-004',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'setup',
    title: 'Config File Missing',
    message: 'Configuration file not found at ~/.danteforge/config.yaml.',
    remedy: 'Run: danteforge config to create your configuration file interactively.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/USER_QUICKSTART.md#configuration',
  },
  'DF-SETUP-005': {
    code: 'DF-SETUP-005',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'setup',
    title: 'Invalid Config YAML',
    message: 'Configuration file has invalid YAML syntax.',
    remedy: 'Check ~/.danteforge/config.yaml for syntax errors (use spaces, not tabs for indentation).',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-state-management',
  },

  // === CONFIG ERRORS ===
  'DF-CONFIG-001': {
    code: 'DF-CONFIG-001',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'config',
    title: 'API Key Not Configured',
    message: 'API key for the selected LLM provider is missing.',
    remedy: 'Run: danteforge config or set environment variable (e.g., ANTHROPIC_API_KEY).',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-api-keys',
  },
  'DF-CONFIG-002': {
    code: 'DF-CONFIG-002',
    internalCode: 'LLM_AUTH_FAILED',
    category: 'config',
    title: 'Invalid API Key Format',
    message: 'API key format is invalid for the selected provider.',
    remedy: 'Verify API key format: Claude keys start with "sk-ant-", OpenAI with "sk-", Grok with "xai-".',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-api-keys',
  },
  'DF-CONFIG-003': {
    code: 'DF-CONFIG-003',
    internalCode: 'LLM_UNKNOWN_PROVIDER',
    category: 'config',
    title: 'Unknown LLM Provider',
    message: 'The configured LLM provider is not recognized.',
    remedy: 'Use one of: ollama, anthropic, openai, grok, gemini. Check your config.yaml.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-api-keys',
  },
  'DF-CONFIG-004': {
    code: 'DF-CONFIG-004',
    internalCode: 'MODEL_NOT_AVAILABLE',
    category: 'config',
    title: 'Model Not Available',
    message: 'The configured model is not available for the selected provider.',
    remedy: 'Check model name matches provider offerings. For Ollama, run: ollama list',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-api-keys',
  },

  // === WORKFLOW ERRORS ===
  'DF-WORKFLOW-001': {
    code: 'DF-WORKFLOW-001',
    internalCode: 'CONFIG_MISSING_KEY', // Gate errors don't have specific codes yet
    category: 'workflow',
    title: 'Constitution Missing',
    message: 'No project constitution defined. Run "danteforge constitution" first.',
    remedy: 'Create a constitution: danteforge constitution "your project goals" or use --light to skip.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-gate-checks',
  },
  'DF-WORKFLOW-002': {
    code: 'DF-WORKFLOW-002',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'workflow',
    title: 'Spec Missing',
    message: 'No SPEC.md found. Run "danteforge specify" first.',
    remedy: 'Generate a spec: danteforge specify "your feature idea" or use --light to skip.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-gate-checks',
  },
  'DF-WORKFLOW-003': {
    code: 'DF-WORKFLOW-003',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'workflow',
    title: 'Plan Missing',
    message: 'No PLAN.md found. Run "danteforge plan" first.',
    remedy: 'Create a plan: danteforge plan or use a magic preset that includes planning (e.g., /magic).',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-gate-checks',
  },
  'DF-WORKFLOW-004': {
    code: 'DF-WORKFLOW-004',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'workflow',
    title: 'Tests Not Passing',
    message: 'Gate check failed: Tests must pass before proceeding.',
    remedy: 'Run: danteforge verify to see test failures, then fix them. Or use --light to skip verification (not recommended).',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-verification',
  },
  'DF-WORKFLOW-005': {
    code: 'DF-WORKFLOW-005',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'workflow',
    title: 'State File Corrupted',
    message: 'The .danteforge/STATE.yaml file is corrupted or has invalid syntax.',
    remedy: 'Backup and reset: cp .danteforge/STATE.yaml .danteforge/STATE.yaml.backup && danteforge init',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-state-management',
  },

  // === EXECUTION ERRORS ===
  'DF-EXEC-001': {
    code: 'DF-EXEC-001',
    internalCode: 'BUDGET_EXCEEDED',
    category: 'execution',
    title: 'Budget Exceeded',
    message: 'Agent exceeded the configured budget limit.',
    remedy: 'Use a higher-budget preset (e.g., /blaze or /nova) or increase --max-budget flag.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-budget',
  },
  'DF-EXEC-002': {
    code: 'DF-EXEC-002',
    internalCode: 'LLM_TIMEOUT',
    category: 'execution',
    title: 'Request Timeout',
    message: 'LLM provider request timed out.',
    remedy: 'Check your network connection. Use --timeout flag to increase timeout (default: 120s). Or switch to local Ollama.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-network',
  },
  'DF-EXEC-003': {
    code: 'DF-EXEC-003',
    internalCode: 'LLM_RATE_LIMITED',
    category: 'execution',
    title: 'Rate Limited',
    message: 'LLM provider rate limit exceeded (HTTP 429).',
    remedy: 'Switch to Ollama (no rate limits): danteforge config, set defaultProvider: ollama. Or wait and retry.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-network',
  },
  'DF-EXEC-004': {
    code: 'DF-EXEC-004',
    internalCode: 'LLM_EMPTY_RESPONSE',
    category: 'execution',
    title: 'Empty LLM Response',
    message: 'LLM returned an empty response.',
    remedy: 'Retry the command. If it persists, switch providers or check provider status page.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-network',
  },
  'DF-EXEC-005': {
    code: 'DF-EXEC-005',
    internalCode: 'LLM_CIRCUIT_OPEN',
    category: 'execution',
    title: 'Circuit Breaker Open',
    message: 'LLM provider circuit breaker is open due to repeated failures.',
    remedy: 'Wait 5 minutes for circuit to reset, or switch to a different provider (danteforge config).',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-network',
  },

  // === VERIFICATION ERRORS ===
  'DF-VERIFY-001': {
    code: 'DF-VERIFY-001',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'verification',
    title: 'Tests Failing',
    message: 'Verification failed: Some tests are not passing.',
    remedy: 'Run: npm test to see details. Fix failures, then re-run: danteforge verify',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-verification',
  },
  'DF-VERIFY-002': {
    code: 'DF-VERIFY-002',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'verification',
    title: 'Build Errors',
    message: 'Verification failed: Build or typecheck errors detected.',
    remedy: 'Run: npm run typecheck or npm run build to see errors. Fix TypeScript/syntax issues.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-verification',
  },
  'DF-VERIFY-003': {
    code: 'DF-VERIFY-003',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'verification',
    title: 'Lint Errors',
    message: 'Verification failed: ESLint errors detected.',
    remedy: 'Run: npm run lint:fix to auto-fix. Manually fix remaining errors shown by npm run lint.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-verification',
  },
  'DF-VERIFY-004': {
    code: 'DF-VERIFY-004',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'verification',
    title: 'Anti-Stub Violations',
    message: 'Verification failed: Code contains TODO, FIXME, or TBD placeholders (Anti-Stub Doctrine).',
    remedy: 'Remove all TODO/FIXME/TBD comments and implement proper code. Run: npm run check:anti-stub to verify.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-verification',
  },
  'DF-VERIFY-005': {
    code: 'DF-VERIFY-005',
    internalCode: 'CONFIG_MISSING_KEY',
    category: 'verification',
    title: 'Low Test Coverage',
    message: 'Verification failed: Test coverage below required threshold.',
    remedy: 'Add tests to increase coverage. Check .c8rc.json for threshold requirements.',
    helpUrl: 'https://github.com/danteforge/danteforge/blob/main/TROUBLESHOOTING.md#error-verification',
  },
};

/**
 * Look up a cataloged error by code
 */
export function getCatalogedError(code: string): CatalogedError | undefined {
  return ERROR_CATALOG[code];
}

/**
 * Find a cataloged error by internal DanteError code
 */
export function findErrorByInternalCode(
  internalCode: DanteErrorCode,
  context?: { category?: ErrorCategory; message?: string },
): CatalogedError | undefined {
  // Find all errors matching the internal code
  const matches = Object.values(ERROR_CATALOG).filter((e) => e.internalCode === internalCode);

  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  // Multiple matches: narrow by category or message heuristics
  if (context?.category) {
    const categoryMatch = matches.find((e) => e.category === context.category);
    if (categoryMatch) return categoryMatch;
  }

  if (context?.message) {
    const msg = context.message.toLowerCase();
    // Heuristics for common error patterns
    if (msg.includes('ollama') && msg.includes('connection')) return getCatalogedError('DF-SETUP-002');
    if (msg.includes('ollama') && msg.includes('model')) return getCatalogedError('DF-SETUP-003');
    if (msg.includes('constitution')) return getCatalogedError('DF-WORKFLOW-001');
    if (msg.includes('spec')) return getCatalogedError('DF-WORKFLOW-002');
    if (msg.includes('plan')) return getCatalogedError('DF-WORKFLOW-003');
    if (msg.includes('test')) return getCatalogedError('DF-VERIFY-001');
    if (msg.includes('build') || msg.includes('typecheck')) return getCatalogedError('DF-VERIFY-002');
  }

  // Default: return first match
  return matches[0];
}

/**
 * Format a cataloged error for display
 */
export function formatCatalogedError(cataloged: CatalogedError): string {
  return [
    `❌ Error ${cataloged.code}: ${cataloged.title}`,
    ``,
    `${cataloged.message}`,
    ``,
    `💡 How to fix:`,
    `   ${cataloged.remedy}`,
    ``,
    `📖 More help: ${cataloged.helpUrl}`,
  ].join('\n');
}
