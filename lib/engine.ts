import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { audit, ensureSchema, seedSession, withClient } from './db';
import { buildFingerprint } from './fingerprint';
import { calculateConfidence, calculateRisk } from './risk';
import type { AggregateState, DeleteCustomersPlan, SimulationReport, TargetCustomer } from './types';

const TARGET_SELECT = `
  SELECT c.id, c.name, c.email, c.status, c.segment, c.last_active_at::text, c.updated_at::text, c.chaos_case,
         (SELECT COUNT(*)::int FROM foresee_subscriptions s WHERE s.session_id = c.session_id AND s.customer_id = c.id AND s.status = 'active') AS active_subscription_count,
         (SELECT COALESCE(SUM(s.mrr), 0)::int FROM foresee_subscriptions s WHERE s.session_id = c.session_id AND s.customer_id = c.id AND s.status = 'active') AS active_mrr,
         (SELECT COUNT(*)::int FROM foresee_support_tickets t WHERE t.session_id = c.session_id AND t.customer_id = c.id AND t.status = 'open') AS open_ticket_count,
         (SELECT COUNT(*)::int FROM foresee_customer_notes n WHERE n.session_id = c.session_id AND n.customer_id = c.id) AS note_count
  FROM foresee_customers c
`;

function compileTargetQuery(plan: DeleteCustomersPlan, lock = false) {
  const params: unknown[] = [];
  let i = 1;
  const where: string[] = [`c.session_id = $${i++}`];
  if (plan.filters.chaos_case_only) {
    where.push('c.chaos_case = true');
  } else {
    params.push(plan.filters.inactive_days);
    where.push(`c.last_active_at < now() - ($${i++}::int * interval '1 day')`);
  }
  if (plan.filters.exclude_enterprise) where.push(`c.segment <> 'Enterprise'`);
  if (plan.filters.exclude_active_subscriptions) where.push(`NOT EXISTS (SELECT 1 FROM foresee_subscriptions sx WHERE sx.session_id = c.session_id AND sx.customer_id = c.id AND sx.status = 'active')`);
  let sql = `${TARGET_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.id`;
  if (plan.filters.limit) {
    params.push(plan.filters.limit);
    sql += ` LIMIT $${i++}::int`;
  }
  if (lock) sql += ' FOR UPDATE OF c';
  return { sql, extraParams: params };
}

async function loadTargets(client: PoolClient, sessionId: string, plan: DeleteCustomersPlan, lock = false): Promise<TargetCustomer[]> {
  const compiled = compileTargetQuery(plan, lock);
  const result = await client.query(compiled.sql, [sessionId, ...compiled.extraParams]);
  return result.rows.map(row => ({
    ...row,
    active_subscription_count: Number(row.active_subscription_count),
    active_mrr: Number(row.active_mrr),
    open_ticket_count: Number(row.open_ticket_count),
    note_count: Number(row.note_count),
  }));
}

