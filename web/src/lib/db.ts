import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DB } from "./db-types";

// db-types.ts is generated from the live database (`pnpm db:types`), not written
// by hand and not the source of the schema. The migrations in db/migrations are
// the schema; these types are a projection of it.

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy web/.env.local.example to web/.env.local.");
}

// Next's dev server re-evaluates modules on every edit; without this the pool
// count climbs until Postgres refuses connections.
const globalForDb = globalThis as unknown as { __bluedoorPool?: Pool };

const pool =
  globalForDb.__bluedoorPool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Scaleway's endpoint is public and TLS-terminated; the certificate chain is
    // available from `terraform output -raw certificate` if you move to
    // verify-full, which you should before this holds customer data.
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__bluedoorPool = pool;

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
  // The database is snake_case (it is the source of truth, and SQL conventions
  // win there); TypeScript is camelCase. This plugin translates between them,
  // and `pnpm db:types` generates the camelCase view with --camel-case to match.
  // Note it does NOT rewrite raw sql`` fragments — those stay snake_case.
  plugins: [new CamelCasePlugin()],
});
