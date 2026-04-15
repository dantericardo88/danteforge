// MultiTenantManager tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MultiTenantManager } from '../src/core/multi-tenant-manager.js';

describe('MultiTenantManager', () => {
  it('constructs with defaults', () => {
    const mgr = new MultiTenantManager();
    const stats = mgr.getTenantStats();
    assert.equal(stats.tenantsCount, 0);
    assert.equal(stats.currentTenant, null);
  });

  it('creates a tenant', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('t1', 'Tenant 1');
    const tenant = mgr.getTenantConfig('t1');
    assert.ok(tenant);
    assert.equal(tenant.tenantId, 't1');
    assert.equal(tenant.name, 'Tenant 1');
  });

  it('throws when creating duplicate tenant', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('dup', 'Dup');
    await assert.rejects(() => mgr.createTenant('dup', 'Dup2'), /already exists/);
  });

  it('creates tenant with custom config', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('t2', 'Tenant 2', { region: 'us-east' });
    const tenant = mgr.getTenantConfig('t2');
    assert.equal(tenant?.config.region, 'us-east');
  });

  it('switches tenant successfully', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('t1', 'T1');
    await mgr.switchTenant('t1');
    const current = mgr.getCurrentTenant();
    assert.equal(current?.tenantId, 't1');
  });

  it('throws when switching to nonexistent tenant', async () => {
    const mgr = new MultiTenantManager();
    await assert.rejects(() => mgr.switchTenant('ghost'), /not found/);
  });

  it('throws when switching is disabled', async () => {
    const mgr = new MultiTenantManager({ enableTenantSwitching: false });
    await mgr.createTenant('t1', 'T1');
    await assert.rejects(() => mgr.switchTenant('t1'), /disabled/);
  });

  it('getCurrentTenant returns null when no tenant active', () => {
    const mgr = new MultiTenantManager();
    assert.equal(mgr.getCurrentTenant(), null);
  });

  it('getAllTenants returns all created tenants', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('a', 'A');
    await mgr.createTenant('b', 'B');
    const all = mgr.getAllTenants();
    assert.equal(all.length, 2);
  });

  it('setTenantIsolation updates isolation level', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('t1', 'T1');
    await mgr.setTenantIsolation('t1', 'dedicated');
    const tenant = mgr.getTenantConfig('t1');
    assert.equal(tenant?.isolationLevel, 'dedicated');
  });

  it('setTenantIsolation throws for unknown tenant', async () => {
    const mgr = new MultiTenantManager();
    await assert.rejects(() => mgr.setTenantIsolation('ghost', 'shared'), /not found/);
  });

  it('setTenantIsolation throws when isolation disabled', async () => {
    const mgr = new MultiTenantManager({ enableIsolation: false });
    await mgr.createTenant('t1', 'T1');
    await assert.rejects(() => mgr.setTenantIsolation('t1', 'shared'), /disabled/);
  });

  it('isolateTenantData returns original path when isolation disabled', async () => {
    const mgr = new MultiTenantManager({ enableIsolation: false });
    await mgr.createTenant('t1', 'T1');
    const p = await mgr.isolateTenantData('t1', '/data/file.txt');
    assert.equal(p, '/data/file.txt');
  });

  it('isolateTenantData throws for unknown tenant', async () => {
    const mgr = new MultiTenantManager();
    await assert.rejects(() => mgr.isolateTenantData('ghost', '/data/file.txt'), /not found/);
  });

  it('getTenantStats counts tenants and tracks isolation levels', async () => {
    const mgr = new MultiTenantManager({ defaultIsolationLevel: 'shared' });
    await mgr.createTenant('a', 'A');
    await mgr.createTenant('b', 'B');
    const stats = mgr.getTenantStats();
    assert.equal(stats.tenantsCount, 2);
    assert.equal(stats.isolationLevels['shared'], 2);
  });

  it('getTenantStats tracks currentTenant', async () => {
    const mgr = new MultiTenantManager();
    await mgr.createTenant('t1', 'T1');
    await mgr.switchTenant('t1');
    const stats = mgr.getTenantStats();
    assert.equal(stats.currentTenant, 't1');
  });
});
