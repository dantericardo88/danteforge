import { AccessControlManager } from '../core/access-control.js';
import { EncryptionManager } from '../core/encryption-manager.js';
import { MultiTenantManager } from '../core/multi-tenant-manager.js';
import { logger } from '../core/logger.js';

export interface EnterpriseFeatures {
  accessControl: {
    enabled: boolean;
    policiesCount: number;
    lastAudit: string | null;
  };
  encryption: {
    enabled: boolean;
    keysGenerated: number;
    atRestEnabled: boolean;
    inTransitEnabled: boolean;
    algorithm: string;
  };
  multiTenancy: {
    enabled: boolean;
    tenantsCount: number;
    currentTenant: string | null;
    isolationLevels: Record<string, number>;
  };
}

export async function initializeEnterpriseFeatures(): Promise<EnterpriseFeatures> {
  logger.info('Initializing enterprise features...');

  // Initialize access control
  const accessManager = new AccessControlManager({
    enableRbac: true,
    enableAbac: false,
    auditAccess: true
  });

  // Add default admin policy
  await accessManager.addPolicy('admin', ['admin'], ['*']);
  await accessManager.addPolicy('user', ['user'], ['read', 'write']);

  // Initialize encryption
  const encryptionManager = new EncryptionManager({
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    enableAtRest: true,
    enableInTransit: false
  });

  // Generate default encryption keys
  await encryptionManager.generateKey('default');
  await encryptionManager.generateKey('audit');

  // Initialize multi-tenancy
  const tenantManager = new MultiTenantManager({
    enableIsolation: true,
    defaultIsolationLevel: 'shared',
    enableTenantSwitching: true
  });

  // Create default tenant
  await tenantManager.createTenant('default', 'Default Organization');

  const features: EnterpriseFeatures = {
    accessControl: {
      enabled: true,
      policiesCount: accessManager.getUserPolicies().length,
      lastAudit: new Date().toISOString()
    },
    encryption: {
      enabled: true,
      ...encryptionManager.getEncryptionStatus()
    },
    multiTenancy: {
      enabled: true,
      ...tenantManager.getTenantStats()
    }
  };

  logger.info('Enterprise features initialized successfully');
  return features;
}

export async function getEnterpriseReadinessScore(): Promise<number> {
  const features = await initializeEnterpriseFeatures();

  let score = 0;

  // Access control scoring (max 3.0)
  if (features.accessControl.enabled) {
    score += 2.0; // Basic RBAC
    if (features.accessControl.policiesCount >= 2) {
      score += 1.0; // Multiple policies
    }
  }

  // Encryption scoring (max 3.0)
  if (features.encryption.enabled) {
    score += 1.0; // Basic encryption
    if (features.encryption.atRestEnabled) {
      score += 1.0; // At-rest encryption
    }
    if (features.encryption.keysGenerated >= 2) {
      score += 1.0; // Multiple keys
    }
  }

  // Multi-tenancy scoring (max 4.0)
  if (features.multiTenancy.enabled) {
    score += 2.0; // Basic multi-tenancy
    if (features.multiTenancy.tenantsCount >= 1) {
      score += 1.0; // Tenant management
    }
    if (Object.keys(features.multiTenancy.isolationLevels).length > 1) {
      score += 1.0; // Multiple isolation levels
    }
  }

  return Math.min(10.0, score);
}