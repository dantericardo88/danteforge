/**
 * Adversary provider resolution chain.
 *
 * Resolves which LLM plays the adversary role in dual-scoring.
 * Chain (first match wins):
 *   1. config.adversary.enabled === false → null (explicit opt-out)
 *   2. config.adversary.provider set      → use it            (mode: 'configured')
 *   3. env DANTEFORGE_ADVERSARY_PROVIDER  → use it            (mode: 'configured')
 *   4. primary != 'ollama' + Ollama probe → use ollama        (mode: 'ollama-auto')
 *   5. fallback                           → use primary LLM   (mode: 'self-challenge')
 */
import { type DanteConfig, type LLMProvider, type AdversaryResolution } from './config.js';

export interface AdversaryResolverOptions {
  /** Injection seam: replaces the real Ollama availability probe (for tests) */
  _probeOllama?: () => Promise<boolean>;
  /** Injection seam: replaces process.env lookup (for tests) */
  _env?: NodeJS.ProcessEnv;
}

/**
 * Resolve which adversary provider to use given the current config.
 * Returns null when adversarial scoring is explicitly disabled.
 * Never throws — all side-effectful probes are wrapped in try/catch.
 */
export async function resolveAdversaryProvider(
  config: DanteConfig,
  opts: AdversaryResolverOptions = {},
): Promise<AdversaryResolution | null> {
  const env = opts._env ?? process.env;

  // 1. Explicit opt-out
  if (config.adversary?.enabled === false) {
    return null;
  }

  // 2. Explicit provider in config
  if (config.adversary?.provider) {
    const provider = config.adversary.provider as LLMProvider;
    return {
      provider,
      model: config.adversary.model,
      apiKey: resolveApiKey(provider, config, env),
      baseUrl: config.adversary.baseUrl,
      mode: 'configured',
    };
  }

  // 3. Environment variable override
  const envProvider = env['DANTEFORGE_ADVERSARY_PROVIDER'];
  if (envProvider) {
    const provider = envProvider as LLMProvider;
    return {
      provider,
      model: undefined,
      apiKey: resolveApiKey(provider, config, env),
      baseUrl: undefined,
      mode: 'configured',
    };
  }

  // 4. Auto-detect Ollama when primary provider is NOT ollama
  if (config.defaultProvider !== 'ollama') {
    const ollamaAvailable = await probeOllama(opts._probeOllama);
    if (ollamaAvailable) {
      return {
        provider: 'ollama',
        model: config.ollamaModel || 'llama3',
        apiKey: undefined,
        baseUrl: undefined,
        mode: 'ollama-auto',
      };
    }
  }

  // 5. Self-challenge fallback — use primary provider with adversarial framing
  const primary = config.defaultProvider as LLMProvider;
  return {
    provider: primary,
    model: config.providers[primary]?.model,
    apiKey: resolveApiKey(primary, config, env),
    baseUrl: config.providers[primary]?.baseUrl,
    mode: 'self-challenge',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveApiKey(
  provider: LLMProvider,
  config: DanteConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  // adversary-specific key takes priority
  if (config.adversary?.apiKey) return config.adversary.apiKey;
  // fall back to provider section in config
  if (config.providers[provider]?.apiKey) return config.providers[provider]!.apiKey;
  // fall back to env vars matching existing convention
  const upperProvider = String(provider).toUpperCase();
  return (
    env[`DANTEFORGE_${upperProvider}_API_KEY`] ??
    env['DANTEFORGE_LLM_API_KEY']
  );
}

async function probeOllama(
  _probeOllama?: () => Promise<boolean>,
): Promise<boolean> {
  if (_probeOllama) {
    return _probeOllama().catch(() => false);
  }
  try {
    const { isLLMAvailable } = await import('./llm.js');
    return await isLLMAvailable();
  } catch {
    return false;
  }
}
