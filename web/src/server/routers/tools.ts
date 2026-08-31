import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { loadPortTypes, loadTools, portTypeIndex, signature } from "../tools/catalogue";
import { protectedProcedure, router } from "../trpc";

/**
 * The catalogue is read-only and identical for everyone — it describes what the
 * platform can do, not anybody's data. So no row-level security applies here and
 * there is nothing user-scoped to leak. It still sits behind protectedProcedure:
 * an unauthenticated caller has no business enumerating the fleet's capabilities.
 */
export const toolsRouter = router({
  catalogue: protectedProcedure.query(async () => {
    const [tools, portTypes] = await Promise.all([loadTools(), loadPortTypes()]);
    return { tools, portTypes, index: portTypeIndex(tools) };
  }),

  /**
   * One tool, plus what its ports connect to. The neighbours are computed here
   * rather than shipping the whole catalogue to render one page.
   */
  get: protectedProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const tools = await loadTools();
    const tool = tools.find((t) => t.id === input.id);
    if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: `No adapter "${input.id}".` });

    const index = portTypeIndex(tools);
    const own = new Set(tool.operations.map((op) => `${tool.id}.${op.name}`));

    // Every port signature this tool touches, and who else touches it. Excluding
    // its own operations, since "seqkit connects to seqkit" answers nothing.
    const neighbours = [
      ...new Set(
        tool.operations.flatMap((op) => [...op.inputs, ...op.outputs].map(signature)),
      ),
    ]
      .sort()
      .map((sig) => ({
        signature: sig,
        producedBy: (index[sig]?.producedBy ?? []).filter((label) => !own.has(label)),
        consumedBy: (index[sig]?.consumedBy ?? []).filter((label) => !own.has(label)),
      }));

    return { tool, neighbours };
  }),
});
