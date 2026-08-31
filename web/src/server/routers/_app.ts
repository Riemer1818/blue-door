import { router } from "../trpc";
import { dashboardRouter } from "./dashboard";
import { toolsRouter } from "./tools";
import { treeRouter } from "./tree";
import { wrapsRouter } from "./wraps";

export const appRouter = router({
  dashboard: dashboardRouter,
  tools: toolsRouter,
  tree: treeRouter,
  wraps: wrapsRouter,
});

export type AppRouter = typeof appRouter;
