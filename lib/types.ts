export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type DeleteCustomersPlan = {
  action: 'delete_customers';
  filters: {
    inactive_days: number;
    exclude_active_subscriptions: boolean;
    exclude_enterprise: boolean;
    limit: number | null;
    chaos_case_only: boolean;
  };
};

export type AggregateState = {
  customers: number;
  enterpriseCustomers: number;
  mrr: number;
  activeSubscriptions: number;
  accountSummaryEnterprise: number;
};

export type TargetCustomer = {
  id: string;
  name: string;
  email: string;
  status: string;
  segment: string;
  last_active_at: string;
  updated_at: string;
  chaos_case: boolean;
  active_subscription_count: number;
  active_mrr: number;
  open_ticket_count: number;
  note_count: number;
};

export type SimulationReport = {
  id: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  plan: DeleteCustomersPlan;
  status: 'unsafe' | 'safe';
  risk: RiskLevel;
  riskReasons: string[];
  confidence: number;
  confidenceSignals: { label: string; covered: boolean; detail: string }[];
  knownUnknowns: string[];
  targets: TargetCustomer[];
  before: AggregateState;
  projected: AggregateState;
  impact: {
    customersDeleted: number;
    activeSubscriptionsAffected: number;
    mrrAtRisk: number;
    enterpriseCustomersAffected: number;
    openTicketsAffected: number;
    notesAffected: number;
  };
  rollbackPlan: {
    customers: number;
    subscriptions: number;
    tickets: number;
    notes: number;
    estimatedRestoreOperations: number;
  };
  policy: { allowed: boolean; violations: string[] };
  fingerprint: string;
};

export type AuditEvent = {
  id: number;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
};
