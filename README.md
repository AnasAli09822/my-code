# Foresee — Simulate Before You Act

> **See the consequences before your agent acts.**

Foresee is a safety gateway between an AI agent and high-stakes write actions. This challenge build implements one deep adapter: destructive PostgreSQL customer deletion.

**Core claim:** Foresee does not ask an LLM to imagine a mutation's consequences. It executes the candidate mutation against real PostgreSQL state inside a reversible transaction, measures the state transition, rolls it back, and only then asks a human for authority.

## Live demo

**https://br-falling-hill-b5dguwdc-foresee.compute.c-7.us-east-2.aws.neon.tech/**

No login is required. Every browser receives an isolated UUID demo session with its own seeded business state. **Reset Demo** only resets that session.

## Challenge proof in 60 seconds

1. Submit **“Delete customers who have been inactive for more than 12 months.”**
2. Foresee runs the real DELETE inside a PostgreSQL transaction, measures the consequences, and rolls it back.
3. The first simulation finds **18 customers**, including one inactive Enterprise customer that still has an active subscription. Result: **HIGH risk / $2,400 protected MRR at risk**.
4. Click **Exclude active subscriptions**. Foresee creates a new simulation: **17 customers / $0 protected MRR / LOW risk**.
5. Approve the exact simulated plan. Foresee revalidates the state fingerprint, snapshots rollback data, executes inside a transaction, verifies observed reality, and commits only if the impact stays inside the approved envelope.
6. Run **Failure Test**. A deliberately hidden PostgreSQL trigger changes `account_summary`. The simulation under-predicts the effect; the runtime verifier detects the divergence and automatically rolls the transaction back before commit.

The simulation therefore **changes the decision** rather than merely describing it.

## Architecture

```text
User / Agent
    ↓
Intent Parser
    ↓
Validated Action DSL
    ↓
Simulation Engine
    ├─ real PostgreSQL transaction
    ├─ exact target rows
    ├─ impact graph + before/after diff
    ├─ policy + deterministic risk
    ├─ uncertainty coverage
    └─ rollback plan + state fingerprint
    ↓
Simulation Report
    ↓
Human Review ── Reject / Tweak / Approve
    ↓
Execution Gateway
    ├─ immutable approved plan
    ├─ row locking
    ├─ fingerprint validation
    └─ rollback journal
    ↓
Runtime Safety Net
    ├─ observed impact matches → COMMIT
    └─ material divergence → ROLLBACK
```

Static submission asset: [`public/architecture.svg`](public/architecture.svg)

## The action DSL

The browser never sends arbitrary SQL. Natural-language intent is reduced to a constrained plan and validated with Zod:

```json
{
  "action": "delete_customers",
  "filters": {
    "inactive_days": 365,
    "exclude_active_subscriptions": false,
    "exclude_enterprise": false,
    "limit": null,
    "chaos_case_only": false
  }
}
```

The server compiles this plan into fixed, parameterized PostgreSQL queries.

## How simulation actually works

1. Load the exact candidate rows from real database state.
2. Compute the pre-action aggregate state.
3. `BEGIN ISOLATION LEVEL REPEATABLE READ`.
4. Execute the same destructive DELETE used by the real action.
5. Measure customer, subscription, MRR, ticket, note, and aggregate impact.
6. Build a row-level and aggregate before/after report.
7. `ROLLBACK` so simulation leaves business state unchanged.
8. Persist only the simulation report, policy result, expiry, and cryptographic fingerprint.

The fingerprint is SHA-256 over the normalized action plan plus relevant target primary keys, row timestamps, and subscription state. It expires after five minutes.

## Preventing simulate-then-execute drift

Approval sends **only the simulation ID**. The execution gateway does not trust a new plan from the browser.

On approval Foresee:

1. opens a `SERIALIZABLE` transaction,
2. reloads and locks relevant rows,
3. recomputes the simulation fingerprint,
4. rejects stale simulations with **Re-simulation required**,
5. serializes known affected rows into the rollback journal,
6. executes the immutable approved mutation,
7. runs broader post-action invariants,
8. commits only if observed reality fits the approved envelope.

## Explainable risk, not an AI score

Risk is deterministic. HIGH is triggered by protected relationships such as an active subscription, protected MRR, Enterprise customers, or incomplete rollback coverage. MEDIUM captures material blast radius. LOW requires no protected relationships and complete known rollback coverage.

Confidence is also not a fabricated probability. It summarizes observable coverage: transaction fidelity, schema visibility, rollback completeness, and whether effects may escape the observed dependency graph.

## Deterministic dataset

Each public session receives:

- 1,024 customers
- 18 customers inactive for more than 365 days
- exactly one inactive Enterprise customer with an active **$2,400 MRR** subscription
- 42 Enterprise customers total
- $87,400 active MRR
- support tickets and 37 customer notes
- one `Chaos Canary` customer used only by the failure test

Expected golden transition:

```text
Unsafe simulation
Customers             1,024 → 1,006   -18
Enterprise customers     42 → 41       -1
MRR                  $87,400 → $85,000 -$2,400
Risk                                     HIGH

After “Exclude active subscriptions”
Customers             1,024 → 1,007   -17
Enterprise customers     42 → 42         0
MRR                  $87,400 → $87,400   $0
Risk                                      LOW
```

