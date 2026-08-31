import { loadPortTypes, loadTools, portTypeIndex } from "../tools/catalogue";
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
});
