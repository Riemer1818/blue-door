---
status: verified
updated: 2026-08-31
owner: riemer
---

# Setup: clone to running

**WORKING — proven end to end on 2026-08-31** on Linux with Node 22.14, pnpm 10.14, Docker 28.1,
Terraform 1.14: local Postgres up, migrations applied, dashboard rendering in Chrome, drag/resize/
config changes surviving a reload.

## Local

Nothing here talks to Scaleway. The local database is deliberately close to the managed one —
same Postgres major, and the app connects as a **non-owner role** in both, so row-level security
behaves identically. RLS that is wrong is wrong locally too.

```bash
docker compose -f docker-compose.local.yml up -d --wait   # Postgres 16 on 127.0.0.1:5433
./db/apply.sh                                             # migrations, as the owner role
./db/seed-dev.sh                                          # a dev user and one dashboard

cd web
cp .env.local.example .env.local
pnpm install
pnpm dev
```

Then open **http://localhost:3210** — not `127.0.0.1`. Next 16's dev server treats a host it was
not started with as a cross-origin request and answers `403` for every `/_next/static` chunk, so
the page loads and then silently renders nothing. Either use `localhost` or add the other host to
`allowedDevOrigins` in `next.config.ts`.

| Command | Does |
|---|---|
| `./db/apply.sh` | Applies pending `db/migrations/*.sql`, each in one transaction, tracked in `schema_migrations` |
| `pnpm db:types` | Regenerates `web/src/lib/db-types.ts` **from the live database**. Run after every migration |
| `pnpm typecheck` | `next typegen && tsc --noEmit` — the typegen step is required, `LayoutProps` and friends do not exist without it |

Two roles, and the difference matters:

| Role | Used by | Can |
|---|---|---|
| `postgres` (local) / `bluedoor_admin` (Scaleway) | migrations, `pnpm db:types` | own tables, DDL, bypass nothing (`FORCE ROW LEVEL SECURITY` is set) |
| `bluedoor_app` | the running app | SELECT/INSERT/UPDATE/DELETE through policies only; no DDL |

Developing against the owner role would silently bypass every policy, and the first time you
noticed would be in production. `.env.local.example` points at `bluedoor_app` for that reason.

## Scaleway

**NOTE — designed, never applied.** `infra/terraform/` passes `terraform validate` against provider
`scaleway/scaleway ~> 2.50`. No `terraform apply` has been run, no instance exists, and the engine
version string has not been checked against `scw rdb engine list`.

```bash
cd infra/terraform
cp scaleway.auto.tfvars.example scaleway.auto.tfvars   # credentials, gitignored
terraform init && terraform plan
```

Things that will bite:

- `allowed_cidrs` defaults to empty, so a first apply produces a database **nothing can reach**.
  That is the intended failure mode; add your egress `/32`. A validation rule rejects `0.0.0.0/0`.
- The instance carries `prevent_destroy`. Removing that block is a deliberate act.
- Migrations run against the admin URL, the app gets the app URL:
  ```bash
  DATABASE_URL="$(terraform output -raw admin_database_url)" ./db/apply.sh
  terraform output -raw app_database_url        # -> web/.env.local
  ```
- Connection strings use `sslmode=require`, which encrypts but does not authenticate the server.
  `terraform output -raw certificate` gives Scaleway's CA for moving to `verify-full`, which should
  happen before this holds customer data.

## Gotchas found on the way

- **Kysely + `--camel-case` needs `CamelCasePlugin`.** The codegen flag only changes the generated
  types; without the runtime plugin every query fails with `relation "widgetTypes" does not exist`.
  The plugin does **not** rewrite raw `` sql`` `` fragments — those stay snake_case.
- **`z.uuid()` in Zod 4 enforces the RFC version and variant nibbles.** Hand-written placeholder
  UUIDs like `0000…00da` are rejected. The dev seed uses real v4 values to match
  `gen_random_uuid()`.
- **`useContainerWidth` defaults to 1280px until it measures.** If the component returns a
  different tree while data loads, the hook's effect runs with a null ref, never re-runs, and the
  grid sizes itself against 1280 forever. The measured container must render on every pass.
- **Breakpoints are measured from the container, not the window.** `useContainerWidth` observes the
  element you attach the ref to, so a `max-w-6xl` (1152px) wrapper puts the 1200px `lg` bucket
  permanently out of reach no matter how wide the monitor is. The dashboard wrapper is deliberately
  full-width.
- **`mx-auto` on a flex child kills cross-axis stretch.** The root layout's `body` is
  `flex flex-col`, so the page wrapper needs `w-full` or it collapses to its content width and the
  grid overflows the viewport.
