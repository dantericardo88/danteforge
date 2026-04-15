// Premium Tier — monetization scaffolding for DanteForge
// Free core stays open; premium adds cloud audit, advanced gates, SLA verification.

import fs from 'fs/promises';
import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import { loadState } from './state.js';
import { logger } from './logger.js';
import { DanteError } from './errors.js';
import { computeExpectedHmac } from './license-keygen.js';
import type { ReflectionVerdict } from './reflection-engine.js';

const DEFAULT_SECRET = 'danteforge-dev-secret-do-not-use-in-production';

// --- Types -------------------------------------------------------------------

export type PremiumTier = 'free' | 'pro' | 'enterprise';

export interface PremiumConfig {
  tier: PremiumTier;
  cloudAuditEnabled: boolean;
  advancedGatesEnabled: boolean;
  slaVerification: boolean;
}

export interface AuditTrailEntry {
  timestamp: string;
  command: string;
  verdict?: ReflectionVerdict;
  pdseScores?: Record<string, number>;
  gateResults?: Record<string, boolean>;
}

export interface LicenseValidationResult {
  valid: boolean;
  tier: PremiumTier;
  expiresAt?: string;  // ISO date string
}

// --- Premium Features --------------------------------------------------------

const PREMIUM_FEATURES: Record<string, PremiumTier> = {
  'cloud-audit': 'pro',
  'audit-export': 'pro',
  'advanced-gates': 'pro',
  'sla-verification': 'enterprise',
  'multi-project': 'enterprise',
  'team-dashboard': 'enterprise',
};

// --- Public API --------------------------------------------------------------

export function getPremiumConfig(tier: PremiumTier): PremiumConfig {
  return {
    tier,
    cloudAuditEnabled: tier === 'pro' || tier === 'enterprise',
    advancedGatesEnabled: tier === 'pro' || tier === 'enterprise',
    slaVerification: tier === 'enterprise',
  };
}

export async function getPremiumTier(cwd?: string): Promise<PremiumTier> {
  // Env var override
  const envKey = process.env['DANTEFORGE_LICENSE_KEY'];
  if (envKey) {
    const result = validatePremiumLicense(envKey);
    if (result.valid && !isLicenseExpired(envKey)) return result.tier;
  }

  try {
    const state = await loadState({ cwd });
    const licKey = (state as any).premiumLicenseKey as string | undefined;
    if (licKey && !isLicenseExpired(licKey)) {
      const result = validatePremiumLicense(licKey);
      if (result.valid) return result.tier;
    }
    return (state as any).premiumTier ?? 'free';
  } catch {
    return 'free';
  }
}

export function isPremiumFeature(feature: string): boolean {
  return feature in PREMIUM_FEATURES;
}

export function getRequiredTier(feature: string): PremiumTier {
  return PREMIUM_FEATURES[feature] ?? 'free';
}

export function canAccessFeature(userTier: PremiumTier, feature: string): boolean {
  const requiredTier = getRequiredTier(feature);
  const tierOrder: Record<PremiumTier, number> = { free: 0, pro: 1, enterprise: 2 };
  return tierOrder[userTier] >= tierOrder[requiredTier];
}

export function listPremiumFeatures(): { feature: string; tier: PremiumTier }[] {
  return Object.entries(PREMIUM_FEATURES).map(([feature, tier]) => ({ feature, tier }));
}

// --- License Validation -------------------------------------------------------

// Parse format: DF-PRO-YYYYMMDD-HMAC16 or DF-ENT-YYYYMMDD-HMAC16
// Validates HMAC-SHA256 signature using timingSafeEqual to prevent timing attacks
export function validatePremiumLicense(
  key: string,
  deps?: { _getSecret?: () => string },
): LicenseValidationResult {
  if (!key || typeof key !== 'string') return { valid: false, tier: 'free' };

  const upper = key.toUpperCase().trim();
  let tier: PremiumTier = 'free';
  let expiresAt: string | undefined;

  if (upper.startsWith('DF-ENT-')) {
    tier = 'enterprise';
  } else if (upper.startsWith('DF-PRO-')) {
    tier = 'pro';
  } else {
    return { valid: false, tier: 'free' };
  }

  const parts = upper.split('-');
  // Need exactly 4 segments: DF, PRO/ENT, YYYYMMDD, HMAC
  if (parts.length < 4) return { valid: false, tier: 'free' };

  if (/^\d{8}$/.test(parts[2])) {
    const d = parts[2];
    expiresAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }

  // Verify HMAC
  const body = `${parts[0]}-${parts[1]}-${parts[2]}`;
  const secret = deps?._getSecret?.() ?? process.env['DANTEFORGE_LICENSE_SECRET'] ?? DEFAULT_SECRET;
  const expected = computeExpectedHmac(body, secret);
  const actual = Buffer.from(parts[3], 'utf-8');

  if (expected.length !== actual.length) return { valid: false, tier: 'free' };

  try {
    if (!timingSafeEqual(expected, actual)) return { valid: false, tier: 'free' };
  } catch {
    return { valid: false, tier: 'free' };
  }

  return { valid: true, tier, expiresAt };
}

export function isLicenseExpired(key: string, deps?: { _getSecret?: () => string }): boolean {
  const result = validatePremiumLicense(key, deps);
  if (!result.valid || !result.expiresAt) return false;
  return new Date(result.expiresAt) < new Date();
}

// --- Premium Gate Enforcement ------------------------------------------------

export async function requirePremiumFeature(feature: string, cwd?: string): Promise<void> {
  // Check env var override first (for CI/CD)
  const envKey = process.env['DANTEFORGE_LICENSE_KEY'];
  if (envKey) {
    const envResult = validatePremiumLicense(envKey);
    if (envResult.valid && canAccessFeature(envResult.tier, feature)) return;
  }

  const tier = await getPremiumTier(cwd);
  if (!canAccessFeature(tier, feature)) {
    const required = getRequiredTier(feature);
    throw new DanteError(
      `'${feature}' requires DanteForge ${required.toUpperCase()} tier`,
      'PREMIUM_REQUIRED',
      `Activate with: danteforge premium activate <license-key>`,
    );
  }
}

// --- Audit Trail -------------------------------------------------------------

const AUDIT_DIR = path.join('.danteforge', 'audit');

export async function recordAuditEntry(entry: AuditTrailEntry, cwd = process.cwd()): Promise<void> {
  const dir = path.join(cwd, AUDIT_DIR);
  await fs.mkdir(dir, { recursive: true });

  const filename = `audit-${Date.now()}.json`;
  await fs.writeFile(path.join(dir, filename), JSON.stringify(entry, null, 2));
}

export async function exportAuditTrail(cwd = process.cwd()): Promise<AuditTrailEntry[]> {
  const dir = path.join(cwd, AUDIT_DIR);
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json')).sort();
    const readResults = await Promise.allSettled(
      files.map((f) => fs.readFile(path.join(dir, f), 'utf8')),
    );
    return readResults
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map((r) => JSON.parse(r.value) as AuditTrailEntry);
  } catch {
    return [];
  }
}
