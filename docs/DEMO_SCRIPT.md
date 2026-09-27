# 90-second Foresee walkthrough

**0–8s** — “This is Foresee. It sits between an AI agent and high-stakes writes.” Point at the pipeline: Intent → Simulate → Review → Execute → Verify.

**8–20s** — Submit: **Delete customers who have been inactive for more than 12 months.** Explain that the browser emits a constrained action DSL, never raw SQL.

**20–36s** — Show the first simulation. Explain that Foresee actually executes the DELETE against the real PostgreSQL state inside a transaction and then rolls it back. Point out **18 customers**, **1 active Enterprise subscription**, **$2,400 MRR at risk**, and **HIGH** deterministic risk.

**36–48s** — Click **Exclude active subscriptions**. The second transaction-backed simulation changes the decision: **18 → 17 customers**, protected subscriptions **1 → 0**, MRR at risk **$2,400 → $0**, risk **HIGH → LOW**.

**48–63s** — Click **Approve exact plan**. Point out immutable simulation ID, state fingerprint validation, rollback snapshot creation, transaction execution, runtime verification, then commit. Show the audit events.

**63–72s** — Show the live state: customers are now **1007** and MRR is unchanged. Click **Rollback Execution** if time permits to prove recovery.

**72–87s** — Click **Run deterministic failure test**, then approve it. Explain that a deliberately hidden PostgreSQL trigger mutates `account_summary`. The bounded simulation missed that dependency, but the broader runtime verifier sees the divergence and rolls the transaction back automatically.

**87–90s** — “Simulation predicts. Runtime verification makes prediction safe.”
