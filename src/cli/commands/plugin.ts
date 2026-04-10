// plugin command — manage community skill plugins
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  loadPluginsManifest,
  installPlugin,
  removePlugin,
  type PluginRegistryOptions,
} from '../../core/plugin-registry.js';

export interface PluginCommandOptions {
  cwd?: string;
  _registryOpts?: PluginRegistryOptions;
}

export async function pluginInstall(
  packageName: string,
  options: PluginCommandOptions = {},
): Promise<void> {
  return withErrorBoundary('plugin-install', async () => {
    if (!packageName || !packageName.trim()) {
      logger.error('Package name is required. Usage: danteforge plugin install <package-name>');
      return;
    }
    logger.info(`Installing plugin: ${packageName}...`);
    const registryOpts = { ...options._registryOpts, cwd: options.cwd };
    const result = await installPlugin(packageName.trim(), registryOpts);
    if (result.alreadyInstalled) {
      logger.warn(`Plugin "${packageName}" is already installed (version ${result.entry.version}).`);
    } else {
      logger.success(`Plugin "${packageName}" installed (version ${result.entry.version})`);
      logger.info(`  Skills directory: ${result.entry.skillsDir}`);
    }
  });
}

export async function pluginList(options: PluginCommandOptions = {}): Promise<void> {
  return withErrorBoundary('plugin-list', async () => {
    const registryOpts = { ...options._registryOpts, cwd: options.cwd };
    const manifest = await loadPluginsManifest(registryOpts);
    if (manifest.plugins.length === 0) {
      logger.info('No plugins installed. Run: danteforge plugin install <package-name>');
      return;
    }
    logger.info('Installed plugins:');
    logger.info('');
    const nameW = Math.max(4, ...manifest.plugins.map((p) => p.name.length));
    const verW = Math.max(7, ...manifest.plugins.map((p) => p.version.length));
    logger.info(
      `  ${'Name'.padEnd(nameW)}  ${'Version'.padEnd(verW)}  Installed At`,
    );
    logger.info(`  ${'-'.repeat(nameW)}  ${'-'.repeat(verW)}  ${'─'.repeat(20)}`);
    for (const p of manifest.plugins) {
      logger.info(
        `  ${p.name.padEnd(nameW)}  ${p.version.padEnd(verW)}  ${p.installedAt}`,
      );
    }
  });
}

export async function pluginRemove(
  packageName: string,
  options: PluginCommandOptions = {},
): Promise<void> {
  return withErrorBoundary('plugin-remove', async () => {
    if (!packageName || !packageName.trim()) {
      logger.error('Package name is required. Usage: danteforge plugin remove <package-name>');
      return;
    }
    const registryOpts = { ...options._registryOpts, cwd: options.cwd };
    const result = await removePlugin(packageName.trim(), registryOpts);
    if (result.removed) {
      logger.success(`Plugin "${packageName}" removed from registry.`);
      logger.info('  Note: npm module files in .danteforge/plugin-modules/ were not deleted.');
    } else {
      logger.warn(`Plugin "${packageName}" not found in registry.`);
    }
  });
}

export async function pluginCommand(
  subcommand: 'install' | 'list' | 'remove',
  args: string[],
  options: PluginCommandOptions = {},
): Promise<void> {
  switch (subcommand) {
    case 'install':
      await pluginInstall(args[0] ?? '', options);
      break;
    case 'list':
      await pluginList(options);
      break;
    case 'remove':
      await pluginRemove(args[0] ?? '', options);
      break;
    default:
      logger.error(`Unknown plugin subcommand: ${String(subcommand)}. Use: install, list, remove`);
  }
}