Those presentation values are computed from database state, not hardcoded into the report.

## Real rollback path

Before destructive execution, Foresee journals the known customer, subscription, ticket, and note rows as serialized PostgreSQL records with restore order. **Rollback Execution** restores them in dependency-safe order. Execution status and its audit event are committed atomically with the business transaction.

## Failure test: the world model is intentionally wrong once

`Chaos Canary` has a real PostgreSQL `AFTER DELETE` trigger that unexpectedly decrements `foresee_account_summary.enterprise_customers`.

The bounded simulation intentionally excludes that summary domain from its predicted dependency graph. During approved execution, the broader verifier compares the candidate post-action reality with the approved envelope and sees:

```text
Unexpected side effect: account_summary.enterprise_customers
Safety response:       Transaction rolled back automatically
Persistent state:      UNCHANGED
```

This is deliberate: Foresee assumes simulations are useful but imperfect. **Simulation predicts; runtime verification makes prediction safe.**

## Auditability

Significant authority transitions are persisted: `SIMULATION_STARTED`, `SIMULATION_COMPLETED`, `POLICY_BLOCKED`, `ACTION_TWEAKED`, `ACTION_APPROVED`, `STATE_FINGERPRINT_FAILED`, `EXECUTION_STARTED`, `RUNTIME_DIVERGENCE`, `AUTO_ROLLBACK`, `EXECUTION_COMMITTED`, `MANUAL_ROLLBACK`, and rejection events.

## Production demo runtime

The public demo is deployed as a **Neon Function** on an isolated Neon branch with a real PostgreSQL compute. `neon-function/index.ts` imports the same `lib/engine.ts`, DSL, risk, fingerprint, rollback, and database logic as the Next.js application; the live demo is not a separate mock implementation.

The repository also contains the full Next.js App Router application and API routes for conventional hosting.

## Tech stack

- Next.js 15.5.24 Maintenance LTS + React 19
- strict TypeScript
- PostgreSQL / Neon
- `pg`
- Zod
- Neon Functions (Node.js 24) for the public deployment
- Vitest
- Playwright
- GitHub Actions

## Local setup

```bash
git clone https://github.com/AnasAli09822/my-code.git simulate-before-you-act
cd simulate-before-you-act
npm install
cp .env.example .env.local
# Set DATABASE_URL to a PostgreSQL database you control.
npm run dev
```

Schema and deterministic seed creation happen lazily on first session request. The database role needs permission to create tables, indexes, a PL/pgSQL function, and its demo trigger.

## Tests

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The suite covers:

- DSL acceptance/rejection
- deterministic risk calculation
- fingerprint determinism and state drift
- simulation leaves persistent business state unchanged
- protected Enterprise subscriber detection
- safe tweak removes protected revenue
- execution matches the approved simulation
- stale simulation rejection
- real rollback restoration
- hidden side effect detection
- automatic rollback with persistent state unchanged
- browser-level golden path and failure path

CI validates strict typechecking, unit tests, production build, and Playwright against the public deployment. The deployment workflow additionally runs the real PostgreSQL integration suite plus HTTP smoke tests against the isolated Neon branch before considering the deployment verified.

## 90-second walkthrough

Exact narration and click sequence: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)

## AI tools used

Development used **ChatGPT / GPT-5.6 Sol** for implementation, review, debugging, test design, and deployment orchestration. The live judge path does **not** depend on an LLM: its intent parser has a deterministic constrained path, so model rate limits cannot break the demo. No model invents impact values.

## Key decisions

- One deep destructive-database adapter instead of multiple shallow integrations.
- The real database is part of the world model.
- Human authority is granted to one immutable simulated state transition, not to a generic `DELETE` permission.
- Uncertainty is explicit and coverage-based.
- Runtime verification is a second safety layer, not an afterthought.
- Recovery is real and tested, not a decorative rollback button.

## Out of scope

- arbitrary browser SQL
- irreversible third-party writes
- complete simulation of unknown external APIs
- a universal database mutation language
- authentication for the public challenge sandbox

## Two-year thesis

Today, AI agents are judged mostly on whether they can successfully execute a task. As agents gain authority over production databases, money, code, communications, and infrastructure, successful execution is no longer enough. The relevant question becomes: **what world exists after this action?**

Simulation will become a standard protocol between intent and authority. Before consequential writes, agents will maintain bounded world models of the systems they control, propose a concrete state transition, estimate blast radius, surface uncertainty, prepare recovery, and request authority against that projection.

The important constraint is that simulation will never be perfectly accurate. Real systems contain triggers, races, external integrations, stale assumptions, and hidden dependencies. So simulation must be paired with runtime verification: execution should compare observed reality with the approved impact envelope and stop or reverse the write when the world diverges.

The resulting control plane is **intent → simulation → authorization → execution → verification → recovery**.

That changes the permission boundary. The question is no longer “Can this agent perform `DELETE`?” It becomes: **“Can this agent produce this specific simulated state transition under these constraints?”**

Over the next two years, that state-transition boundary will become a core primitive for trustworthy agent infrastructure. “Undo” is insufficient. Agents need pre-action consequence modeling plus post-action reality checks.
