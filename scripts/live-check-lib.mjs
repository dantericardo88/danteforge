export const VALID_LIVE_PROVIDERS = ['openai', 'claude', 'gemini', 'grok', 'ollama'];
export const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_OLLAMA_LIVE_REQUEST_TIMEOUT_MS = 180_000;

const PROVIDER_CREDENTIAL_REQUIREMENTS = Object.freeze({
  openai: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  grok: ['XAI_API_KEY'],
  ollama: ['OLLAMA_BASE_URL', 'OLLAMA_MODEL'],
});

export function getProviderCredentialRequirements() {
  return Object.fromEntries(
    Object.entries(PROVIDER_CREDENTIAL_REQUIREMENTS).map(([provider, vars]) => [provider, [...vars]]),
  );
}

function parseTimeoutMs(rawValue, fallbackMs) {
  const value = rawValue?.trim();
  if (!value) return fallbackMs;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }

  return parsed;
}

export function resolveLiveRequestTimeoutMs(env = process.env, provider) {
  const baseTimeout = parseTimeoutMs(env.DANTEFORGE_LIVE_TIMEOUT_MS, DEFAULT_LIVE_REQUEST_TIMEOUT_MS);

  if (provider === 'ollama') {
    return parseTimeoutMs(
      env.OLLAMA_TIMEOUT_MS,
      Math.max(baseTimeout, DEFAULT_OLLAMA_LIVE_REQUEST_TIMEOUT_MS),
    );
  }

  return baseTimeout;
}

export function parseLiveProviders(raw) {
  const value = raw?.trim();
  if (!value) {
    throw new Error('Set DANTEFORGE_LIVE_PROVIDERS to a comma-separated list such as "openai,claude,gemini,grok,ollama".');
  }

  const providers = [...new Set(
    value
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean),
  )];

  if (providers.length === 0) {
    throw new Error('DANTEFORGE_LIVE_PROVIDERS did not contain any providers.');
  }

  const unknown = providers.filter(provider => !VALID_LIVE_PROVIDERS.includes(provider));
  if (unknown.length > 0) {
    throw new Error(`Unknown live provider "${unknown[0]}". Valid values: ${VALID_LIVE_PROVIDERS.join(', ')}`);
  }

  return providers;
}

export function validateLiveConfiguration(env = process.env) {
  let providers;
  try {
    providers = parseLiveProviders(env.DANTEFORGE_LIVE_PROVIDERS);
  } catch (error) {
    return {
      providers: [],
      missing: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const missing = [];
  for (const provider of providers) {
    if (provider === 'ollama') {
      if (!env.OLLAMA_MODEL?.trim()) {
        missing.push('OLLAMA_MODEL is required for ollama live verification.');
      }
      continue;
    }

    for (const variable of PROVIDER_CREDENTIAL_REQUIREMENTS[provider] ?? []) {
      if (!env[variable]?.trim()) {
        missing.push(`${variable} is required for ${provider} live verification.`);
      }
    }
  }

  return { providers, missing, error: undefined };
}

export function formatLiveConfigurationError(result) {
  const lines = [
    result.error ?? 'Live integration checks failed because the environment is incomplete.',
    '',
    'Live verification configuration:',
    '- DANTEFORGE_LIVE_PROVIDERS=openai,claude,gemini,grok,ollama',
    '- openai: OPENAI_API_KEY',
    '- claude: ANTHROPIC_API_KEY',
    '- gemini: GEMINI_API_KEY',
    '- grok: XAI_API_KEY',
    '- ollama: OLLAMA_MODEL (required), OLLAMA_BASE_URL (optional, defaults to http://127.0.0.1:11434)',
    '- Optional upstream override: ANTIGRAVITY_BUNDLES_URL',
    '- Optional Figma override: FIGMA_MCP_URL',
    '- Optional timeout override: DANTEFORGE_LIVE_TIMEOUT_MS (all providers), OLLAMA_TIMEOUT_MS (Ollama only)',
  ];

  if (result.missing.length > 0) {
    lines.push('', 'Missing items:');
    for (const missing of result.missing) {
      lines.push(`- ${missing}`);
    }
  }

  return lines.join('\n');
}
