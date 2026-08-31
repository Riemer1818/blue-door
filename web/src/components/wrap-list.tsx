"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { trpc } from "@/lib/trpc";

/**
 * Wrap runs awaiting a decision.
 *
 * Two buckets, because that is the only distinction that changes what a person
 * does next: `conformant` is the cheap approve, everything else needs thought.
 * The counts shown are the ones that decide which bucket a run is in — caveats
 * and conformance — so the list and the detail cannot disagree.
 */
export function WrapList() {
  const query = trpc.wraps.list.useQuery();

  if (query.isLoading) {
    return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  }
  if (query.error) {
    return <p className="p-8 text-sm text-red-600">{query.error.message}</p>;
  }

  const runs = query.data!;
  const ready = runs.filter((run) => run.outcome === "conformant");
  const needsYou = runs.filter((run) => run.outcome !== "conformant");

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Wrap runs</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          The adapter agent&rsquo;s attempts to bring a tool into the catalogue. Nothing reaches the
          catalogue without a person approving it here.
        </p>
      </header>

      {runs.length === 0 ? (
        <p className="text-sm italic text-slate-400">
          No wrap runs recorded. Requesting a tool starts one.
        </p>
      ) : (
        <>
          <Group title="Needs you" runs={needsYou} />
          <Group title="Ready for review" runs={ready} />
        </>
      )}
    </div>
  );
}

type Run = {
  runId: string;
  adapterId: string;
  outcome: string;
  seconds: number;
  requested: { name?: string; url?: string | null };
  caveatCount: number;
  conformancePassed: boolean;
  conformanceChecks: number;
};

function Group({ title, runs }: { title: string; runs: Run[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title} ({runs.length})
      </h2>
      <div className="flex flex-col gap-1.5">
        {runs.map((run) => (
          <Link
            key={run.runId}
            href={`/wraps/${run.runId}`}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{run.adapterId}</span>
                <span className="font-mono text-xs text-slate-400">{run.outcome}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                conformance{" "}
                {run.conformancePassed ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    passed {run.conformanceChecks} checks
                  </span>
                ) : (
                  <span className="text-red-700 dark:text-red-400">failed</span>
                )}
                {" · "}
                {run.caveatCount === 0 ? (
                  "nothing unresolved"
                ) : (
                  <span className="text-amber-700 dark:text-amber-500">
                    {run.caveatCount} caveat{run.caveatCount === 1 ? "" : "s"}
                  </span>
                )}
                {` · ${Math.round(run.seconds)}s`}
              </p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-slate-300 dark:text-slate-600" />
          </Link>
        ))}
      </div>
    </section>
  );
}
