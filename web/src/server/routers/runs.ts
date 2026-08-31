import { TRPCError } from "@trpc/server";
import path from "node:path";
import { z } from "zod";

import { newRunId, startRun } from "../runs/execute";
import { prepareOutputDir, stageInputs } from "../storage/staging";
import { loadTools } from "../tools/catalogue";
import { protectedProcedure, router } from "../trpc";

/**
 * Running a wrapped tool.
 *
 * One path, whatever the operation costs: stage, spawn, return a run id, and let
 * everything after that arrive through the run record and the event stream. A
 * fast path for short operations would be a second execution path with less
 * traffic and less testing, diverging exactly where the two disagree about
 * outcome or event ordering — and it is the one that breaks first under load.
 *
 * `seqkit fx2tab` takes 160ms, so the queue is invisible unless the UI insists
 * on rendering it: the run finishes before a spinner would be worth showing.
 * That is a presentation problem with a presentation fix.
 */

const RUN_STAGING_DIR = process.env.RUN_STAGING_DIR ?? path.join(process.cwd(), ".runs");

export const runsRouter = router({
  /**
   * Start a run and return immediately.
   *
   * Everything slow is deliberately outside the transaction. Staging copies
   * bytes and the executor takes minutes; both inside `withUser` would hold a
   * pooled connection and an open transaction for the duration. See
   * `src/server/runs/execute.ts`.
   */
  start: protectedProcedure
    .input(
      z.object({
        adapterId: z.string().min(1),
        operation: z.string().min(1),
        inputs: z.array(z.object({ port: z.string().min(1), fileId: z.uuid() })),
        /** Where outputs land. Null is the tree root. */
        outputParent: z.uuid().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tools = await loadTools();
      const tool = tools.find((t) => t.id === input.adapterId);
      const operation = tool?.operations.find((op) => op.name === input.operation);
      if (!tool || !operation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No operation ${input.adapterId}.${input.operation}.`,
        });
      }

      // Every required input port must be supplied. Checked here so the refusal
      // is immediate and names the port, rather than surfacing as a run that
      // starts and dies.
      const supplied = new Set(input.inputs.map((i) => i.port));
      const unknown = [...supplied].filter((p) => !operation.inputs.some((i) => i.name === p));
      if (unknown.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${input.adapterId}.${input.operation} has no input port ${unknown.join(", ")}.`,
        });
      }
      const absent = operation.inputs.filter((p) => !supplied.has(p.name)).map((p) => p.name);
      if (absent.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Nothing supplied for ${absent.join(", ")}.`,
        });
      }

      const runId = newRunId();

      // Staged under the port's name with the extension the port declares, so
      // the tool sees a filename derived from the contract rather than from the
      // user's data.
      const { staged, missing } = await stageInputs(
        ctx.tx,
        runId,
        input.inputs.map((i) => {
          const port = operation.inputs.find((p) => p.name === i.port)!;
          return {
            port: i.port,
            fileId: i.fileId,
            extension: port.format ? `.${port.format}` : "",
          };
        }),
      );

      // A file the caller cannot see does not resolve. Refuse rather than run
      // with a port missing — the alternative is a tool failing for a reason
      // that has nothing to do with the tool.
      if (missing.length > 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No such file for ${missing.join(", ")}.`,
        });
      }

      await prepareOutputDir(runId);
      const eventsPath = path.join(RUN_STAGING_DIR, runId, "events.jsonl");

      await ctx.tx
        .insertInto("runs")
        .values({
          id: runId,
          ownerId: ctx.userId,
          adapterId: input.adapterId,
          operation: input.operation,
          eventsPath,
          outputParent: input.outputParent,
        })
        .execute();

      // Spawned, not awaited. The child writes the outcome back through its own
      // transaction when it exits.
      startRun({
        runId,
        ownerId: ctx.userId,
        adapterId: input.adapterId,
        operation: input.operation,
        staged,
        eventsPath,
        outputParent: input.outputParent,
      });

      return { runId };
    }),

  /** One run. `outcome` is null while it is still going. */
  get: protectedProcedure.input(z.object({ runId: z.string().min(1) })).query(async ({ ctx, input }) => {
    const run = await ctx.tx
      .selectFrom("runs")
      .select([
        "id",
        "adapterId",
        "operation",
        "outcome",
        "wallSeconds",
        "result",
        "startedAt",
        "finishedAt",
      ])
      .where("id", "=", input.runId)
      .executeTakeFirst();

    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "No such run." });
    return { ...run, wallSeconds: run.wallSeconds === null ? null : Number(run.wallSeconds) };
  }),

  /** Recent runs, newest first. Optionally for one adapter — BLU-17's question. */
  list: protectedProcedure
    .input(z.object({ adapterId: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      let query = ctx.tx
        .selectFrom("runs")
        .select(["id", "adapterId", "operation", "outcome", "wallSeconds", "startedAt", "finishedAt"])
        .orderBy("startedAt", "desc")
        .limit(input.limit);

      if (input.adapterId) query = query.where("adapterId", "=", input.adapterId);
      const runs = await query.execute();
      return runs.map((run) => ({
        ...run,
        wallSeconds: run.wallSeconds === null ? null : Number(run.wallSeconds),
      }));
    }),
});
