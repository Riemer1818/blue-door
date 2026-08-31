"use client";

import { useSyncExternalStore } from "react";

import type { WidgetProps } from "./types";

type Config = { timeZone?: string; showSeconds?: boolean; label?: string };

/**
 * Settings — zone, seconds, label — are edited in the shell's gear panel, which
 * generates its form from this type's config_schema. The widget only reads them.
 */
function useSecondTick(): number | null {
  // The clock is an external source of truth, not React state, so it is
  // subscribed to rather than copied into state on a timer. getServerSnapshot
  // returns null so the server renders a placeholder instead of a timestamp that
  // is already wrong by the time it reaches the browser.
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 1000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
}

export default function ClockWidget({ config }: WidgetProps) {
  const { timeZone = "Europe/Amsterdam", showSeconds = true, label = "" } = config as Config;
  const tick = useSecondTick();

  let formatted = "--:--";
  if (tick !== null) {
    try {
      formatted = new Date(tick * 1000).toLocaleTimeString("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        ...(showSeconds ? { second: "2-digit" as const } : {}),
      });
    } catch {
      // An unknown IANA zone throws rather than falling back. Say which one.
      formatted = "Bad zone";
    }
  }

  return (
    <div className="flex h-full flex-col items-start justify-center gap-1">
      <span className="font-mono text-3xl tabular-nums">{formatted}</span>
      {/* Label and zone share one line: two stacked lines would push a labelled
          clock past two grid rows and force a scrollbar at its minimum size. */}
      <span className="truncate text-xs text-slate-400">
        {label ? `${label} · ${timeZone}` : timeZone}
      </span>
    </div>
  );
}
