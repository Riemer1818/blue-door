# blue-door

Two surfaces over one component library. A **dashboard** of user-arranged widgets — shortcuts and
things you watch all day — and **experiments**, which live in a file tree you organise yourself and
are written as documents of blocks. EU-hosted Postgres, and the database — not the API layer —
decides who can see what.

## Run it locally

```bash
docker compose -f docker-compose.local.yml up -d --wait
./db/apply.sh
./db/seed-dev.sh

cd web && cp .env.local.example .env.local && pnpm install && pnpm dev
```

Open **http://localhost:3210** (not `127.0.0.1` — Next 16 answers 403 for static chunks requested
from a host it was not started with).

Full instructions, the Scaleway path, and the gotchas: [docs/engineering/setup.md](docs/engineering/setup.md).

## Layout

| Path | Holds |
|---|---|
| [infra/terraform/](infra/terraform/) | Scaleway Managed PostgreSQL, `fr-par`. Validates; never applied |
| [db/migrations/](db/migrations/) | Plain SQL. The schema lives here — TypeScript types are generated *from* it |
| [db/apply.sh](db/apply.sh) | Migration runner. One transaction per file, tracked in `schema_migrations` |
| [web/](web/) | Next.js 16, tRPC, Kysely; react-grid-layout (dashboard), BlockNote (documents), react-arborist (tree) |
| [docs/](docs/) | Knowledge that outlives a ticket. Start at [docs/README.md](docs/README.md) |

## The two ideas worth knowing before reading the code

**The database is the source of truth.** Row-level security policies — not resolver discipline —
decide access. The app connects as `bluedoor_app`, which owns no tables and cannot DDL; the API
sets `app.user_id` per transaction and every policy reads it. Forgetting that wrapper yields an
empty result, never someone else's data. Schema is SQL; `web/src/lib/db-types.ts` is generated from
the live database and never hand-edited. See
[ADR 0002](docs/decisions/0002-postgres-as-source-of-truth.md).

**Layouts are responsive and per-person.** The grid drops from 12 columns to 2 as the window
narrows, following buckets stored in `grid_breakpoints`. Each breakpoint keeps its own arrangement,
and only the one you are looking at is ever written — resizing a window never overwrites the layout
you built at another size. See [docs/engineering/data-model.md](docs/engineering/data-model.md).

**The widget catalogue is a table, not a constant.** `widget_types` holds what exists, its version,
its default and minimum size, and its config JSON Schema — which also generates the widget's
settings panel, so a widget author gets a settings form by declaring a schema rather than building
one. Installing a widget type is an INSERT; the frontend registry only answers "given a type, which
component?". See
[docs/engineering/widget-contract.md](docs/engineering/widget-contract.md).

## Not done

- **No authentication.** `web/src/server/session.ts` returns a dev user and throws in production.
- **Widgets run in-process.** Fine while every widget is ours; a sandbox is required before running
  code we did not write against real data.
- **Nothing is deployed.** The Terraform validates but has never been applied.
