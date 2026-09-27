# Foresee — Simulate Before You Act

> **See the consequences before your agent acts.**

Foresee is a simulation gateway between an AI agent and high-stakes write actions. For this challenge, it implements one production-grade adapter: destructive PostgreSQL customer deletion.

**Thesis:** Foresee does not ask an LLM to imagine the result of a database mutation. It runs the mutation against real PostgreSQL state inside a reversible transaction, measures the consequences, rolls it back, and only then asks a human for authority.

## Challenge proof

The golden path intentionally starts unsafe. “Delete customers inactive for more than 12 months” selects 18 real rows, including one inactive customer that still has an active Enterprise subscription worth $2,400 MRR. The first simulation is HIGH risk. A one-click constrained tweak — **Exclude active subscriptions** — produces a new simulation: 17 rows, $0 protected MRR at risk, LOW risk. Simulation changed the decision.

The failure test proves the world model is not omniscient. A hidden PostgreSQL trigger mutates `account_summary`; the bounded simulation does not observe that domain. During real execution, the broader runtime verifier sees the unexpected mutation and rolls the transaction back before commit.

## Architecture

```text
User / Agent → Intent Parser → Validated Action DSL → Simulation Engine → Human Review
Simulation Engine: real PostgreSQL transaction + impact graph + policy/risk + rollback plan + fingerprint
Human Review: Reject / Tweak / Approve
Approve → Execution Gateway → Runtime Safety Net → Commit | Rollback
```

Static snapshot: [`public/architecture.svg`](public/architecture.svg)

## How simulation actually works

1. Intent maps to a constrained `delete_customers` DSL. The browser can never submit arbitrary SQL.
2. The server validates the DSL with Zod and compiles fixed parameterized PostgreSQL queries.
3. Foresee opens `REPEATABLE READ`, loads exact target rows, executes the candidate `DELETE`, measures state, and calls `ROLLBACK`.
4. It computes an explainable risk result and coverage-based confidence.
5. It stores a SHA-256 fingerprint of normalized plan, target keys, row timestamps, subscription state, and expiry.
6. Approval sends only the simulation ID. The server reloads the immutable plan, locks relevant rows, recomputes the fingerprint, and rejects stale simulations.
7. Known affected rows are serialized into a rollback journal before destructive execution.
8. A broader post-action verifier compares candidate reality with the approved impact envelope. Match commits; divergence rolls back.

## Safety architecture

- Constrained DSL; no browser SQL.
- Real transaction simulation, not mock JSON.
- Active subscriptions, protected MRR, and Enterprise accounts force HIGH risk.
- Fingerprint + five-minute expiry prevents simulate-then-execute drift.
- Execution trusts only the persisted plan for a simulation ID.
- Rollback journal serializes customers and dependent rows before commit.
- Runtime verification checks counts, MRR, subscription integrity, and the broader summary domain.
- Each public reviewer gets an isolated UUID sandbox; reset affects only that session.
- Authority transitions are persisted in the audit trail.

## Deterministic dataset

Each session receives 1,024 customers. Eighteen are inactive beyond 365 days. Exactly one of those is an Enterprise customer with an active $2,400 subscription. Remaining active subscriptions bring total MRR to $87,400.

```text
Unsafe: Customers 1,024 → 1,006 | Enterprise 42 → 41 | MRR $87,400 → $85,000
Tweaked: Customers 1,024 → 1,007 | Enterprise 42 → 42 | MRR $87,400 → $87,400
```

These values are computed from database state, not hardcoded presentation values.

## Failure test

`Chaos Canary` has a deliberately hidden `AFTER DELETE` trigger that decrements `foresee_account_summary.enterprise_customers`, a domain excluded from the bounded simulation model. The sandbox DELETE really fires the trigger, but the predicted envelope intentionally omits that mutation. During approved execution, the broader verifier sees the divergence, emits `RUNTIME_DIVERGENCE`, rolls back the transaction, and records `AUTO_ROLLBACK`. Persistent business state remains unchanged.

## Tech stack

Next.js 15 App Router, React 19, strict TypeScript, PostgreSQL/Neon-compatible `pg`, Zod, Vitest, Playwright, Vercel Node runtime.

## Local setup

```bash
git clone <repository-url>
cd simulate-before-you-act
npm install
cp .env.example .env.local
# set DATABASE_URL
npm run dev
```

Schema and seed creation are lazy on first request. The DB role needs permission to create tables, indexes, a PL/pgSQL function, and a trigger.

## Tests

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Coverage includes DSL validation, deterministic risk, fingerprint drift, transaction non-persistence, protected-customer detection, safe tweak execution, manual rollback, stale simulation blocking, and hidden-side-effect auto rollback.

## 90-second demo

Exact narration and click path: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)

## AI tools used

Development used ChatGPT / GPT-5.6 Sol for implementation and review. The live product does **not** require an LLM for the golden path; the intent parser uses a deterministic fallback so judges are not exposed to model rate limits. No model invents impact values.

## Key decisions

One deep adapter over several shallow ones; the database is the simulator; authority is granted to an immutable state transition; confidence represents coverage, not fabricated probability; runtime divergence handling is a first-class safety layer.

## Limitations / out of scope

Arbitrary SQL, irreversible third-party APIs, complete modeling of unknown external integrations, general-purpose DB migration planning, and authentication. The challenge demo uses isolated disposable sessions instead.

## Two-year thesis

Today, AI agents are judged mostly on whether they can successfully execute a task. As agents gain authority over production databases, money, code, communications, and infrastructure, successful execution is no longer enough. The relevant question becomes: **what world exists after this action?**

Simulation will become a standard protocol between intent and authority. Before consequential writes, agents will maintain bounded world models of the systems they control, propose a concrete state transition, estimate blast radius, surface uncertainty, prepare recovery, and request authority against that projection.

The important constraint is that simulation will never be perfectly accurate. Real systems contain triggers, races, external integrations, stale assumptions, and hidden dependencies. So simulation must be paired with runtime verification: execution should compare observed reality with the approved impact envelope and stop or reverse the write when the world diverges.

The resulting control plane is **intent → simulation → authorization → execution → verification → recovery**.

That changes the permission boundary. The question is no longer “Can this agent perform `DELETE`?” It becomes: **“Can this agent produce this specific simulated state transition under these constraints?”**

Over the next two years, that state-transition boundary will become a core primitive for trustworthy agent infrastructure. “Undo” is insufficient. Agents need pre-action consequence modeling plus post-action reality checks.
