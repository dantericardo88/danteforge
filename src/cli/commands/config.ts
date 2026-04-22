// Config command – manage API keys and LLM provider settings
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  loadConfig,
  resolveConfigPaths,
  setApiKey,
  deleteApiKey,
  setDefaultProvider,
  setProviderModel,
  getDefaultModel,
  type LLMProvider,
} from '../../core/config.js';

const VALID_PROVIDERS = new Set(['grok', 'claude', 'openai', 'gemini', 'ollama']);

function isValidProvider(p: string): p is LLMProvider {
  return VALID_PROVIDERS.has(p);
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

export async function configCmd(options: {
  setKey?: string;
  deleteKey?: string;
  provider?: string;
  model?: string;
  show?: boolean;
  _loadConfig?: typeof loadConfig;
  _setApiKey?: typeof setApiKey;
}) {
  const loadConfigFn = options._loadConfig ?? loadConfig;
  const setKeyFn = options._setApiKey ?? setApiKey;

  return withErrorBoundary('config', async () => {
  // Show current config
  if (options.show || (!options.setKey && !options.deleteKey && !options.provider && !options.model)) {
    const config = await loadConfigFn();
    const paths = resolveConfigPaths();
    logger.success('=== DanteForge Configuration ===');
    logger.info(`Config file: ${paths.configFile}`);
    logger.info('Config scope: shared across Codex, Claude Code, Gemini/Antigravity, OpenCode, Cursor, and direct CLI use.');
    logger.info('Native assistant slash commands use the host model/session. Direct DanteForge CLI uses this shared config.');
    logger.info(`Default provider: ${config.defaultProvider}`);
    logger.info(`Ollama model: ${config.ollamaModel}`);
    logger.info('');
    logger.info('Configured providers:');

    const allProviders: LLMProvider[] = ['grok', 'claude', 'openai', 'gemini', 'ollama'];
    for (const p of allProviders) {
      const pc = config.providers[p];
      const hasKey = pc?.apiKey ? maskKey(pc.apiKey) : (p === 'ollama' ? '(local, no key needed)' : 'not set');
      const model = pc?.model ?? getDefaultModel(p);
      const isDefault = p === config.defaultProvider ? ' [DEFAULT]' : '';
      logger.info(`  ${p}${isDefault}: key=${hasKey}, model=${model}`);
    }

    logger.info('');
    logger.info('Commands:');
    logger.info('  danteforge setup ollama --pull');
    logger.info('  danteforge setup assistants --pull');
    logger.info('  danteforge config --set-key "grok:<your-api-key>"');
    logger.info('  danteforge config --delete-key grok');
    logger.info('  danteforge config --provider claude');
    logger.info('  danteforge config --model grok:grok-3');
    return;
  }

  // Set API key: --set-key "provider:key"
  if (options.setKey) {
    const colonIdx = options.setKey.indexOf(':');
    if (colonIdx === -1) {
      logger.error('Format: --set-key "provider:your-api-key" (e.g., --set-key "grok:xai-abc123")');
      return;
    }
    const provider = options.setKey.slice(0, colonIdx);
    const key = options.setKey.slice(colonIdx + 1);

    if (!isValidProvider(provider)) {
      logger.error(`Unknown provider: ${provider}. Valid: ${[...VALID_PROVIDERS].join(', ')}`);
      return;
    }
    if (!key.trim()) {
      logger.error('API key cannot be empty');
      return;
    }

    await setKeyFn(provider, key.trim());
    logger.success(`Key saved for ${provider} (${maskKey(key.trim())})`);
    return;
  }

  // Delete API key
  if (options.deleteKey) {
    if (!isValidProvider(options.deleteKey)) {
      logger.error(`Unknown provider: ${options.deleteKey}. Valid: ${[...VALID_PROVIDERS].join(', ')}`);
      return;
    }
    await deleteApiKey(options.deleteKey);
    return;
  }

  // Set default provider
  if (options.provider) {
    if (!isValidProvider(options.provider)) {
      logger.error(`Unknown provider: ${options.provider}. Valid: ${[...VALID_PROVIDERS].join(', ')}`);
      return;
    }
    await setDefaultProvider(options.provider);
    return;
  }

  // Set model: --model "provider:model-name"
  if (options.model) {
    const colonIdx = options.model.indexOf(':');
    if (colonIdx === -1) {
      logger.error('Format: --model "provider:model-name" (e.g., --model "grok:grok-3")');
      return;
    }
    const provider = options.model.slice(0, colonIdx);
    const model = options.model.slice(colonIdx + 1);

    if (!isValidProvider(provider)) {
      logger.error(`Unknown provider: ${provider}. Valid: ${[...VALID_PROVIDERS].join(', ')}`);
      return;
    }
    await setProviderModel(provider, model);
    return;
  }
  });
}
