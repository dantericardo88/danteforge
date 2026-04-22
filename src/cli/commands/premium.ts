// CLI command: danteforge premium
// Manage premium tier, license activation, audit trail export.

import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { loadState, saveState } from '../../core/state.js';
import {
  getPremiumTier,
  getPremiumConfig,
  listPremiumFeatures,
  canAccessFeature,
  validatePremiumLicense,
  isLicenseExpired,
  exportAuditTrail,
} from '../../core/premium.js';

export async function premium(subcommand: string, options: {
  key?: string;
  tier?: string;
  days?: string;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
} = {}): Promise<void> {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('premium', async () => {
    switch (subcommand) {
      case 'status':
        return showStatus();
      case 'activate':
        return activateLicense(options.key, loadFn, saveFn);
      case 'audit-export':
        return auditExport();
      case 'features':
        return showFeatures();
      case 'keygen': {
        const tier: 'pro' | 'enterprise' = options.tier === 'enterprise' ? 'enterprise' : 'pro';
        const days = parseInt(options.days ?? '365', 10);
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const { generateLicenseKey } = await import('../../core/license-keygen.js');
        const key = generateLicenseKey({ tier, expiresAt });
        logger.success(`Generated ${tier.toUpperCase()} license key (expires ${expiresAt.toISOString().split('T')[0]}):`);
        console.log(key);
        return;
      }
      default:
        logger.error(`Unknown subcommand: ${subcommand}. Available: status, activate, audit-export, features, keygen`);
        process.exitCode = 1;
    }
  });
}

async function showStatus(): Promise<void> {
  const tier = await getPremiumTier();
  const config = getPremiumConfig(tier);

  logger.success(`DanteForge Premium — Tier: ${tier.toUpperCase()}`);
  logger.info(`  Cloud Audit: ${config.cloudAuditEnabled ? 'enabled' : 'disabled'}`);
  logger.info(`  Advanced Gates: ${config.advancedGatesEnabled ? 'enabled' : 'disabled'}`);
  logger.info(`  SLA Verification: ${config.slaVerification ? 'enabled' : 'disabled'}`);

  // Show license expiry if a key is stored
  const licKey = process.env['DANTEFORGE_LICENSE_KEY'];
  if (licKey) {
    const result = validatePremiumLicense(licKey);
    if (result.valid && result.expiresAt) {
      const expired = isLicenseExpired(licKey);
      logger.info(`  License expires: ${result.expiresAt}${expired ? ' (EXPIRED)' : ''}`);
    }
  }
}

async function activateLicense(
  key?: string,
  loadFn: typeof loadState = loadState,
  saveFn: typeof saveState = saveState,
): Promise<void> {
  if (!key) {
    logger.error('Usage: danteforge premium activate <license-key>');
    process.exitCode = 1;
    return;
  }

  const result = validatePremiumLicense(key);
  if (result.valid) {
    const state = await loadFn();
    state.premiumTier = result.tier;
    state.premiumLicenseKey = key;
    state.auditTrailEnabled = result.tier !== 'free';
    await saveFn(state);
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
