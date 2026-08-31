"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Cycles light -> dark -> system. Three states rather than two because "follow
 * the OS" is a real preference, and next-themes remembers the choice.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // The stored theme is only known in the browser, so the icon has to wait for
  // hydration or it guesses wrong half the time. useSyncExternalStore is the
  // clean way to say "false on the server, true on the client" without a
  // setState-in-effect round trip.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const index = Math.max(0, MODES.findIndex((m) => m.value === theme));
  const current = MODES[index];
  const next = MODES[(index + 1) % MODES.length];
  const Icon = current.Icon;

  return (
    <button
      onClick={() => setTheme(next.value)}
      title={mounted ? `Theme: ${current.label} — switch to ${next.label}` : "Theme"}
      aria-label={mounted ? `Theme: ${current.label}. Switch to ${next.label}` : "Theme"}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {mounted ? <Icon size={18} /> : <span className="h-[18px] w-[18px]" />}
    </button>
  );
}
