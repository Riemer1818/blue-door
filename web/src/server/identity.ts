import { sql, type Kysely } from "kysely";

import { db } from "@/lib/db";
import type { DB } from "@/lib/db-types";

/**
 * Runs `fn` against a connection that has told Postgres who is asking, which is
 * what every row-level security policy in db/migrations/0001_init.sql reads.
 *
 * This is the ONLY place the application opens a transaction. A query issued
 * outside it runs with no identity set, so every policy evaluates
 * `owner_id = NULL` and matches nothing — the failure mode of forgetting this
 * wrapper is an empty result, never someone else's data.
 *
 * set_config(..., is_local => true) is the parameterised form of SET LOCAL: it is
 * scoped to this transaction, so the connection returned to the pool carries
 * nothing into the next request. Interpolating the id into a literal SET would be
 * both injectable and connection-scoped; don't.
 *
 * BEGIN/COMMIT are issued by hand rather than through Kysely's `transaction()`
 * because of `shouldCommit`: tRPC reports a failed resolver as a *value* rather
 * than an exception, so "did this succeed" is a question only the caller can
 * answer, and a transaction that commits the writes of a failed mutation is a
 * silent corruption bug.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Kysely<DB>) => Promise<T>,
  shouldCommit: (result: T) => boolean = () => true,
): Promise<T> {
  return db.connection().execute(async (conn) => {
    await sql`begin`.execute(conn);
    try {
      await sql`select set_config('app.user_id', ${userId}, true)`.execute(conn);
      const result = await fn(conn);
      await (shouldCommit(result) ? sql`commit` : sql`rollback`).execute(conn);
      return result;
    } catch (error) {
      await sql`rollback`.execute(conn);
      throw error;
    }
  });
}
