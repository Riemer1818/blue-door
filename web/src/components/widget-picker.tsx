"use client";

import { useState } from "react";

type CatalogEntry = {
  type: string;
  displayName: string;
  description: string | null;
  version: string;
};

/**
 * The catalogue is whatever widget_types holds. Nothing in this component knows
 * the names of the three widgets that happen to exist today.
 */
export function WidgetPicker({
  catalog,
  onAdd,
  busy,
}: {
  catalog: CatalogEntry[];
  onAdd: (type: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        {busy ? "Adding…" : "Add widget"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {catalog.length === 0 && (
              <p className="p-3 text-sm text-slate-500 dark:text-slate-400">
                No widget types installed. Insert a row into widget_types.
              </p>
            )}
            {catalog.map((entry) => (
              <button
                key={entry.type}
                onClick={() => {
                  onAdd(entry.type);
                  setOpen(false);
                }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{entry.displayName}</span>
                  <span className="font-mono text-[10px] text-slate-400">{entry.version}</span>
                </span>
                {entry.description && (
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{entry.description}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
