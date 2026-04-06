import { createHmac } from 'node:crypto';

const DEFAULT_SECRET = 'danteforge-dev-secret-do-not-use-in-production';

function getSecret(deps?: { _getSecret?: () => string }): string {
  return deps?._getSecret?.() ?? process.env['DANTEFORGE_LICENSE_SECRET'] ?? DEFAULT_SECRET;
}

export interface KeygenOptions {
  tier: 'pro' | 'enterprise';
  expiresAt: Date;
  deps?: { _getSecret?: () => string };
}

function tierPrefix(tier: 'pro' | 'enterprise'): string {
  return tier === 'enterprise' ? 'ENT' : 'PRO';
}

export function generateLicenseKey(options: KeygenOptions): string {
  const { tier, expiresAt, deps } = options;
  const prefix = tierPrefix(tier);
  const y = expiresAt.getUTCFullYear();
  const m = String(expiresAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(expiresAt.getUTCDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;
  const body = `DF-${prefix}-${dateStr}`;
  const secret = getSecret(deps);
  const hmac = createHmac('sha256', secret).update(body).digest('hex').slice(0, 16).toUpperCase();
  return `${body}-${hmac}`;
}

export function computeExpectedHmac(body: string, secret: string): Buffer {
  const hex = createHmac('sha256', secret).update(body).digest('hex').slice(0, 16).toUpperCase();
  return Buffer.from(hex, 'utf-8');
}
