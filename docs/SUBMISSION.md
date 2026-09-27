# Doo Challenge Submission — Simulate Before You Act

## Project

**Foresee** — *See the consequences before your agent acts.*

## Live demo

https://br-falling-hill-b5dguwdc-foresee.compute.c-7.us-east-2.aws.neon.tech/

## Repository

https://github.com/AnasAli09822/my-code

## What to look at

Foresee's simulation is an actual reversible PostgreSQL state transition, not an LLM-generated explanation. The system executes the candidate DELETE against real Neon/PostgreSQL state inside a transaction, measures the resulting blast radius, and rolls it back before a human decides.

The clearest demo is the decision change: the initial request targets 18 inactive customers but unexpectedly includes an active Enterprise subscriber with $2,400 MRR, so risk is HIGH. Clicking **Exclude active subscriptions** creates a new transaction-backed simulation with 17 targets, $0 protected MRR at risk, and LOW risk. Only that exact simulated plan can be approved.

## Technical depth

- constrained, Zod-validated action DSL; no arbitrary browser SQL
- parameterized server-side query compiler
- real PostgreSQL transaction simulation + rollback
- row-level and aggregate before/after diff
- deterministic, explainable policy/risk engine
- coverage-based uncertainty rather than a fabricated AI probability
- SHA-256 state fingerprint + expiration to prevent simulate-then-execute drift
- immutable approved plan execution with row locking
- real rollback journal and manual restore path
- post-action runtime verifier and impact envelope
- per-reviewer isolated demo sessions
- persisted audit trail

## Failure test

The `Chaos Canary` customer has a real hidden PostgreSQL `AFTER DELETE` trigger that changes `account_summary.enterprise_customers`. The bounded simulation intentionally does not predict that domain. During approved execution, the broader runtime verifier detects the unexpected mutation and rolls the transaction back before commit.

Result shown in the product:

- **EXECUTION BLOCKED**
- Unexpected side effect: `account_summary.enterprise_customers`
- Safety response: transaction rolled back automatically
- Persistent state: **UNCHANGED**

This is intentional: Foresee does not pretend its world model is omniscient.

## Architecture

`User / Agent → Intent Parser → Validated Action DSL → Simulation Engine → Human Review → Execution Gateway → Runtime Safety Net → Commit | Rollback`

Architecture snapshot: `public/architecture.svg`

## AI tools used

Development used **ChatGPT / GPT-5.6 Sol** for implementation, review, debugging, test design, and deployment orchestration. The live golden path itself is deterministic and does not depend on an LLM or model quota. No model invents database impact values.

## Key decisions

1. Build one deep destructive-database adapter rather than several superficial integrations.
2. Use the real database as part of the simulator.
3. Authorize an exact simulated state transition, not a generic destructive capability.
4. Treat simulation as bounded and imperfect, then add runtime verification as a second safety layer.
5. Make rollback executable and tested rather than decorative.

## Out of scope

- arbitrary SQL execution from the browser
- irreversible external API writes
- complete modeling of unknown third-party side effects
- a universal mutation DSL
- authentication for the disposable public challenge sandbox

## Verification

Verified flows include: strict TypeScript build, unit tests, real PostgreSQL integration tests, production build, live HTTP golden path, manual rollback, hidden-side-effect auto rollback, and browser-level visual/functional acceptance of the public URL.

## 90-second walkthrough

The exact script and click sequence are in `docs/DEMO_SCRIPT.md`.

No Loom URL is included here because no Loom recording was created; do not substitute a fabricated video link.
