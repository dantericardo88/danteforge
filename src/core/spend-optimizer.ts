import { spawnSync } from 'node:child_process';
import {
  loadConfig,
  saveConfig,
  type ConfigPathOptions,
  type DanteConfig,
  type LLMProvider,
} from './config.js';
import { detectHost, type MCPHost } from './mcp.js';

export const DEFAULT_SPEND_SAVER_OLLAMA_MODEL = 'qwen2.5-coder:7b';

const RECOMMENDED_OLLAMA_MODELS = [
  DEFAULT_SPEND_SAVER_OLLAMA_MODEL,
  'qwen2.5-coder:latest',
  'qwen2.5-coder:14b',
  'qwen2.5-coder:32b',
  'deepseek-coder-v2:16b',
  'codellama:7b',
  'llama3.1:8b',
  'gemma2:9b',
  'llama3',
] as const;

export interface OllamaInspectionResult {
  available: boolean;
  installedModels: string[];
  detail?: string;
}

export interface SpendOptimizationOptions extends ConfigPathOptions {
  hostOverride?: string;
  preferredOllamaModel?: string;
  pullIfMissing?: boolean;
  forceLocalFirst?: boolean;
  loadConfig?: () => Promise<DanteConfig>;
  saveConfig?: (config: DanteConfig) => Promise<void>;
  inspectOllama?: () => Promise<OllamaInspectionResult>;
  pullOllamaModel?: (model: string) => Promise<{ ok: boolean; detail?: string }>;
}

export interface SpendOptimizationResult {
  host: MCPHost;
  hostUsesNativeModel: boolean;
  status: 'configured-local' | 'kept-existing-cloud' | 'ollama-missing';
  selectedProvider: LLMProvider;
  selectedModel: string | null;
  configUpdated: boolean;
  message: string;
  nextSteps: string[];
  ollama: OllamaInspectionResult & {
    recommendedModel: string;
    selectedModel: string | null;
  };
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase();
}

function findModelMatch(models: string[], desired: string): string | null {
  const normalizedDesired = normalizeModelName(desired);
  const exact = models.find(model => normalizeModelName(model) === normalizedDesired);
  if (exact) return exact;

  const desiredBase = normalizedDesired.split(':')[0] ?? normalizedDesired;
  return models.find(model => {
    const normalized = normalizeModelName(model);
    const base = normalized.split(':')[0] ?? normalized;
    return base === desiredBase;
  }) ?? null;
}

function hasExplicitCloudDefault(config: DanteConfig): boolean {
  if (config.defaultProvider === 'ollama') return false;
  const providerConfig = config.providers[config.defaultProvider];
  return Boolean(providerConfig?.apiKey || providerConfig?.model || providerConfig?.baseUrl);
}

export function chooseRecommendedOllamaModel(
  installedModels: string[],
  preferredModel = DEFAULT_SPEND_SAVER_OLLAMA_MODEL,
): string | null {
  if (installedModels.length === 0) return null;

  const preferred = findModelMatch(installedModels, preferredModel);
  if (preferred) return preferred;

  for (const candidate of RECOMMENDED_OLLAMA_MODELS) {
    const match = findModelMatch(installedModels, candidate);
    if (match) return match;
  }

  const coderMatch = installedModels.find(model => normalizeModelName(model).includes('coder'));
  if (coderMatch) return coderMatch;

  return installedModels[0] ?? null;
}

export async function inspectOllama(): Promise<OllamaInspectionResult> {
  const command = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const result = spawnSync(command, ['list'], {
    encoding: 'utf8',
    timeout: 15000,
  });

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (message.includes('enoent')) {
      return {
        available: false,
        installedModels: [],
        detail: 'Ollama binary was not found on PATH.',
      };
    }
  }

  if ((result.status ?? 1) !== 0) {
    return {
      available: false,
      installedModels: [],
      detail: (result.stderr || result.stdout || 'Ollama did not respond to `ollama list`.').trim(),
    };
  }

  const lines = (result.stdout ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const installedModels = lines
    .slice(1)
    .map(line => line.split(/\s+/)[0] ?? '')
    .filter(Boolean);

  return {
    available: true,
    installedModels,
  };
}

export async function pullOllamaModel(model: string): Promise<{ ok: boolean; detail?: string }> {
  const command = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const result = spawnSync(command, ['pull', model], {
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
    stdio: 'inherit',
  });

  return {
    ok: (result.status ?? 1) === 0,
    detail: result.error?.message,
  };
}

export function buildHostModelUsageMessage(host: MCPHost): string {
  if (host === 'unknown') {
    return 'No host editor was detected. DanteForge CLI should prefer local Ollama first to save hosted tokens.';
  }

  return `Native ${host} workflows already use the host model/session. DanteForge CLI and automation are optimized separately to save spend.`;
}

