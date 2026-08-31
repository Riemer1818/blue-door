"use client";

import { useState } from "react";

import type { WidgetProps } from "./types";

type Config = { text?: string };

/**
 * Free-text scratchpad. Exists to prove the config round-trip: type, reload the
 * page, the text is still there — via the host, never via a direct write.
 *
 * No debounce here on purpose. The host coalesces writes and flushes anything
 * outstanding when the page is torn down, so every widget gets that for free and
 * none of them has to think about it. This one just says what changed and waits
 * for the promise to tell it the value reached the database.
 */
export default function NotesWidget({ config, host }: WidgetProps) {
  const { text = "" } = config as Config;

  const [draft, setDraft] = useState(text);
  const [saved, setSaved] = useState(true);
  const [lastServerText, setLastServerText] = useState(text);

  // Adopt server state that changed underneath us (another tab, a refetch) —
  // but never while the user has unsaved keystrokes. Adjusting state during
  // render is the supported way to do this; an effect would render twice.
  if (saved && text !== lastServerText) {
    setLastServerText(text);
    setDraft(text);
  }

  function edit(next: string) {
    setDraft(next);
    setSaved(false);
    void host.saveConfig({ text: next }).then(() => {
      setLastServerText(next);
      setSaved(true);
    });
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => edit(e.target.value)}
        placeholder="Notes…"
        className="min-h-0 flex-1 resize-none rounded-md border border-slate-200 bg-white p-2 text-sm outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900"
      />
      <span className="text-xs text-slate-400">{saved ? "Saved" : "Saving…"}</span>
    </div>
  );
}
