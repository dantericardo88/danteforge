import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

export interface AccessControlPolicy {
  userId: string;
  roles: string[];
  permissions: string[];
  resourceRestrictions?: string[];
}

export interface AccessControlOptions {
  enableRbac?: boolean;
  enableAbac?: boolean;
  auditAccess?: boolean;
}

export class AccessControlManager {
  private policies: Map<string, AccessControlPolicy> = new Map();
  private options: AccessControlOptions;

  constructor(options: AccessControlOptions = {}) {
    this.options = {
      enableRbac: true,
      enableAbac: false,
      auditAccess: true,
      ...options
    };
  }

  async addPolicy(userId: string, roles: string[], permissions: string[]): Promise<void> {
    const policy: AccessControlPolicy = {
      userId,
      roles,
      permissions,
      resourceRestrictions: []
    };

    this.policies.set(userId, policy);
    logger.info(`Access policy added for user: ${userId}`);
  }

  async checkAccess(userId: string, action: string, resource?: string): Promise<boolean> {
    const policy = this.policies.get(userId);
    if (!policy) {
      if (this.options.auditAccess) {
        logger.warn(`Access denied: no policy for user ${userId}`);
      }
      return false;
    }

    // Check role-based access
    if (this.options.enableRbac) {
      const hasPermission = policy.permissions.includes(action) ||
                           policy.permissions.includes('*');

      if (!hasPermission) {
        if (this.options.auditAccess) {
          logger.warn(`RBAC access denied for user ${userId}: ${action}`);
        }
        return false;
      }
    }

    // Check resource restrictions
    if (resource && policy.resourceRestrictions) {
      const restricted = policy.resourceRestrictions.some(restriction =>
        resource.includes(restriction)
      );

      if (restricted) {
        if (this.options.auditAccess) {
          logger.warn(`Resource access denied for user ${userId}: ${resource}`);
        }
        return false;
      }
    }

    if (this.options.auditAccess) {
      logger.info(`Access granted for user ${userId}: ${action}`);
    }

    return true;
  }

  async addResourceRestriction(userId: string, resourcePattern: string): Promise<void> {
    const policy = this.policies.get(userId);
    if (policy) {
      policy.resourceRestrictions = policy.resourceRestrictions || [];
      policy.resourceRestrictions.push(resourcePattern);
      logger.info(`Resource restriction added for user ${userId}: ${resourcePattern}`);
    }
  }

  getUserPolicies(): AccessControlPolicy[] {
    return Array.from(this.policies.values());
  }
}