export async function chooseSpendOptimizedProviderForReview(
  probeProvider?: (provider: LLMProvider) => Promise<{ ok: boolean }>,
): Promise<LLMProvider | undefined> {
  const probe = probeProvider
    ?? (async (provider: LLMProvider) => {
      const { probeLLMProvider } = await import('./llm.js');
      return probeLLMProvider(provider);
    });

  try {
    const ollama = await probe('ollama');
    if (ollama.ok) {
      return 'ollama';
    }
  } catch {
    // Fall through to the configured default provider.
  }

  return undefined;
}

export async function configureSpendOptimizedDefaults(
  options: SpendOptimizationOptions = {},
): Promise<SpendOptimizationResult> {
  const host = detectHost(options.hostOverride);
  const hostUsesNativeModel = host !== 'unknown';
  const preferredOllamaModel = options.preferredOllamaModel ?? DEFAULT_SPEND_SAVER_OLLAMA_MODEL;
  const load = options.loadConfig ?? (() => loadConfig(options));
  const save = options.saveConfig ?? ((config: DanteConfig) => saveConfig(config, options));
  const inspect = options.inspectOllama ?? inspectOllama;
  const pull = options.pullOllamaModel ?? pullOllamaModel;

  const config = await load();
  let ollama = await inspect();
  let selectedOllamaModel = chooseRecommendedOllamaModel(ollama.installedModels, preferredOllamaModel);

  if (!selectedOllamaModel && options.pullIfMissing && ollama.available) {
    const pullResult = await pull(preferredOllamaModel);
    if (pullResult.ok) {
      ollama = await inspect();
      selectedOllamaModel = chooseRecommendedOllamaModel(ollama.installedModels, preferredOllamaModel);
    }
  }

  if (hasExplicitCloudDefault(config) && !options.forceLocalFirst) {
    return {
      host,
      hostUsesNativeModel,
      status: 'kept-existing-cloud',
      selectedProvider: config.defaultProvider,
      selectedModel: config.providers[config.defaultProvider]?.model ?? null,
      configUpdated: false,
      message: `${buildHostModelUsageMessage(host)} Preserved existing default provider ${config.defaultProvider} for DanteForge CLI because it was explicitly configured.`,
      nextSteps: ollama.available
        ? ['Run `danteforge config --provider ollama` if you want local-first CLI execution as well.']
        : ['Run `danteforge setup ollama --pull` to enable a local spend-saver path for DanteForge CLI.'],
      ollama: {
        ...ollama,
        recommendedModel: preferredOllamaModel,
        selectedModel: selectedOllamaModel,
      },
    };
  }

  if (ollama.available && selectedOllamaModel) {
    const nextConfig: DanteConfig = {
      ...config,
      defaultProvider: 'ollama',
      ollamaModel: selectedOllamaModel,
      providers: {
        ...config.providers,
        ollama: {
          ...config.providers.ollama,
          model: selectedOllamaModel,
        },
      },
    };

    const configUpdated = nextConfig.defaultProvider !== config.defaultProvider
      || nextConfig.ollamaModel !== config.ollamaModel
      || nextConfig.providers.ollama?.model !== config.providers.ollama?.model;

    if (configUpdated) {
      await save(nextConfig);
    }

    return {
      host,
      hostUsesNativeModel,
      status: 'configured-local',
      selectedProvider: 'ollama',
      selectedModel: selectedOllamaModel,
      configUpdated,
      message: `${buildHostModelUsageMessage(host)} Configured DanteForge CLI for local-first execution with Ollama model "${selectedOllamaModel}".`,
      nextSteps: [
        'Hosted provider keys remain optional fallback capacity for heavier direct CLI execution.',
      ],
      ollama: {
        ...ollama,
        recommendedModel: preferredOllamaModel,
        selectedModel: selectedOllamaModel,
      },
    };
  }

  return {
    host,
    hostUsesNativeModel,
    status: 'ollama-missing',
    selectedProvider: config.defaultProvider,
    selectedModel: config.providers[config.defaultProvider]?.model ?? null,
    configUpdated: false,
    message: `${buildHostModelUsageMessage(host)} No usable local Ollama model is configured yet for DanteForge CLI.`,
    nextSteps: ollama.available
      ? [
          `Run \`danteforge setup ollama --pull --ollama-model ${preferredOllamaModel}\` to install the recommended spend-saver model.`,
        ]
      : [
          'Install Ollama from https://ollama.com/download, then run `danteforge setup ollama --pull`.',
        ],
    ollama: {
      ...ollama,
      recommendedModel: preferredOllamaModel,
      selectedModel: selectedOllamaModel,
    },
  };
}
