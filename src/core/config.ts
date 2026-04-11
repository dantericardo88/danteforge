// Secure config management: API keys stored in a user-level .danteforge/config.yaml
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';

const CONFIG_DIRNAME = '.danteforge';
const CONFIG_FILENAME = 'config.yaml';

// Built-in providers with hardcoded dispatch logic
export type BuiltinLLMProvider = 'grok' | 'claude' | 'openai' | 'gemini' | 'ollama';
// Additional providers dispatched via the llm-provider registry
export type ExtendedLLMProvider = BuiltinLLMProvider | 'together' | 'groq' | 'mistral';
// Accept any string for forward-compatibility with user-registered providers
export type LLMProvider = ExtendedLLMProvider | string;

export interface DanteConfig {
  defaultProvider: LLMProvider;
  ollamaModel: string;
  providers: Partial<Record<string, { apiKey?: string; model?: string; baseUrl?: string }>>;
  figma?: {
    defaultFileUrl?: string;
    designTokensPath?: string;
    mcpServerName?: string;
  };
}

export interface ConfigPathOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ConfigPaths {
  configDir: string;
  configFile: string;
  legacyProjectConfigFile: string;
}

const DEFAULT_CONFIG: DanteConfig = {
  defaultProvider: 'ollama',
  ollamaModel: 'llama3',
  providers: {},
};

// Default models per built-in provider
const DEFAULT_MODELS: Record<string, string> = {
  grok: 'grok-3-mini',
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
  // Extended providers
  together: 'meta-llama/Llama-3-70b-chat-hf',
  groq: 'mixtral-8x7b-32768',
  mistral: 'mistral-large-latest',
};

// Default base URLs per provider
const DEFAULT_BASE_URLS: Record<string, string> = {
  grok: 'https://api.x.ai/v1',
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://127.0.0.1:11434',
  // Extended providers
  together: 'https://api.together.xyz/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
};

export function getDefaultModel(provider: LLMProvider): string {
  return DEFAULT_MODELS[provider] ?? 'gpt-4o';
}

export function getDefaultBaseUrl(provider: LLMProvider): string | undefined {
  return DEFAULT_BASE_URLS[provider];
}

function mergeWithDefaults(parsed?: Partial<DanteConfig> | null): DanteConfig {
  // Deep merge providers to preserve existing keys when config is partial
  const mergedProviders: DanteConfig['providers'] = { ...DEFAULT_CONFIG.providers };
  if (parsed?.providers) {
    for (const [key, value] of Object.entries(parsed.providers)) {
      mergedProviders[key as LLMProvider] = { ...mergedProviders[key as LLMProvider], ...value };
    }
  }
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    providers: mergedProviders,
  };
}

export function resolveConfigPaths(options: ConfigPathOptions = {}): ConfigPaths {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? env.DANTEFORGE_HOME ?? env.HOME ?? env.USERPROFILE ?? os.homedir();
  const configDir = path.join(homeDir, CONFIG_DIRNAME);

  return {
    configDir,
    configFile: path.join(configDir, CONFIG_FILENAME),
    legacyProjectConfigFile: path.join(cwd, CONFIG_DIRNAME, CONFIG_FILENAME),
  };
}

async function readConfigFile(filePath: string): Promise<DanteConfig> {
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.parse(content) as Partial<DanteConfig>;
  return mergeWithDefaults(parsed);
}

export async function loadConfig(options: ConfigPathOptions = {}): Promise<DanteConfig> {
  const paths = resolveConfigPaths(options);

  try {
    return await readConfigFile(paths.configFile);
  } catch {
    try {
      const legacyConfig = await readConfigFile(paths.legacyProjectConfigFile);
      await saveConfig(legacyConfig, options);
      logger.warn(`Migrated config from ${paths.legacyProjectConfigFile} to ${paths.configFile}`);
      return legacyConfig;
    } catch {
      return mergeWithDefaults();
    }
  }
}

export async function saveConfig(config: DanteConfig, options: ConfigPathOptions = {}): Promise<void> {
  const paths = resolveConfigPaths(options);
  await fs.mkdir(paths.configDir, { recursive: true });
  await fs.writeFile(paths.configFile, yaml.stringify(config), { mode: 0o600 });

  if (process.platform !== 'win32') {
    try {
      await fs.chmod(paths.configFile, 0o600);
    } catch {
      // Ignore chmod failures on filesystems without POSIX mode support.
    }
  }
}

export async function setApiKey(provider: LLMProvider, apiKey: string): Promise<void> {
  const config = await loadConfig();
  if (!config.providers[provider]) {
    config.providers[provider] = {};
  }
  config.providers[provider]!.apiKey = apiKey;

  // Auto-set as default provider when first key is added
  if (config.defaultProvider === 'ollama' && provider !== 'ollama') {
    config.defaultProvider = provider;
    logger.info(`Default provider set to ${provider}`);
  }

  await saveConfig(config);
  logger.success(`API key saved for ${provider}`);
}

export async function getApiKey(provider: LLMProvider): Promise<string | undefined> {
  const config = await loadConfig();
  return config.providers[provider]?.apiKey;
}

export async function deleteApiKey(provider: LLMProvider): Promise<void> {
  const config = await loadConfig();
  if (config.providers[provider]) {
    delete config.providers[provider]!.apiKey;
  }
  await saveConfig(config);
  logger.success(`API key removed for ${provider}`);
}

export async function setDefaultProvider(provider: LLMProvider): Promise<void> {
  const config = await loadConfig();
  config.defaultProvider = provider;
  await saveConfig(config);
  logger.success(`Default provider set to ${provider}`);
}

export async function setProviderModel(provider: LLMProvider, model: string): Promise<void> {
  const config = await loadConfig();
  if (!config.providers[provider]) {
    config.providers[provider] = {};
  }
  config.providers[provider]!.model = model;
  await saveConfig(config);
  logger.success(`Model for ${provider} set to ${model}`);
}

/**
 * Check if any API key is configured (not counting ollama)
 */
export async function hasApiKey(): Promise<boolean> {
  const config = await loadConfig();
  return Object.entries(config.providers).some(
    ([provider, settings]) => provider !== 'ollama' && settings?.apiKey,
  );
}

/**
 * Get the resolved provider + model + key for the current config
 */
export async function resolveProvider(): Promise<{
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}> {
  const config = await loadConfig();
  const provider = config.defaultProvider;
  const providerConfig = config.providers[provider];

  return {
    provider,
    model: providerConfig?.model ?? DEFAULT_MODELS[provider],
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl ?? DEFAULT_BASE_URLS[provider],
  };
}
