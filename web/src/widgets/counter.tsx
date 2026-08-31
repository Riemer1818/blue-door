"use client";

import type { WidgetProps } from "./types";

type Config = { count?: number; label?: string; step?: number };

/** Every click is a round trip to Postgres. Deliberately: it makes the save path visible. */
export default function CounterWidget({ config, host }: WidgetProps) {
  const { count = 0, label = "Count", step = 1 } = config as Config;

  const bump = (direction: number) =>
    void host.saveConfig({ count: count + direction * step, label, step });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className="font-mono text-4xl tabular-nums">{count}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => bump(-1)}
          aria-label={`Subtract ${step}`}
          className="h-8 w-8 rounded-md border border-slate-200 text-lg leading-none hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          −
        </button>
        <button
          onClick={() => bump(1)}
          aria-label={`Add ${step}`}
          className="h-8 w-8 rounded-md border border-slate-200 text-lg leading-none hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          +
        </button>
      </div>
    </div>
  );
}
