import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc";

const name = z.string().trim().min(1).max(200);

/**
 * The file tree: folders and experiments, arbitrarily nested, organised by the
 * person who owns them.
 *
 * Almost nothing is checked here. Postgres refuses a folder inside itself, a
 * child of an experiment, a duplicate name in one directory, and anything
 * belonging to somebody else — see db/migrations/0007. This layer's job is to
 * turn those refusals into HTTP statuses.
 */
export const treeRouter = router({
  /**
   * Every node the caller owns, flat. The client assembles the tree: a few
   * hundred nodes are nothing to ship, and a recursive query per expand would
   * cost more than it saves.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.tx
      .selectFrom("nodes")
      .select(["id", "parentId", "kind", "name", "position", "updatedAt"])
      .orderBy(["position", "name"])
      .execute();
  }),

  create: protectedProcedure
    .input(
      z.object({
        parentId: z.uuid().nullable(),
        kind: z.enum(["folder", "experiment"]),
        name,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // New items go last among their siblings.
      const last = await ctx.tx
        .selectFrom("nodes")
        .select(({ fn }) => fn.max("position").as("position"))
        .where((eb) =>
          input.parentId === null
            ? eb("parentId", "is", null)
            : eb("parentId", "=", input.parentId),
        )
        .executeTakeFirst();

      try {
        return await ctx.tx
          .insertInto("nodes")
          .values({
            ownerId: ctx.userId,
            parentId: input.parentId,
            kind: input.kind,
            name: input.name,
            position: Number(last?.position ?? 0) + 1,
          })
          .returning(["id", "parentId", "kind", "name"])
          .executeTakeFirstOrThrow();
      } catch (error) {
        throw asClientError(error);
      }
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.tx
          .updateTable("nodes")
          .set({ name: input.name })
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (Number(result.numUpdatedRows) === 0) throw notFound();
        return { id: input.id, name: input.name };
      } catch (error) {
        throw asClientError(error);
      }
    }),

  /** Reparent, and place among the new siblings. */
  move: protectedProcedure
    .input(z.object({ id: z.uuid(), parentId: z.uuid().nullable(), position: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.tx
          .updateTable("nodes")
          .set({ parentId: input.parentId, position: input.position })
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (Number(result.numUpdatedRows) === 0) throw notFound();
        return { id: input.id };
      } catch (error) {
        throw asClientError(error);
      }
    }),

  /** Deletes the subtree: nodes.parent_id cascades. */
  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tx.deleteFrom("nodes").where("id", "=", input.id).executeTakeFirst();
      if (Number(result.numDeletedRows) === 0) throw notFound();
      return { id: input.id };
    }),

  /** One experiment and its document. */
  get: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const node = await ctx.tx
        .selectFrom("nodes")
        .select(["id", "parentId", "kind", "name", "content", "updatedAt"])
        .where("id", "=", input.id)
        .executeTakeFirst();

      if (!node) throw notFound();
      return node;
    }),

  /**
   * Save the whole document. BlockNote owns its structure, so the document is
   * the unit of change — see the note at the top of 0008.
   */
  saveContent: protectedProcedure
    .input(z.object({ id: z.uuid(), content: z.array(z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.tx
          .updateTable("nodes")
          .set({ content: JSON.stringify(input.content) })
          .where("id", "=", input.id)
          .executeTakeFirst();

        if (Number(result.numUpdatedRows) === 0) throw notFound();
        return { id: input.id };
      } catch (error) {
        throw asClientError(error);
      }
    }),
});

function notFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "Not found." });
}

// 23505 unique_violation  -> a name already taken in that folder
// 23514 check_violation   -> a structural rule (cycle, wrong parent kind, ...)
// 23503 foreign_key       -> a parent that does not exist
function asClientError(error: unknown): unknown {
  if (error instanceof TRPCError) return error;
  const err = error as { code?: string; message?: string } | null;

  if (err?.code === "23505") {
    return new TRPCError({ code: "CONFLICT", message: "Something here already has that name." });
  }
  if (err?.code === "23514" || err?.code === "23503") {
    return new TRPCError({ code: "BAD_REQUEST", message: err.message ?? "Not allowed here." });
  }
  return error;
}
