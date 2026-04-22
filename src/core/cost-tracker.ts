import { logger } from '../core/logger.js';

export interface CostTrackingOptions {
  enableLLMTracking?: boolean;
  enableAPITracking?: boolean;
  budgetLimits?: {
    monthlyLLM?: number;
    monthlyAPI?: number;
  };
}

export interface CostRecord {
  timestamp: string;
  operation: string;
  cost: number;
  currency: string;
  metadata?: Record<string, any>;
}

export class CostTracker {
  private costs: CostRecord[] = [];
  private options: CostTrackingOptions;

  constructor(options: CostTrackingOptions = {}) {
    this.options = {
      enableLLMTracking: true,
      enableAPITracking: true,
      ...options
    };
  }

  trackCost(operation: string, cost: number, currency: string = 'USD', metadata?: Record<string, any>): void {
    const record: CostRecord = {
      timestamp: new Date().toISOString(),
      operation,
      cost,
      currency,
      metadata
    };

    this.costs.push(record);

    // Check budget limits
    if (this.options.budgetLimits) {
      const monthlyCosts = this.getMonthlyCosts();
      if (this.options.budgetLimits.monthlyLLM && monthlyCosts.llm > this.options.budgetLimits.monthlyLLM) {
        logger.warn(`LLM cost budget exceeded: $${monthlyCosts.llm.toFixed(2)} > $${this.options.budgetLimits.monthlyLLM}`);
      }
      if (this.options.budgetLimits.monthlyAPI && monthlyCosts.api > this.options.budgetLimits.monthlyAPI) {
        logger.warn(`API cost budget exceeded: $${monthlyCosts.api.toFixed(2)} > $${this.options.budgetLimits.monthlyAPI}`);
      }
    }
  }

  getMonthlyCosts(): { llm: number; api: number; total: number } {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyCosts = this.costs
      .filter(c => new Date(c.timestamp) >= startOfMonth)
      .reduce(
        (acc, c) => {
          if (c.operation.includes('llm') || c.operation.includes('ai')) {
            acc.llm += c.cost;
          } else if (c.operation.includes('api')) {
            acc.api += c.cost;
          }
          acc.total += c.cost;
          return acc;
        },
        { llm: 0, api: 0, total: 0 }
      );

    return monthlyCosts;
  }

  getCostReport(): {
    total: number;
    byOperation: Record<string, number>;
    monthly: { llm: number; api: number; total: number };
    budgetStatus: 'ok' | 'warning' | 'exceeded';
  } {
    const total = this.costs.reduce((sum, c) => sum + c.cost, 0);

    const byOperation = this.costs.reduce((acc, c) => {
      acc[c.operation] = (acc[c.operation] || 0) + c.cost;
      return acc;
    }, {} as Record<string, number>);

    const monthly = this.getMonthlyCosts();

    let budgetStatus: 'ok' | 'warning' | 'exceeded' = 'ok';
    if (this.options.budgetLimits) {
      const llmExceeded = this.options.budgetLimits.monthlyLLM && monthly.llm > this.options.budgetLimits.monthlyLLM;
      const apiExceeded = this.options.budgetLimits.monthlyAPI && monthly.api > this.options.budgetLimits.monthlyAPI;
      if (llmExceeded || apiExceeded) {
        budgetStatus = 'exceeded';
      } else if (monthly.llm > (this.options.budgetLimits.monthlyLLM || 0) * 0.8 ||
                 monthly.api > (this.options.budgetLimits.monthlyAPI || 0) * 0.8) {
        budgetStatus = 'warning';
      }
    }

    return {
      total,
      byOperation,
      monthly,
      budgetStatus
    };
  }
}