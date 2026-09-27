import { z } from 'zod';
import type { DeleteCustomersPlan } from './types';

export const planSchema = z.object({
  action: z.literal('delete_customers'),
  filters: z.object({
    inactive_days: z.number().int().min(30).max(3650).default(365),
    exclude_active_subscriptions: z.boolean().default(false),
    exclude_enterprise: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).nullable().default(null),
    chaos_case_only: z.boolean().default(false),
  })
}).strict();

export const simulateRequestSchema = z.object({ plan: planSchema }).strict();
export const executionRequestSchema = z.object({ simulationId: z.string().uuid() }).strict();
export const rollbackRequestSchema = z.object({ executionId: z.string().uuid() }).strict();

export function defaultPlan(): DeleteCustomersPlan {
  return {
    action: 'delete_customers',
    filters: { inactive_days: 365, exclude_active_subscriptions: false, exclude_enterprise: false, limit: null, chaos_case_only: false },
  };
}

export function failurePlan(): DeleteCustomersPlan {
  return {
    action: 'delete_customers',
    filters: { inactive_days: 30, exclude_active_subscriptions: true, exclude_enterprise: true, limit: 1, chaos_case_only: true },
  };
}

export function normalizePlan(plan: DeleteCustomersPlan): string {
  return JSON.stringify({
    action: plan.action,
    filters: {
      chaos_case_only: plan.filters.chaos_case_only,
      exclude_active_subscriptions: plan.filters.exclude_active_subscriptions,
      exclude_enterprise: plan.filters.exclude_enterprise,
      inactive_days: plan.filters.inactive_days,
      limit: plan.filters.limit,
    }
  });
}