async function aggregateState(client: PoolClient, sessionId: string): Promise<AggregateState> {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM foresee_customers WHERE session_id = $1) AS customers,
      (SELECT COUNT(*)::int FROM foresee_customers WHERE session_id = $1 AND segment = 'Enterprise') AS enterprise_customers,
      (SELECT COALESCE(SUM(mrr),0)::int FROM foresee_subscriptions WHERE session_id = $1 AND status = 'active') AS mrr,
      (SELECT COUNT(*)::int FROM foresee_subscriptions WHERE session_id = $1 AND status = 'active') AS active_subscriptions,
      (SELECT enterprise_customers::int FROM foresee_account_summary WHERE session_id = $1) AS account_summary_enterprise
  `, [sessionId]);
  const row = result.rows[0];
  return {
    customers: Number(row.customers), enterpriseCustomers: Number(row.enterprise_customers), mrr: Number(row.mrr),
    activeSubscriptions: Number(row.active_subscriptions), accountSummaryEnterprise: Number(row.account_summary_enterprise),
  };
}

async function deleteTargets(client: PoolClient, sessionId: string, targets: TargetCustomer[]) {
  if (!targets.length) return;
  await client.query(`DELETE FROM foresee_customers WHERE session_id = $1 AND id = ANY($2::text[])`, [sessionId, targets.map(t => t.id)]);
}

export async function simulate(sessionId: string, plan: DeleteCustomersPlan): Promise<SimulationReport> {
  return withClient(async client => {
    await ensureSchema(client);
    await seedSession(client, sessionId);
    await audit(client, sessionId, 'SIMULATION_STARTED', { plan });
    let report!: SimulationReport;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      const before = await aggregateState(client, sessionId);
      const targets = await loadTargets(client, sessionId, plan);
      const fingerprint = buildFingerprint(sessionId, plan, targets);
      const impact = {
        customersDeleted: targets.length,
        activeSubscriptionsAffected: targets.reduce((sum, t) => sum + t.active_subscription_count, 0),
        mrrAtRisk: targets.reduce((sum, t) => sum + t.active_mrr, 0),
        enterpriseCustomersAffected: targets.filter(t => t.segment === 'Enterprise').length,
        openTicketsAffected: targets.reduce((sum, t) => sum + t.open_ticket_count, 0),
        notesAffected: targets.reduce((sum, t) => sum + t.note_count, 0),
      };
      const rollbackPlan = {
        customers: impact.customersDeleted,
        subscriptions: targets.reduce((sum, t) => sum + t.active_subscription_count, 0),
        tickets: targets.reduce((sum, t) => sum + t.open_ticket_count, 0),
        notes: impact.notesAffected,
        estimatedRestoreOperations: impact.customersDeleted + targets.reduce((sum, t) => sum + t.active_subscription_count, 0) + targets.reduce((sum, t) => sum + t.open_ticket_count, 0) + impact.notesAffected,
      };
      await deleteTargets(client, sessionId, targets);
      const projectedRaw = await aggregateState(client, sessionId);
      const projected: AggregateState = { ...projectedRaw, accountSummaryEnterprise: before.accountSummaryEnterprise };
      const risk = calculateRisk({ impact, rollbackPlan } as never);
      const violations = [
        ...(impact.activeSubscriptionsAffected > 0 ? ['ACTIVE_SUBSCRIPTION_TARGETED'] : []),
        ...(impact.enterpriseCustomersAffected > 0 ? ['ENTERPRISE_CUSTOMER_TARGETED'] : []),
        ...(impact.mrrAtRisk > 0 ? ['PROTECTED_MRR_AT_RISK'] : []),
      ];
      const confidence = calculateConfidence();
      const now = new Date();
      const expires = new Date(now.getTime() + 5 * 60_000);
      report = {
        id: crypto.randomUUID(), sessionId, createdAt: now.toISOString(), expiresAt: expires.toISOString(), plan,
        status: risk.level === 'HIGH' ? 'unsafe' : 'safe', risk: risk.level, riskReasons: risk.reasons,
        confidence: confidence.score, confidenceSignals: confidence.signals,
        knownUnknowns: [
          'External integrations are not replayed in the transaction sandbox.',
          'Unknown database triggers can exist outside the observed dependency graph.',
          'Effects outside the measured business-state domains are not guaranteed.',
        ],
        targets, before, projected, impact, rollbackPlan, policy: { allowed: violations.length === 0, violations }, fingerprint,
      };
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await client.query(`INSERT INTO foresee_simulation_runs(id, session_id, plan, report, fingerprint, expires_at, status) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`, [report.id, sessionId, JSON.stringify(plan), JSON.stringify(report), report.fingerprint, report.expiresAt, report.status]);
    await audit(client, sessionId, 'SIMULATION_COMPLETED', { simulationId: report.id, risk: report.risk, targets: report.targets.length });
    if (!report.policy.allowed) await audit(client, sessionId, 'POLICY_BLOCKED', { simulationId: report.id, violations: report.policy.violations });
    return report;
  });
}

async function captureSnapshots(client: PoolClient, sessionId: string, executionId: string, targets: TargetCustomer[]) {
  const ids = targets.map(t => t.id);
  if (!ids.length) return;
  const tables = [
    { table: 'foresee_customers', order: 10, id: 'id', customerWhere: 'id = ANY($2::text[])' },
    { table: 'foresee_subscriptions', order: 20, id: 'id', customerWhere: 'customer_id = ANY($2::text[])' },
    { table: 'foresee_support_tickets', order: 30, id: 'id', customerWhere: 'customer_id = ANY($2::text[])' },
    { table: 'foresee_customer_notes', order: 40, id: 'id', customerWhere: 'customer_id = ANY($2::text[])' },
  ];
  for (const entry of tables) {
    const rows = await client.query(`SELECT * FROM ${entry.table} WHERE session_id = $1 AND ${entry.customerWhere}`, [sessionId, ids]);
    for (const row of rows.rows) {
      await client.query(`INSERT INTO foresee_rollback_snapshots(session_id, execution_id, table_name, row_id, serialized_row, restore_order) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [sessionId, executionId, entry.table, row[entry.id], JSON.stringify(row), entry.order]);
    }
  }
}

