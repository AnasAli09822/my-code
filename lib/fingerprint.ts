import crypto from 'node:crypto';
import type { DeleteCustomersPlan, TargetCustomer } from './types';
import { normalizePlan } from './dsl';

export function buildFingerprint(sessionId: string, plan: DeleteCustomersPlan, rows: TargetCustomer[]) {
  const material = {
    sessionId,
    plan: normalizePlan(plan),
    rows: rows.map(row => ({
      id: row.id,
      updated_at: row.updated_at,
      active_subscription_count: Number(row.active_subscription_count),
      active_mrr: Number(row.active_mrr),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
}
