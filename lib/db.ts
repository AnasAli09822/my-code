import { Pool, PoolClient } from 'pg';

let pool: Pool | undefined;

export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 4,
    });
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try { return await fn(client); }
  finally { client.release(); }
}

export async function ensureSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS foresee_customers (
      session_id uuid NOT NULL,
      id text NOT NULL,
      name text NOT NULL,
      email text NOT NULL,
      status text NOT NULL,
      last_active_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      segment text NOT NULL,
      chaos_case boolean NOT NULL DEFAULT false,
      PRIMARY KEY (session_id, id)
    );
    CREATE TABLE IF NOT EXISTS foresee_subscriptions (
      session_id uuid NOT NULL,
      id text NOT NULL,
      customer_id text NOT NULL,
      plan text NOT NULL,
      status text NOT NULL,
      renewal_date date NOT NULL,
      mrr integer NOT NULL CHECK (mrr >= 0),
      PRIMARY KEY (session_id, id),
      FOREIGN KEY (session_id, customer_id) REFERENCES foresee_customers(session_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS foresee_support_tickets (
      session_id uuid NOT NULL,
      id text NOT NULL,
      customer_id text NOT NULL,
      status text NOT NULL,
      priority text NOT NULL,
      PRIMARY KEY (session_id, id),
      FOREIGN KEY (session_id, customer_id) REFERENCES foresee_customers(session_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS foresee_customer_notes (
      session_id uuid NOT NULL,
      id text NOT NULL,
      customer_id text NOT NULL,
      content text NOT NULL,
      PRIMARY KEY (session_id, id),
      FOREIGN KEY (session_id, customer_id) REFERENCES foresee_customers(session_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS foresee_account_summary (
      session_id uuid PRIMARY KEY,
      active_customers integer NOT NULL,
      enterprise_customers integer NOT NULL,
      mrr integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS foresee_simulation_runs (
      id uuid PRIMARY KEY,
      session_id uuid NOT NULL,
      plan jsonb NOT NULL,
      report jsonb NOT NULL,
      fingerprint text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS foresee_execution_runs (
      id uuid PRIMARY KEY,
      session_id uuid NOT NULL,
      simulation_id uuid NOT NULL REFERENCES foresee_simulation_runs(id),
      status text NOT NULL,
      result jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      committed_at timestamptz,
      rolled_back_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS foresee_rollback_snapshots (
      id bigserial PRIMARY KEY,
      session_id uuid NOT NULL,
      execution_id uuid NOT NULL REFERENCES foresee_execution_runs(id) ON DELETE CASCADE,
      table_name text NOT NULL,
      row_id text NOT NULL,
      serialized_row jsonb NOT NULL,
      restore_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS foresee_audit_events (
      id bigserial PRIMARY KEY,
      session_id uuid NOT NULL,
      event_type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION foresee_hidden_chaos_side_effect()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.chaos_case THEN
        UPDATE foresee_account_summary
          SET enterprise_customers = enterprise_customers - 1,
              updated_at = now()
        WHERE session_id = OLD.session_id;
      END IF;
      RETURN OLD;
    END;
    $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'foresee_chaos_customer_delete') THEN
        CREATE TRIGGER foresee_chaos_customer_delete
          AFTER DELETE ON foresee_customers
          FOR EACH ROW EXECUTE FUNCTION foresee_hidden_chaos_side_effect();
      END IF;
    END;
    $$;
    CREATE INDEX IF NOT EXISTS foresee_customers_session_active_idx ON foresee_customers(session_id, last_active_at);
    CREATE INDEX IF NOT EXISTS foresee_subscriptions_customer_idx ON foresee_subscriptions(session_id, customer_id, status);
    CREATE INDEX IF NOT EXISTS foresee_tickets_customer_idx ON foresee_support_tickets(session_id, customer_id, status);
    CREATE INDEX IF NOT EXISTS foresee_notes_customer_idx ON foresee_customer_notes(session_id, customer_id);
    CREATE INDEX IF NOT EXISTS foresee_audit_session_idx ON foresee_audit_events(session_id, created_at DESC);
  `);
}

export async function audit(client: PoolClient, sessionId: string, eventType: string, metadata: Record<string, unknown> = {}) {
  await client.query(`INSERT INTO foresee_audit_events(session_id, event_type, metadata) VALUES ($1, $2, $3::jsonb)`, [sessionId, eventType, JSON.stringify(metadata)]);
}

export async function sessionExists(client: PoolClient, sessionId: string) {
  const result = await client.query(`SELECT 1 FROM foresee_customers WHERE session_id = $1 LIMIT 1`, [sessionId]);
  return result.rowCount === 1;
}

export async function seedSession(client: PoolClient, sessionId: string) {
  const exists = await sessionExists(client, sessionId);
  if (exists) return;
  await client.query('BEGIN');
  try {
    await client.query(`
      INSERT INTO foresee_customers(session_id, id, name, email, status, last_active_at, created_at, updated_at, segment, chaos_case)
      SELECT $1::uuid,
        'cust-' || lpad(gs::text, 4, '0'),
        CASE WHEN gs = 1 THEN 'Northstar Systems' WHEN gs = 1024 THEN 'Chaos Canary' ELSE 'Customer ' || gs END,
        'customer' || gs || '@example.test', 'active',
        CASE WHEN gs <= 18 THEN now() - interval '500 days' ELSE now() - ((gs % 120) || ' days')::interval END,
        now() - interval '800 days', now() - ((gs % 30) || ' minutes')::interval,
        CASE WHEN gs = 1 OR (gs BETWEEN 19 AND 59) THEN 'Enterprise' ELSE 'SMB' END,
        gs = 1024
      FROM generate_series(1, 1024) gs;
    `, [sessionId]);
    await client.query(`INSERT INTO foresee_subscriptions(session_id, id, customer_id, plan, status, renewal_date, mrr) VALUES ($1, 'sub-enterprise-risk', 'cust-0001', 'Enterprise', 'active', current_date + 21, 2400)`, [sessionId]);
    await client.query(`
      INSERT INTO foresee_subscriptions(session_id, id, customer_id, plan, status, renewal_date, mrr)
      SELECT $1::uuid, 'sub-' || lpad(gs::text, 4, '0'), 'cust-' || lpad(gs::text, 4, '0'),
             CASE WHEN gs <= 59 THEN 'Enterprise' ELSE 'Growth' END,
             'active', current_date + ((gs % 28) + 1), 1000
      FROM generate_series(19, 103) gs;
    `, [sessionId]);
    await client.query(`
      INSERT INTO foresee_support_tickets(session_id, id, customer_id, status, priority) VALUES
        ($1, 'ticket-01', 'cust-0002', 'open', 'high'),
        ($1, 'ticket-02', 'cust-0006', 'open', 'medium'),
        ($1, 'ticket-03', 'cust-0011', 'open', 'low'),
        ($1, 'ticket-04', 'cust-0017', 'open', 'medium'),
        ($1, 'ticket-05', 'cust-0020', 'closed', 'low')
    `, [sessionId]);
    await client.query(`
      INSERT INTO foresee_customer_notes(session_id, id, customer_id, content)
      SELECT $1::uuid, 'note-' || lpad(gs::text, 3, '0'),
             'cust-' || lpad((((gs - 1) % 18) + 1)::text, 4, '0'), 'Account note ' || gs
      FROM generate_series(1, 37) gs;
    `, [sessionId]);
    await client.query(`INSERT INTO foresee_account_summary(session_id, active_customers, enterprise_customers, mrr) VALUES ($1, 1024, 42, 87400)`, [sessionId]);
    await audit(client, sessionId, 'DEMO_SESSION_CREATED', { customers: 1024, mrr: 87400 });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function resetSession(client: PoolClient, sessionId: string) {
  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM foresee_rollback_snapshots WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_execution_runs WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_simulation_runs WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_audit_events WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_customer_notes WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_support_tickets WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_subscriptions WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_customers WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM foresee_account_summary WHERE session_id = $1`, [sessionId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  await seedSession(client, sessionId);
}