export async function executeSimulation(sessionId: string, simulationId: string) {
  return withClient(async client => {
    await ensureSchema(client);
    const simulationResult = await client.query(`SELECT * FROM foresee_simulation_runs WHERE id = $1 AND session_id = $2`, [simulationId, sessionId]);
    if (!simulationResult.rowCount) throw new Error('Simulation not found for this session.');
    const simRow = simulationResult.rows[0];
    const report = simRow.report as SimulationReport;
    if (new Date(simRow.expires_at).getTime() <= Date.now()) {
      await audit(client, sessionId, 'STATE_FINGERPRINT_FAILED', { simulationId, reason: 'expired' });
      return { status: 'stale' as const, message: 'State changed since simulation. Re-simulation required.' };
    }
    if (!report.policy.allowed) {
      await audit(client, sessionId, 'EXECUTION_REFUSED', { simulationId, reason: 'policy_blocked' });
      return { status: 'blocked' as const, message: 'Policy blocks this plan. Apply a safe tweak and re-simulate.' };
    }
    const executionId = crypto.randomUUID();
    await client.query(`INSERT INTO foresee_execution_runs(id, session_id, simulation_id, status) VALUES ($1, $2, $3, 'running')`, [executionId, sessionId, simulationId]);
    await audit(client, sessionId, 'ACTION_APPROVED', { simulationId, executionId });
    await audit(client, sessionId, 'EXECUTION_STARTED', { simulationId, executionId });
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      const targets = await loadTargets(client, sessionId, report.plan, true);
      const currentFingerprint = buildFingerprint(sessionId, report.plan, targets);
      if (currentFingerprint !== report.fingerprint) {
        await client.query('ROLLBACK');
        await client.query(`UPDATE foresee_execution_runs SET status='stale', result=$2::jsonb, rolled_back_at=now() WHERE id=$1`, [executionId, JSON.stringify({ reason: 'fingerprint_mismatch' })]);
        await audit(client, sessionId, 'STATE_FINGERPRINT_FAILED', { simulationId, executionId });
        return { status: 'stale' as const, executionId, message: 'State changed since simulation. Re-simulation required.' };
      }
      await captureSnapshots(client, sessionId, executionId, targets);
      const preExecution = await aggregateState(client, sessionId);
      await deleteTargets(client, sessionId, targets);
      const observed = await aggregateState(client, sessionId);
      const divergence: string[] = [];
      if (observed.customers !== report.projected.customers) divergence.push('customers');
      if (observed.enterpriseCustomers !== report.projected.enterpriseCustomers) divergence.push('enterprise_customers');
      if (observed.mrr !== report.projected.mrr) divergence.push('mrr');
      if (observed.activeSubscriptions !== report.projected.activeSubscriptions) divergence.push('active_subscriptions');
      if (observed.accountSummaryEnterprise !== report.projected.accountSummaryEnterprise) divergence.push('account_summary.enterprise_customers');
      const orphanCheck = await client.query(`SELECT COUNT(*)::int AS n FROM foresee_subscriptions s LEFT JOIN foresee_customers c ON c.session_id=s.session_id AND c.id=s.customer_id WHERE s.session_id=$1 AND s.status='active' AND c.id IS NULL`, [sessionId]);
      if (Number(orphanCheck.rows[0].n) > 0) divergence.push('active_subscription_orphan');
      if (divergence.length) {
        await client.query('ROLLBACK');
        const result = { prediction: report.projected, observed, unexpected: divergence, safetyResponse: 'Transaction rolled back automatically', finalPersistentState: 'UNCHANGED' };
        await client.query(`UPDATE foresee_execution_runs SET status='auto_rolled_back', result=$2::jsonb, rolled_back_at=now() WHERE id=$1`, [executionId, JSON.stringify(result)]);
        await audit(client, sessionId, 'RUNTIME_DIVERGENCE', { simulationId, executionId, unexpected: divergence });
        await audit(client, sessionId, 'AUTO_ROLLBACK', { simulationId, executionId });
        return { status: 'auto_rolled_back' as const, executionId, ...result };
      }
      await client.query('COMMIT');
      const result = { before: preExecution, observed, verified: true };
      await client.query(`UPDATE foresee_execution_runs SET status='committed', result=$2::jsonb, committed_at=now() WHERE id=$1`, [executionId, JSON.stringify(result)]);
      await audit(client, sessionId, 'EXECUTION_COMMITTED', { simulationId, executionId, customersDeleted: report.impact.customersDeleted });
      return { status: 'committed' as const, executionId, ...result };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      await client.query(`UPDATE foresee_execution_runs SET status='failed', result=$2::jsonb, rolled_back_at=now() WHERE id=$1`, [executionId, JSON.stringify({ error: 'Execution failed safely.' })]);
      throw error;
    }
  });
}

