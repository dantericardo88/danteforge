import { logger } from '../../core/logger.js';
import { resolveConfigPaths } from '../../core/config.js';
import { configureSpendOptimizedDefaults } from '../../core/spend-optimizer.js';

export async function setupOllama(options: {
  host?: string;
  pull?: boolean;
  ollamaModel?: string;
} = {}) {
  logger.success('DanteForge Ollama Setup Wizard');
  logger.info('');
  logger.info('This configures DanteForge CLI for local-first execution to reduce hosted token spend.');
  logger.info('Native assistant workflows continue using the host model/session when they run inside Codex, Claude Code, Cursor, or similar tools.');
  logger.info('');

  const result = await configureSpendOptimizedDefaults({
    hostOverride: options.host,
    preferredOllamaModel: options.ollamaModel,
    pullIfMissing: options.pull,
  });
  const paths = resolveConfigPaths();

  logger.info(result.message);
  logger.info(`Shared config: ${paths.configFile}`);
  if (result.ollama.available) {
    const models = result.ollama.installedModels.length > 0
      ? result.ollama.installedModels.join(', ')
      : '(none installed)';
    logger.info(`Detected Ollama models: ${models}`);
  } else if (result.ollama.detail) {
    logger.warn(result.ollama.detail);
  }

  logger.info(`Recommended spend-saver model: ${result.ollama.recommendedModel}`);
  if (result.selectedModel) {
    logger.info(`Selected local model: ${result.selectedModel}`);
  }

  for (const step of result.nextSteps) {
    logger.info(step);
  }

  logger.info('Validate with: danteforge doctor');
  logger.info('Use hosted fallback only when you want extra depth: danteforge config --set-key "openai:..."');
}
