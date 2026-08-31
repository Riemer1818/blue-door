"use client";

import { Bot, ChevronRight, CircleAlert, User } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { trpc } from "@/lib/trpc";

type Port = { name: string; type: string; format?: string; description?: string };

const sig = (p: Port) => (p.format ? `${p.type}/${p.format}` : p.type);

/**
 * "What tools do I have, and what can they connect to."
 *
 * Every value shown comes from a manifest. This component knows the shape of a
 * manifest and nothing about any particular tool — adding an adapter to `tools/`
 * puts it on this page with no change here.
 */
export function ToolCatalogue() {
  const catalogue = trpc.tools.catalogue.useQuery();
  const [filter, setFilter] = useState<string | null>(null);

  const tools = useMemo(() => catalogue.data?.tools ?? [], [catalogue.data]);
  const index = useMemo(() => catalogue.data?.index ?? {}, [catalogue.data]);

  // Every port signature in the catalogue, so the filter offers what exists
  // rather than the full type vocabulary — most of which nothing implements yet.
  const signatures = useMemo(
    () => Object.keys(index).sort((a, b) => a.localeCompare(b)),
    [index],
  );

  const shown = useMemo(() => {
    if (!filter) return tools;
    return tools.filter((tool) =>
      tool.operations.some((op) =>
        [...op.inputs, ...op.outputs].some((port) => sig(port) === filter),
      ),
    );
  }, [tools, filter]);

  if (catalogue.isLoading) return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  if (catalogue.error) return <p className="p-8 text-sm text-red-600">{catalogue.error.message}</p>;

  return (
    <div className="mx-auto w-full max-w-5xl p-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Tools</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {tools.length === 0
            ? "No adapters found. The catalogue is the tools/ directory."
            : `${tools.length} adapter${tools.length === 1 ? "" : "s"}, ${tools.reduce((n, t) => n + t.operations.length, 0)} operations.`}
        </p>
      </header>

      {signatures.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Filter by port type
          </p>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={filter === null} onClick={() => setFilter(null)}>
              All
            </FilterChip>
            {signatures.map((s) => (
              <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
                {s}
              </FilterChip>
            ))}
          </div>

          {/* The question a scientist actually has: I have an Alignment, what
              can I do with it. Derived from manifests, no new data. */}
          {filter && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <Relation label="Produced by" items={index[filter]?.producedBy ?? []} />
              <Relation label="Consumed by" items={index[filter]?.consumedBy ?? []} />
            </div>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {shown.map((tool) => (
          <li key={tool.id}>
            <Link
              href={`/tools/${tool.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
            >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <h2 className="font-semibold">{tool.id}</h2>
                <span className="font-mono text-xs text-slate-400">{tool.version}</span>
                <ChevronRight size={14} className="self-center text-slate-300 dark:text-slate-600" />
              </span>
              <span className="flex items-center gap-2 text-xs">
                <Authorship by={tool.provenance.authoredBy} />
                <License value={tool.license} />
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {tool.machineClass}
                </span>
              </span>
            </div>

            {tool.description && (
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{tool.description}</p>
            )}

            <table className="mt-3 w-full table-fixed text-xs">
              <tbody>
                {tool.operations.map((op) => (
                  <tr key={op.name} className="align-top">
                    <td className="w-32 py-1 pr-3 font-mono text-slate-700 dark:text-slate-200">
                      {op.name}
                    </td>
                    <td className="py-1">
                      <PortList ports={op.inputs} filter={filter} />
                      <span className="mx-1.5 text-slate-300 dark:text-slate-600">&rarr;</span>
                      <PortList ports={op.outputs} filter={filter} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-3 truncate font-mono text-[11px] text-slate-400" title={tool.image}>
              {tool.source.repository ?? "no source declared"}
              {tool.source.ref && ` @ ${tool.source.ref}`}
              {tool.source.imageOrigin && ` · image ${tool.source.imageOrigin}`}
            </p>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length === 0 && tools.length > 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Nothing in the catalogue touches {filter}.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 font-mono text-xs transition-colors ${
        active
          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function PortList({ ports, filter }: { ports: Port[]; filter: string | null }) {
  if (ports.length === 0) return <span className="text-slate-400">nothing</span>;
  return (
    <>
      {ports.map((port, i) => (
        <span key={port.name}>
          {i > 0 && <span className="text-slate-300 dark:text-slate-600">, </span>}
          <span
            className={`font-mono ${
              sig(port) === filter
                ? "rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                : "text-slate-500 dark:text-slate-400"
            }`}
            title={port.description ?? port.name}
          >
            {sig(port)}
          </span>
        </span>
      ))}
    </>
  );
}

function Relation({ label, items }: { label: string; items: string[] }) {
  return (
    <p className="text-slate-600 dark:text-slate-300">
      <span className="text-slate-400">{label}: </span>
      {items.length === 0 ? (
        <span className="text-slate-400">nothing yet</span>
      ) : (
        <span className="font-mono">{items.join(", ")}</span>
      )}
    </p>
  );
}

/**
 * The column that matters once the agent starts producing adapters. An unstated
 * author is not "human" — it is unstated, and must look it.
 */
function Authorship({ by }: { by?: string }) {
  if (by === "agent") {
    return (
      <span className="flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
        <Bot size={12} /> agent
      </span>
    );
  }
  if (by === "human") {
    return (
      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
        <User size={12} /> human
      </span>
    );
  }
  return <span className="text-slate-400">author unstated</span>;
}

/** Nothing enforces a license yet, so a missing one has to look missing. */
function License({ value }: { value?: string }) {
  if (!value) {
    return (
      <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
        <CircleAlert size={12} /> no license
      </span>
    );
  }
  return <span className="font-mono text-slate-500 dark:text-slate-400">{value}</span>;
}