export async function rollbackExecution(sessionId: string, executionId: string) {
  return withClient(async client => {
    await ensureSchema(client);
    const execution = await client.query(`SELECT * FROM foresee_execution_runs WHERE id=$1 AND session_id=$2`, [executionId, sessionId]);
    if (!execution.rowCount) throw new Error('Execution not found.');
    if (execution.rows[0].status !== 'committed') throw new Error('Only committed executions can be manually rolled back.');
    const snapshots = await client.query(`SELECT table_name, serialized_row, restore_order FROM foresee_rollback_snapshots WHERE execution_id=$1 AND session_id=$2 ORDER BY restore_order ASC, id ASC`, [executionId, sessionId]);
    await client.query('BEGIN');
    try {
      for (const snapshot of snapshots.rows) {
        const row = snapshot.serialized_row as Record<string, unknown>;
        switch (snapshot.table_name) {
          case 'foresee_customers':
            await client.query(`INSERT INTO foresee_customers(session_id,id,name,email,status,last_active_at,created_at,updated_at,segment,chaos_case) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [row.session_id,row.id,row.name,row.email,row.status,row.last_active_at,row.created_at,row.updated_at,row.segment,row.chaos_case]); break;
          case 'foresee_subscriptions':
            await client.query(`INSERT INTO foresee_subscriptions(session_id,id,customer_id,plan,status,renewal_date,mrr) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [row.session_id,row.id,row.customer_id,row.plan,row.status,row.renewal_date,row.mrr]); break;
          case 'foresee_support_tickets':
            await client.query(`INSERT INTO foresee_support_tickets(session_id,id,customer_id,status,priority) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [row.session_id,row.id,row.customer_id,row.status,row.priority]); break;
          case 'foresee_customer_notes':
            await client.query(`INSERT INTO foresee_customer_notes(session_id,id,customer_id,content) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [row.session_id,row.id,row.customer_id,row.content]); break;
          default: throw new Error('Snapshot table is not restorable.');
        }
      }
      await client.query('COMMIT');
      await client.query(`UPDATE foresee_execution_runs SET status='manually_rolled_back', rolled_back_at=now() WHERE id=$1`, [executionId]);
      await audit(client, sessionId, 'MANUAL_ROLLBACK', { executionId, restoredRows: snapshots.rowCount });
      return { status: 'rolled_back' as const, executionId, restoredRows: snapshots.rowCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getSessionState(sessionId: string) {
  return withClient(async client => {
    await ensureSchema(client);
    await seedSession(client, sessionId);
    const state = await aggregateState(client, sessionId);
    const auditRows = await client.query(`SELECT id,event_type,metadata,created_at::text FROM foresee_audit_events WHERE session_id=$1 ORDER BY created_at DESC, id DESC LIMIT 30`, [sessionId]);
    const latestExecution = await client.query(`SELECT id,status,result,simulation_id,created_at::text FROM foresee_execution_runs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1`, [sessionId]);
    return { state, audit: auditRows.rows, latestExecution: latestExecution.rows[0] ?? null };
  });
}
