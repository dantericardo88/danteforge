// Premium Tier — monetization scaffolding for DanteForge
// Free core stays open; premium adds cloud audit, advanced gates, SLA verification.

import fs from 'fs/promises';
import path from 'path';
import { loadState } from './state.js';
import { logger } from './logger.js';
import type { ReflectionVerdict } from './reflection-engine.js';

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
  try {
    const state = await loadState({ cwd });
    return state.premiumTier ?? 'free';
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
    const entries: AuditTrailEntry[] = [];
    for (const file of files) {
      const content = await fs.readFile(path.join(dir, file), 'utf8');
      entries.push(JSON.parse(content) as AuditTrailEntry);
    }
    return entries;
  } catch {
    return [];
  }
}

// --- License Validation ------------------------------------------------------

/**
 * Validate a premium license key using offline prefix-based matching.
 * Keys follow the format DF-PRO-<key> (pro tier) or DF-ENT-<key> (enterprise tier).
 * Returns { valid: false, tier: 'free' } for unrecognized key formats.
 */
export async function validatePremiumLicense(key: string): Promise<{ valid: boolean; tier: PremiumTier }> {
  if (key.startsWith('DF-PRO-')) {
    return { valid: true, tier: 'pro' };
  }
  if (key.startsWith('DF-ENT-')) {
    return { valid: true, tier: 'enterprise' };
  }
  logger.warn('Invalid license key format. Expected: DF-PRO-<key> or DF-ENT-<key>');
  return { valid: false, tier: 'free' };
}
