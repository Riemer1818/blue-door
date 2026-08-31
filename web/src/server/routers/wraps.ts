import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { loadReport, loadReports } from "../tools/reports";
import { protectedProcedure, router } from "../trpc";

/**
 * Wrap runs: the adapter agent's attempts to bring a tool into the catalogue,
 * and the reports a human reviews before any of them lands.
 *
 * Read-only. Promotion is a write and deliberately does not exist yet — it needs
 * `wrap.py --promote` on the other side, and inventing a frontend-only promotion
 * would put the trust boundary in the wrong process.
 */
export const wrapsRouter = router({
  list: protectedProcedure.query(async () => {
    const reports = await loadReports();
    // The list view carries only what the summary row needs. The full report is
    // large - a manifest, every probe, the whole file list - and shipping four
    // of them to render four rows would be wasteful.
    return reports.map((r) => ({
      runId: r.runId,
      adapterId: r.adapterId,
      outcome: r.outcome,
      seconds: r.seconds,
      requested: r.requested,
      caveatCount: r.caveats.length,
      conformancePassed: r.conformance.passed ?? false,
      conformanceChecks: r.conformance.checks ?? 0,
    }));
  }),

  get: protectedProcedure.input(z.object({ runId: z.string().min(1) })).query(async ({ input }) => {
    const report = await loadReport(input.runId);
    if (!report) {
      throw new TRPCError({ code: "NOT_FOUND", message: `No wrap run "${input.runId}".` });
    }
    return report;
  }),
});
