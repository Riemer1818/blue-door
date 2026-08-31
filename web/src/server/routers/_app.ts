import { router } from "../trpc";
import { dashboardRouter } from "./dashboard";
import { filesRouter } from "./files";
import { runsRouter } from "./runs";
import { toolsRouter } from "./tools";
import { treeRouter } from "./tree";
import { wrapsRouter } from "./wraps";

export const appRouter = router({
  dashboard: dashboardRouter,
  files: filesRouter,
  runs: runsRouter,
  tools: toolsRouter,
  tree: treeRouter,
  wraps: wrapsRouter,
});

export type AppRouter = typeof appRouter;
