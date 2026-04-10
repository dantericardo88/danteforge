import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AccessControlManager } from '../src/core/access-control.js';
import { EncryptionManager } from '../src/core/encryption-manager.js';
import { MultiTenantManager } from '../src/core/multi-tenant-manager.js';
import { initializeEnterpriseFeatures } from '../src/core/enterprise-orchestrator.js';

describe('Enterprise Security Tests', () => {
  it('should manage access control policies', async () => {
    const manager = new AccessControlManager();

    await manager.addPolicy('user1', ['user'], ['read', 'write']);
    await manager.addPolicy('admin1', ['admin'], ['*']);

    assert(await manager.checkAccess('user1', 'read'), 'User should have read access');
    assert(await manager.checkAccess('user1', 'write'), 'User should have write access');
    assert(await manager.checkAccess('admin1', '*'), 'Admin should have all access');
    assert(!await manager.checkAccess('user1', 'delete'), 'User should not have delete access');
  });

  it('should encrypt and decrypt data', async () => {
    const manager = new EncryptionManager();

    await manager.generateKey('test-key');
    const originalData = 'Sensitive information';
    const encrypted = await manager.encryptData(originalData, 'test-key');
    const decrypted = await manager.decryptData(encrypted, 'test-key');

    assert(decrypted === originalData, 'Decrypted data should match original');
  });

  it('should manage multi-tenant isolation', async () => {
    const manager = new MultiTenantManager();

    await manager.createTenant('tenant1', 'Company A');
    await manager.createTenant('tenant2', 'Company B');

    await manager.switchTenant('tenant1');
    assert(manager.getCurrentTenant()?.tenantId === 'tenant1', 'Should switch to tenant1');

    const tenant1 = manager.getTenantConfig('tenant1');
    assert(tenant1?.name === 'Company A', 'Should retrieve tenant config');

    const stats = manager.getTenantStats();
    assert(stats.totalTenants === 2, 'Should have 2 tenants');
  });

  it('should initialize all enterprise features', async () => {
    const features = await initializeEnterpriseFeatures();

    assert(features.accessControl.enabled, 'Access control should be enabled');
    assert(features.encryption.enabled, 'Encryption should be enabled');
    assert(features.multiTenancy.enabled, 'Multi-tenancy should be enabled');

    assert(features.accessControl.policiesCount >= 2, 'Should have multiple policies');
    assert(features.encryption.keysGenerated >= 1, 'Should have encryption keys');
    assert(features.multiTenancy.tenantsCount >= 1, 'Should have at least one tenant');
  });

  it('should validate enterprise security integration', async () => {
    // Test end-to-end security workflow
    const accessManager = new AccessControlManager();
    const encryptionManager = new EncryptionManager();
    const tenantManager = new MultiTenantManager();

    // Setup
    await accessManager.addPolicy('user1', ['user'], ['read', 'write']);
    await encryptionManager.generateKey('user-data');
    await tenantManager.createTenant('org1', 'Organization 1');

    // Simulate secure data operation
    await tenantManager.switchTenant('org1');
    const hasAccess = await accessManager.checkAccess('user1', 'write');

    if (hasAccess) {
      const sensitiveData = 'Confidential company data';
      const encrypted = await encryptionManager.encryptData(sensitiveData, 'user-data');
      const decrypted = await encryptionManager.decryptData(encrypted, 'user-data');

      assert(decrypted === sensitiveData, 'End-to-end encryption should work');
      assert(tenantManager.getCurrentTenant()?.tenantId === 'org1', 'Multi-tenancy should work');
    } else {
      assert.fail('User should have access');
    }
  });
});