import { router } from "../trpc";
import { dashboardRouter } from "./dashboard";
import { treeRouter } from "./tree";

export const appRouter = router({
  dashboard: dashboardRouter,
  tree: treeRouter,
});

export type AppRouter = typeof appRouter;
