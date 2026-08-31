---
status: accepted
date: 2026-08-31
---

# 0002. Postgres as the source of truth

## Context

The first product surface is a dashboard of user-arranged widgets, where widgets are eventually
third-party plugins. Two things had to be settled before any of it could be written: where
authority over data lives, and where the widget catalogue lives.

Constraints that were real at the time of writing:

- **EU hosting is non-negotiable.** Biotech customers ask about residency, and a US-jurisdiction
  managed database reopens the Schrems II conversation on every security questionnaire.
- **Dashboards are personal.** One owner per dashboard, no sharing, no per-user overrides.
- **Widgets will be third-party**, but are all first-party today.
- Existing house experience is Next.js + Scaleway + Terraform (`riemerFYI`, `DeStatushouders`),
  historically with Supabase supplying Postgres, auth and row-level security.

## Options

**Supabase (hosted).** Everything already known, nothing to build. Rejected on residency: the
hosted product's footprint reopens the jurisdiction question.

**Supabase (self-hosted on Scaleway).** Proven in `DeStatushouders/Sarah/infra/supabase-selfhost`.
Fixes residency. Rejected because it carries a twelve-service compose stack (kong, gotrue, realtime,
storage, imgproxy, supavisor, …) to obtain features this product does not use, and the operational
surface is ours to run either way.

**Neon.** Real EU regions, excellent developer experience, but a US company. Same questionnaire
problem as hosted Supabase, with less name recognition to defend it.

**Scaleway Managed PostgreSQL.** French company, French jurisdiction, and it slots into Terraform
already written in-house. Plain Postgres — no BaaS layer, so authentication becomes ours to build.
**Chosen.**

The second, larger fork was *where the rules live*: enforced in the API layer (the conventional
TypeScript-first arrangement — Drizzle, `where owner_id = ?` in every resolver), or enforced in the
database (row-level security, constraints, a table-backed plugin catalogue).

## Decision

Scaleway Managed PostgreSQL in `fr-par`, and **the database is authoritative**:

1. **Row-level security, not resolver discipline.** Every policy reads
   `app.current_user_id()`, which the API sets per transaction with
   `set_config('app.user_id', …, is_local => true)`. The application connects as
   `bluedoor_app` — not the instance admin, not the table owner, and `FORCE ROW LEVEL SECURITY`
   closes the owner bypass. Migrations run as the admin role; the runtime role owns nothing and
   cannot DDL.
2. **Schema is SQL; TypeScript types are derived from it.** Plain `.sql` migrations are the
   artifact. `kysely-codegen` introspects the live database to produce `web/src/lib/db-types.ts`.
   This is why Kysely rather than Drizzle: Drizzle's model is TypeScript-as-source, which is the
   exact inversion of this decision.
3. **The plugin catalogue is a table.** `widget_types` holds what exists, its version, its size
   defaults and its config JSON Schema. The frontend registry answers only "given a type, which
   component?". Installing a widget is an INSERT, not a redeploy.
4. **The widget host contract is async and serialisable from day one** — see
   [../engineering/widget-contract.md](../engineering/widget-contract.md).

## Consequences

What this buys:

- A forgotten `where` clause returns nothing rather than another tenant's data. **VERIFIED**
  2026-08-31 against the local instance: with no identity set the app role sees zero dashboards;
  cross-user INSERT is rejected by the policy's `WITH CHECK`; cross-user DELETE reports zero rows.
- A migration cannot drift from the types, because the types are generated from the migrated
  database.
- New widget types need no frontend deploy to appear in the picker.

What it costs:

- **Auth is ours to build.** Dropping the BaaS drops GoTrue with it.
  `web/src/server/session.ts` is a stub that throws in production. Better Auth is the intended
  replacement — it stores sessions in this same Postgres — but nothing is wired up.
  **OPEN:** confirmed choice not yet made.
- **RLS has sharp edges that must not be forgotten.** `SET LOCAL` rather than `SET` (a pooled
  connection would otherwise carry identity into the next request); `security_invoker = true` on
  every view (a view without it runs as its owner and bypasses all of this); a runtime role that is
  never the table owner.
- **Config validation lives in the API, not the database.** The intent was a check constraint using
  `pg_jsonschema`. That extension is not on Scaleway's managed allowlist, so Ajv compiles
  `widget_types.config_schema` server-side instead, and the database only enforces
  `jsonb_typeof(config) = 'object'`. This is the one place the decision is not honoured, and it is a
  deliberate concession to managed hosting. **ASSUMED** — the allowlist was not re-checked against
  Scaleway's current documentation on 2026-08-31.
- **Postgres-level rules are invisible from TypeScript.** A policy denial arrives as SQLSTATE
  42501, and someone has to map it to a sensible error. Done once, in the dashboard router.

## What was deliberately deferred

Widget sandboxing. Widgets run in-process today, which means third-party widget code would be able
to read every token this origin holds. The contract is shaped so the swap to an iframe plus
postMessage changes the host implementation and no widget. **The gate is: before the first widget
we did not write runs against real customer data.**
