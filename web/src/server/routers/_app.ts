import { router } from "../trpc";
import { dashboardRouter } from "./dashboard";
import { toolsRouter } from "./tools";
import { treeRouter } from "./tree";

export const appRouter = router({
  dashboard: dashboardRouter,
  tools: toolsRouter,
  tree: treeRouter,
});

export type AppRouter = typeof appRouter;
