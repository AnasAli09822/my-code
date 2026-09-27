'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeleteCustomersPlan, SimulationReport } from '@/lib/types';

type SessionState = {
  state: { customers: number; enterpriseCustomers: number; mrr: number; activeSubscriptions: number; accountSummaryEnterprise: number };
  audit: Array<{ id: number; event_type: string; created_at: string; metadata: Record<string, unknown> }>;
  latestExecution: null | { id: string; status: string; result: unknown; simulation_id: string; created_at: string };
};

type ExecutionResult = {
  status: 'committed' | 'auto_rolled_back' | 'stale' | 'blocked';
  executionId?: string;
  message?: string;
  unexpected?: string[];
  prediction?: Record<string, unknown>;
  observed?: Record<string, unknown>;
  finalPersistentState?: string;
  safetyResponse?: string;
};

const DEFAULT_INTENT = 'Delete customers who have been inactive for more than 12 months.';
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value); }
function classNames(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(' '); }

export default function Home() {
  const [sessionId, setSessionId] = useState('');
  const [intent, setIntent] = useState(DEFAULT_INTENT);
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'golden' | 'failure'>('golden');

  useEffect(() => {
    const stored = window.localStorage.getItem('foresee-session-id');
    const id = stored || crypto.randomUUID();
    window.localStorage.setItem('foresee-session-id', id);
    setSessionId(id);
  }, []);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', 'x-foresee-session': sessionId, ...(init?.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || 'Request failed.');
    return data as T;
  }, [sessionId]);

  const refreshState = useCallback(async () => {
    if (!sessionId) return;
    try { setSession(await api<SessionState>('/api/state')); }
    catch (e) { setError(e instanceof Error ? e.message : 'State unavailable.'); }
  }, [api, sessionId]);
  useEffect(() => { void refreshState(); }, [refreshState]);

  async function createAndSimulate() {
    setBusy('simulate'); setError(null); setExecution(null); setMode('golden');
    try {
      const parsed = await api<{ plan: DeleteCustomersPlan }>('/api/action', { method: 'POST', body: JSON.stringify({ intent }) });
      setReport(await api<SimulationReport>('/api/simulate', { method: 'POST', body: JSON.stringify({ plan: parsed.plan }) }));
      await refreshState();
    } catch (e) { setError(e instanceof Error ? e.message : 'Simulation failed.'); }
    finally { setBusy(null); }
  }

  async function tweak(label: 'subscriptions' | 'enterprise' | 'threshold' | 'limit') {
    if (!report) return;
    const plan: DeleteCustomersPlan = structuredClone(report.plan);
    if (label === 'subscriptions') plan.filters.exclude_active_subscriptions = true;
    if (label === 'enterprise') plan.filters.exclude_enterprise = true;
    if (label === 'threshold') plan.filters.inactive_days = 540;
    if (label === 'limit') plan.filters.limit = 10;
    setBusy('tweak'); setError(null); setExecution(null);
    try {
      setReport(await api<SimulationReport>('/api/tweak', { method: 'POST', body: JSON.stringify({ simulationId: report.id, plan }) }));
      await refreshState();
    } catch (e) { setError(e instanceof Error ? e.message : 'Tweak failed.'); }
    finally { setBusy(null); }
  }

  async function approve() {
    if (!report) return;
    setBusy('execute'); setError(null);
    try { setExecution(await api<ExecutionResult>('/api/execute', { method: 'POST', body: JSON.stringify({ simulationId: report.id }) })); await refreshState(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Execution failed.'); await refreshState(); }
    finally { setBusy(null); }
  }

  async function reject() {
    if (!report) return;
    setBusy('reject'); setError(null);
    try {
      await api('/api/reject', { method: 'POST', body: JSON.stringify({ simulationId: report.id }) });
      setExecution({ status: 'blocked', message: 'Action rejected by human reviewer. No mutation executed.' });
      await refreshState();
    } catch (e) { setError(e instanceof Error ? e.message : 'Reject failed.'); }
    finally { setBusy(null); }
  }

  async function rollback() {
    if (!execution?.executionId) return;
    setBusy('rollback'); setError(null);
    try {
      await api('/api/rollback', { method: 'POST', body: JSON.stringify({ executionId: execution.executionId }) });
      setExecution({ status: 'blocked', message: 'Rollback complete. Deleted rows and known dependencies were restored.' });
      await refreshState();
    } catch (e) { setError(e instanceof Error ? e.message : 'Rollback failed.'); }
    finally { setBusy(null); }
  }

  async function resetDemo() {
    setBusy('reset'); setError(null);
    try {
      await api('/api/reset', { method: 'POST', body: '{}' });
      setReport(null); setExecution(null); setMode('golden'); setIntent(DEFAULT_INTENT); await refreshState();
    } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed.'); }
    finally { setBusy(null); }
  }

  async function runFailureTest() {
    setBusy('failure'); setError(null); setExecution(null); setMode('failure');
    try {
      const parsed = await api<{ plan: DeleteCustomersPlan }>('/api/action', { method: 'POST', body: JSON.stringify({ scenario: 'failure' }) });
      setReport(await api<SimulationReport>('/api/simulate', { method: 'POST', body: JSON.stringify({ plan: parsed.plan }) }));
      await refreshState();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failure test setup failed.'); }
    finally { setBusy(null); }
  }

  const canApprove = report?.policy.allowed && !busy;
  const delta = useMemo(() => report ? {
    customers: report.projected.customers - report.before.customers,
    enterprise: report.projected.enterpriseCustomers - report.before.enterpriseCustomers,
    mrr: report.projected.mrr - report.before.mrr,
    activeSubscriptions: report.projected.activeSubscriptions - report.before.activeSubscriptions,
  } : null, [report]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandblock"><div className="mark">F</div><div><strong>Foresee</strong><span>See the consequences before your agent acts.</span></div></div>
        <div className="top-actions"><span className="db-pill"><i /> PostgreSQL world model</span><button className="button ghost" onClick={resetDemo} disabled={!!busy}>Reset Demo</button></div>
      </header>
      <section className="pipeline" aria-label="execution pipeline">
        {['Intent', 'Simulate', 'Review', 'Execute', 'Verify'].map((item, index) => <div className={classNames('pipe-step', report && index <= 2 && 'active', execution && index >= 3 && 'active')} key={item}><span>{index + 1}</span>{item}{index < 4 && <b>→</b>}</div>)}
      </section>
      {error && <div className="error-banner"><strong>Safe failure</strong><span>{error}</span></div>}
      <section className="action-card panel">
        <div className="section-kicker">REQUESTED ACTION</div>
        <div className="action-grid">
          <div className="intent-wrap"><label htmlFor="intent">Agent intent</label><input id="intent" value={intent} onChange={e => setIntent(e.target.value)} disabled={!!busy || mode === 'failure'} /></div>
          <div className="meta"><span>Target system</span><strong>Neon / PostgreSQL</strong></div>
          <div className="meta"><span>Write class</span><strong>Destructive DELETE</strong></div>
          <div className="meta"><span>Status</span><strong className={report ? (report.risk === 'HIGH' ? 'risk-high-text' : 'risk-low-text') : ''}>{busy ? 'Working…' : report ? `${report.risk} risk` : 'Not simulated'}</strong></div>
          <button className="button primary" onClick={createAndSimulate} disabled={!!busy}>{busy === 'simulate' ? 'Running transaction…' : 'Simulate before acting'}</button>
        </div>
      </section>
      {!report ? <section className="empty-state panel"><div className="transaction-icon">BEGIN<br/><b>DELETE</b><br/>ROLLBACK</div><div><h1>Execute the mutation without committing it.</h1><p>Foresee uses the database as the simulator: it runs the candidate write against real state inside a reversible transaction, measures the state transition, then rolls it back before authority is granted.</p></div></section> : <>
        <section className="review-grid">
          <article className="panel risk-panel">
            <div className="section-head"><div><div className="section-kicker">SIMULATION RESULT</div><h2>{mode === 'failure' ? 'Hidden-side-effect test' : `Delete customers inactive > ${report.plan.filters.inactive_days} days`}</h2></div><span className={classNames('risk-badge', report.risk.toLowerCase())}>{report.risk}</span></div>
            <div className="metric-row"><div><span>Confidence</span><strong>{report.confidence}%</strong></div><div><span>Customers</span><strong>{report.impact.customersDeleted}</strong></div><div><span>MRR at risk</span><strong>{money(report.impact.mrrAtRisk)}</strong></div><div><span>Open tickets</span><strong>{report.impact.openTicketsAffected}</strong></div></div>
            <div className="explanation"><strong>{report.risk === 'HIGH' ? 'Why this is unsafe' : 'Why this is inside policy'}</strong><ul>{report.riskReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
            {report.policy.violations.length > 0 && <div className="policy"><span>Policy violations</span>{report.policy.violations.map(v => <code key={v}>{v}</code>)}</div>}
          </article>
          <article className="panel confidence-panel"><div className="section-kicker">UNCERTAINTY</div><h2>Coverage, not fake certainty</h2><div className="confidence-bar"><i style={{ width: `${report.confidence}%` }} /></div>{report.confidenceSignals.map(signal => <div className="signal" key={signal.label}><span className={signal.covered ? 'ok-dot' : 'warn-dot'} /><div><strong>{signal.label}</strong><small>{signal.detail}</small></div></div>)}<details><summary>Known unknowns</summary><ul>{report.knownUnknowns.map(item => <li key={item}>{item}</li>)}</ul></details></article>
        </section>
        <section className="panel diff-panel"><div className="section-head"><div><div className="section-kicker">BEFORE → AFTER</div><h2>Projected state transition</h2></div><span className="transaction-pill">sandbox transaction rolled back</span></div><div className="diff-grid"><Diff label="Customers" before={report.before.customers} after={report.projected.customers} delta={delta?.customers ?? 0} /><Diff label="Enterprise customers" before={report.before.enterpriseCustomers} after={report.projected.enterpriseCustomers} delta={delta?.enterprise ?? 0} /><Diff label="Active subscriptions" before={report.before.activeSubscriptions} after={report.projected.activeSubscriptions} delta={delta?.activeSubscriptions ?? 0} /><Diff label="MRR" before={money(report.before.mrr)} after={money(report.projected.mrr)} delta={money(delta?.mrr ?? 0)} danger={(delta?.mrr ?? 0) < 0} /></div></section>
        <section className="records-layout">
          <article className="panel records-panel"><div className="section-head"><div><div className="section-kicker">AFFECTED RECORDS</div><h2>Real rows in the blast radius</h2></div><span>{report.targets.length} rows</span></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Segment</th><th>Last active</th><th>Subscription</th><th>MRR</th><th>Decision</th></tr></thead><tbody>{report.targets.slice(0, 20).map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.segment}</td><td>{new Date(row.last_active_at).toLocaleDateString()}</td><td>{row.active_subscription_count ? `${row.active_subscription_count} active` : 'None'}</td><td>{money(row.active_mrr)}</td><td><span className="delete-tag">DELETE</span></td></tr>)}</tbody></table></div>{report.targets.length > 20 && <div className="table-note">Showing first 20 of {report.targets.length} deterministic targets.</div>}</article>
          <aside className="panel rollback-panel"><div className="section-kicker">ROLLBACK PLAN</div><h2>Restore bundle</h2><div className="snapshot-id">snapshot prepared on approval<br/><code>{report.id.slice(0, 8)}…</code></div><ul className="restore-list"><li><span>Customer records</span><strong>{report.rollbackPlan.customers}</strong></li><li><span>Subscriptions</span><strong>{report.rollbackPlan.subscriptions}</strong></li><li><span>Tickets</span><strong>{report.rollbackPlan.tickets}</strong></li><li><span>Notes</span><strong>{report.rollbackPlan.notes}</strong></li><li><span>Restore operations</span><strong>{report.rollbackPlan.estimatedRestoreOperations}</strong></li></ul><p>Rows are serialized before destructive execution and restored in dependency order.</p></aside>
        </section>
        {mode === 'golden' && <section className="panel tweak-panel"><div><div className="section-kicker">TWEAK</div><h2>Change the decision, then re-simulate</h2><p>The original plan is immutable. Every tweak creates a new simulation and fingerprint.</p></div><div className="chips"><button onClick={() => tweak('subscriptions')} disabled={!!busy || report.plan.filters.exclude_active_subscriptions}>Exclude active subscriptions</button><button onClick={() => tweak('enterprise')} disabled={!!busy || report.plan.filters.exclude_enterprise}>Exclude Enterprise accounts</button><button onClick={() => tweak('threshold')} disabled={!!busy || report.plan.filters.inactive_days === 540}>Require 540 days inactivity</button><button onClick={() => tweak('limit')} disabled={!!busy || report.plan.filters.limit === 10}>Limit to 10 records</button></div></section>}
        <section className="decision-bar panel"><div><div className="section-kicker">HUMAN DECISION</div><strong>{report.policy.allowed ? 'Plan is inside the approved impact envelope.' : 'Policy requires a safer simulation before execution.'}</strong></div><div className="decision-actions"><button className="button reject" onClick={reject} disabled={!!busy}>Reject</button><button className="button tweak-action" onClick={() => mode === 'golden' && tweak('subscriptions')} disabled={!!busy || mode === 'failure'}>Tweak</button><button className="button approve" onClick={approve} disabled={!canApprove}>{busy === 'execute' ? 'Verifying…' : 'Approve exact plan'}</button></div></section>
      </>}
      {execution && <section className={classNames('panel execution-result', execution.status === 'auto_rolled_back' ? 'diverged' : execution.status === 'committed' ? 'committed' : '')}><div className="section-kicker">RUNTIME VERIFICATION</div>{execution.status === 'committed' && <><h2>EXECUTION COMMITTED</h2><p>The observed state matched the approved simulation fingerprint and impact envelope.</p><button className="button rollback" onClick={rollback} disabled={!!busy}>Rollback Execution</button></>}{execution.status === 'auto_rolled_back' && <><h2>EXECUTION BLOCKED</h2><p>Simulation divergence detected. The transaction was rolled back automatically before commit.</p><div className="divergence-grid"><div><span>Unexpected side effect</span><strong>{execution.unexpected?.join(', ')}</strong></div><div><span>Safety response</span><strong>{execution.safetyResponse}</strong></div><div><span>Final persistent state</span><strong>{execution.finalPersistentState}</strong></div></div></>}{(execution.status === 'blocked' || execution.status === 'stale') && <><h2>{execution.status === 'stale' ? 'RE-SIMULATION REQUIRED' : 'NO WRITE EXECUTED'}</h2><p>{execution.message}</p></>}</section>}
      <section className="bottom-grid">
        <article className="panel audit-panel"><div className="section-head"><div><div className="section-kicker">AUDIT TRAIL</div><h2>Every authority transition is recorded</h2></div><button className="text-button" onClick={refreshState}>Refresh</button></div><div className="timeline">{session?.audit?.length ? session.audit.map(event => <div className="event" key={event.id}><i /><div><strong>{event.event_type}</strong><small>{new Date(event.created_at).toLocaleTimeString()}</small></div></div>) : <p>No events yet.</p>}</div></article>
        <article className="panel failure-panel"><div className="section-kicker">FAILURE TEST</div><h2>Prove the world model can be wrong safely.</h2><p>A hidden PostgreSQL trigger mutates <code>account_summary</code>. The bounded simulation intentionally does not observe that domain. Runtime verification does.</p><div className="failure-flow"><span>Simulation predicts</span><b>→</b><span>Execution diverges</span><b>→</b><span>Auto rollback</span></div><button className="button danger" onClick={runFailureTest} disabled={!!busy}>{busy === 'failure' ? 'Preparing…' : 'Run deterministic failure test'}</button></article>
      </section>
      <section className="panel architecture" id="architecture"><div className="section-kicker">ARCHITECTURE SNAPSHOT</div><h2>Intent → simulation → authority → verification → recovery</h2><div className="arch-flow">{['User / Agent','Intent Parser','Validated DSL','Simulation Engine','Human Review','Execution Gateway','Runtime Safety Net','Commit / Rollback'].map((n,i)=><div key={n} className="arch-node"><span>{n}</span>{i<7 && <b>→</b>}</div>)}</div><div className="arch-sub"><span>Real DB transaction</span><span>Impact graph</span><span>Policy + risk</span><span>Fingerprint</span><span>Rollback journal</span><span>Divergence detector</span></div></section>
      <footer><strong>Foresee</strong><span>Simulation predicts. Runtime verification makes prediction safe.</span><a href="/architecture.svg" target="_blank">Export architecture ↗</a></footer>
    </main>
  );
}

function Diff({ label, before, after, delta, danger = false }: { label: string; before: string | number; after: string | number; delta: string | number; danger?: boolean }) {
  const d = typeof delta === 'number' ? `${delta > 0 ? '+' : ''}${delta}` : delta;
  return <div className="diff-card"><span>{label}</span><div><strong>{before}</strong><b>→</b><strong>{after}</strong></div><em className={danger || String(d).startsWith('-') ? 'negative' : 'neutral'}>{d}</em></div>;
}
