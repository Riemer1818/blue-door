"use client";

import { CircleAlert, FileCheck2 } from "lucide-react";

import { trpc } from "@/lib/trpc";

/**
 * A stored file: what it is, and enough of it to recognise.
 *
 * The type is the load-bearing part. A file with a detected type can be wired to
 * a matching port; one without cannot, and the reason has to be visible here
 * rather than surfacing later as an empty dropdown on a tool page. Detection
 * writes a sentence explaining itself for exactly this screen — "records differ
 * in length 45, 51, 54 - unaligned" tells a user what to fix, where "untyped"
 * would leave them guessing.
 */
export function FileViewer({ nodeId }: { nodeId: string }) {
  const query = trpc.files.content.useQuery({ id: nodeId });
  const meta = trpc.files.list.useQuery();

  if (query.isLoading) {
    return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  }
  if (query.error) return <p className="p-8 text-sm text-red-600">{query.error.message}</p>;

  const file = query.data!;
  const row = meta.data?.find((f) => f.id === nodeId);
  const detection = row?.detection;
  const typed = file.portType !== null;

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{file.name}</h1>
          <span className="font-mono text-xs text-slate-400">{formatBytes(file.byteSize)}</span>
        </div>

        <p className="mt-2 flex items-start gap-2 text-sm">
          {typed ? (
            <>
              <FileCheck2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
              <span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  {file.portType}
                  {file.portFormat && `/${file.portFormat}`}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {" "}
                  — can be used wherever a tool takes this type.
                </span>
              </span>
            </>
          ) : (
            <>
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-500" />
              <span className="text-slate-600 dark:text-slate-300">
                No type recognised, so this cannot be wired to a tool port. It is kept as-is.
              </span>
            </>
          )}
        </p>

        {/* Detection explains itself. Absent this, "no type recognised" is a
            verdict with no appeal. */}
        {detection && (
          <p className="mt-1 pl-6 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {detection}
          </p>
        )}

        {/* Alphabet, for sequence-shaped files only. `ambiguous` is a real
            answer rather than a failure to try harder — nucleotide letters are
            a subset of protein letters, so a short run of ACGT genuinely cannot
            be resolved — and it is shown as such, because a port that needs an
            alphabet will refuse it. */}
        {row?.alphabet && (
          <p className="mt-2 flex items-start gap-2 text-sm">
            {row.alphabet === "ambiguous" || row.alphabet === "not_sequence" ? (
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-500" />
            ) : (
              <FileCheck2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
            )}
            <span>
              <span
                className={
                  row.alphabet === "ambiguous" || row.alphabet === "not_sequence"
                    ? "font-mono text-amber-700 dark:text-amber-500"
                    : "font-mono text-emerald-700 dark:text-emerald-400"
                }
              >
                {row.alphabet}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {row.alphabet === "ambiguous"
                  ? " — cannot be used where a tool needs a specific alphabet."
                  : ` — ${row.alphabetConfidence} confidence.`}
              </span>
            </span>
          </p>
        )}
      </header>

      {/* Never rendered as HTML: file content is untrusted, and a preview that
          interprets it is how a stored page becomes a script. */}
      <pre className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        {file.text}
      </pre>
      {file.truncated && (
        <p className="mt-2 text-xs italic text-slate-400">
          Showing the first {formatBytes(file.text.length)} of {formatBytes(file.byteSize)}.
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
