import { router } from "../trpc";
import { dashboardRouter } from "./dashboard";
import { filesRouter } from "./files";
import { toolsRouter } from "./tools";
import { treeRouter } from "./tree";
import { wrapsRouter } from "./wraps";

export const appRouter = router({
  dashboard: dashboardRouter,
  files: filesRouter,
  tools: toolsRouter,
  tree: treeRouter,
  wraps: wrapsRouter,
});

export type AppRouter = typeof appRouter;
