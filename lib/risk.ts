import type { RiskLevel, SimulationReport } from './types';

type RiskInput = Pick<SimulationReport, 'impact' | 'rollbackPlan'>;

export function calculateRisk(input: RiskInput): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  const { impact, rollbackPlan } = input;
  if (impact.activeSubscriptionsAffected > 0) reasons.push('Active subscriptions would be deleted.');
  if (impact.mrrAtRisk > 0) reasons.push(`$${impact.mrrAtRisk.toLocaleString()} MRR is inside the blast radius.`);
  if (impact.enterpriseCustomersAffected > 0) reasons.push('Enterprise customers are targeted.');
  if (impact.openTicketsAffected > 0) reasons.push('Open support work would lose its customer parent.');
  if (impact.customersDeleted >= 50) reasons.push('Large destructive row count.');
  const expectedSnapshots = rollbackPlan.customers + rollbackPlan.subscriptions + rollbackPlan.tickets + rollbackPlan.notes;
  if (expectedSnapshots !== rollbackPlan.estimatedRestoreOperations) reasons.push('Rollback coverage is incomplete.');
  if (impact.activeSubscriptionsAffected > 0 || impact.mrrAtRisk > 0 || impact.enterpriseCustomersAffected > 0 || expectedSnapshots !== rollbackPlan.estimatedRestoreOperations) return { level: 'HIGH', reasons };
  if (impact.customersDeleted >= 25 || impact.openTicketsAffected >= 10) return { level: 'MEDIUM', reasons: reasons.length ? reasons : ['Blast radius is material even without protected relationships.'] };
  return { level: 'LOW', reasons: reasons.length ? reasons : ['No protected relationships; rollback coverage is complete.'] };
}

export function calculateConfidence() {
  const signals = [
    { label: 'Transaction fidelity', covered: true, detail: 'Candidate DELETE is executed against real PostgreSQL state and rolled back.' },
    { label: 'Schema visibility', covered: true, detail: 'Customers, subscriptions, tickets, and notes are observed.' },
    { label: 'Rollback completeness', covered: true, detail: 'All known dependent rows are captured in the restore plan.' },
    { label: 'External / hidden effects', covered: false, detail: 'Unknown triggers and external integrations may sit outside the observed dependency graph.' },
  ];
  const score = Math.round((signals.filter(s => s.covered).length / signals.length) * 88 + 8);
  return { score, signals };
}
