import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../core/logger.js';

export interface TenantConfig {
  tenantId: string;
  name: string;
  database?: string;
  config: Record<string, any>;
  isolationLevel: 'shared' | 'dedicated' | 'isolated';
}

export interface MultiTenantOptions {
  enableIsolation?: boolean;
  defaultIsolationLevel?: 'shared' | 'dedicated' | 'isolated';
  enableTenantSwitching?: boolean;
}

export class MultiTenantManager {
  private tenants: Map<string, TenantConfig> = new Map();
  private currentTenantId: string | null = null;
  private options: MultiTenantOptions;

  constructor(options: MultiTenantOptions = {}) {
    this.options = {
      enableIsolation: true,
      defaultIsolationLevel: 'shared',
      enableTenantSwitching: true,
      ...options
    };
  }

  async createTenant(tenantId: string, name: string, config: Record<string, any> = {}): Promise<void> {
    if (this.tenants.has(tenantId)) {
      throw new Error(`Tenant already exists: ${tenantId}`);
    }

    const tenant: TenantConfig = {
      tenantId,
      name,
      config,
      isolationLevel: this.options.defaultIsolationLevel!
    };

    this.tenants.set(tenantId, tenant);
    logger.info(`Tenant created: ${tenantId} (${name})`);
  }

  async switchTenant(tenantId: string): Promise<void> {
    if (!this.options.enableTenantSwitching) {
      throw new Error('Tenant switching is disabled');
    }

    if (!this.tenants.has(tenantId)) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    this.currentTenantId = tenantId;
    logger.info(`Switched to tenant: ${tenantId}`);
  }

  getCurrentTenant(): TenantConfig | null {
    if (!this.currentTenantId) return null;
    return this.tenants.get(this.currentTenantId) || null;
  }

  getTenantConfig(tenantId: string): TenantConfig | null {
    return this.tenants.get(tenantId) || null;
  }

  getAllTenants(): TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  async setTenantIsolation(tenantId: string, level: 'shared' | 'dedicated' | 'isolated'): Promise<void> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    if (!this.options.enableIsolation) {
      throw new Error('Tenant isolation is disabled');
    }

    tenant.isolationLevel = level;
    logger.info(`Tenant isolation set: ${tenantId} -> ${level}`);
  }

  async isolateTenantData(tenantId: string, dataPath: string): Promise<string> {
    if (!this.options.enableIsolation) {
      return dataPath; // No isolation, return original path
    }

    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    let isolatedPath = dataPath;

    if (tenant.isolationLevel === 'dedicated') {
      // Create tenant-specific directory
      isolatedPath = path.join(path.dirname(dataPath), `tenant_${tenantId}`, path.basename(dataPath));
    } else if (tenant.isolationLevel === 'isolated') {
      // Create fully isolated directory with hash
      const hash = crypto.createHash('md5').update(tenantId).digest('hex').substring(0, 8);
      isolatedPath = path.join(path.dirname(dataPath), `isolated_${hash}`, path.basename(dataPath));
    }

    // Ensure directory exists
    const dir = path.dirname(isolatedPath);
    await fs.mkdir(dir, { recursive: true });

    logger.info(`Tenant data isolated: ${tenantId} -> ${isolatedPath}`);
    return isolatedPath;
  }

  getTenantStats(): {
    totalTenants: number;
    currentTenant: string | null;
    isolationLevels: Record<string, number>;
  } {
    const isolationLevels: Record<string, number> = {};

    for (const tenant of this.tenants.values()) {
      isolationLevels[tenant.isolationLevel] = (isolationLevels[tenant.isolationLevel] || 0) + 1;
    }

    return {
      totalTenants: this.tenants.size,
      currentTenant: this.currentTenantId,
      isolationLevels
    };
  }
}