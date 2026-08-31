import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import { withUser } from "./identity";
import { currentUserId } from "./session";

export async function createContext() {
  return { userId: currentUserId() };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

const withIdentity = t.middleware(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });

  return withUser(
    ctx.userId,
    (tx) => next({ ctx: { tx } }),
    // tRPC hands back a result object instead of throwing when a resolver fails,
    // so the commit decision has to read it. Without this a mutation that errored
    // halfway would still commit what it had written.
    (result) => result.ok,
  );
});

/**
 * Every procedure built on this runs inside a transaction that has already told
 * Postgres who is asking. Resolvers use ctx.tx; there is no other handle to the
 * database in request code.
 */
export const protectedProcedure = t.procedure.use(withIdentity);
