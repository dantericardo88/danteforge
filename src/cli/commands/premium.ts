// CLI command: danteforge premium
// Manage premium tier, license activation, audit trail export.

import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import {
  getPremiumTier,
  getPremiumConfig,
  listPremiumFeatures,
  canAccessFeature,
  validatePremiumLicense,
  exportAuditTrail,
} from '../../core/premium.js';

export async function premium(subcommand: string, options: { key?: string } = {}): Promise<void> {
  switch (subcommand) {
    case 'status':
      return showStatus();
    case 'activate':
      return activateLicense(options.key);
    case 'audit-export':
      return auditExport();
    case 'features':
      return showFeatures();
    default:
      logger.error(`Unknown subcommand: ${subcommand}. Available: status, activate, audit-export, features`);
      process.exitCode = 1;
  }
}

async function showStatus(): Promise<void> {
  const tier = await getPremiumTier();
  const config = getPremiumConfig(tier);

  logger.success(`DanteForge Premium — Tier: ${tier.toUpperCase()}`);
  logger.info(`  Cloud Audit: ${config.cloudAuditEnabled ? 'enabled' : 'disabled'}`);
  logger.info(`  Advanced Gates: ${config.advancedGatesEnabled ? 'enabled' : 'disabled'}`);
  logger.info(`  SLA Verification: ${config.slaVerification ? 'enabled' : 'disabled'}`);
}

async function activateLicense(key?: string): Promise<void> {
  if (!key) {
    logger.error('Usage: danteforge premium activate <license-key>');
    process.exitCode = 1;
    return;
  }

  const result = await validatePremiumLicense(key);
  if (result.valid) {
    const state = await loadState();
    state.premiumTier = result.tier;
    state.premiumLicenseKey = key;
    state.auditTrailEnabled = result.tier !== 'free';
    await saveState(state);
    logger.success(`License activated! Tier: ${result.tier.toUpperCase()}`);
  } else {
    logger.error('Invalid license key.');
    process.exitCode = 1;
  }
}

async function auditExport(): Promise<void> {
  const tier = await getPremiumTier();
  if (!canAccessFeature(tier, 'audit-export')) {
    logger.error('Audit export requires Pro tier or above. Run: danteforge premium activate <key>');
    process.exitCode = 1;
    return;
  }

  const entries = await exportAuditTrail();
  if (entries.length === 0) {
    logger.info('No audit entries found.');
    return;
  }

  const output = JSON.stringify(entries, null, 2);
  logger.info(output);
  logger.success(`Exported ${entries.length} audit entries.`);
}

async function showFeatures(): Promise<void> {
  const tier = await getPremiumTier();
  const features = listPremiumFeatures();

  logger.success('DanteForge Premium Features:');
  for (const { feature, tier: requiredTier } of features) {
    const accessible = canAccessFeature(tier, feature);
    const status = accessible ? 'unlocked' : `requires ${requiredTier}`;
    logger.info(`  ${accessible ? '+' : '-'} ${feature} (${status})`);
  }
}
