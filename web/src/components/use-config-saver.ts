"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Debounced widget-config saving, owned by the host rather than by each widget.
 *
 * Three reasons it lives here and not in the widgets:
 *
 *  - Widgets stay dumb. `host.saveConfig(next)` returns a promise that resolves
 *    when the value is actually in Postgres, which is all a widget needs to show
 *    "Saved". It does not know or care that a debounce happened.
 *  - Every widget gets the same behaviour, including third-party ones that would
 *    otherwise each invent their own timer.
 *  - It makes the unload flush possible. A debounce with no flush loses the last
 *    keystrokes when the page goes away — verified: typing into a note and
 *    refreshing immediately dropped the text.
 *
 * The flush uses sendBeacon, which is the only thing a browser guarantees to
 * deliver from a page that is being torn down; a normal fetch is cancelled.
 */

const DEBOUNCE_MS = 500;

type Waiter = { resolve: () => void; reject: (error: unknown) => void };

type Pending = {
  config: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
  // Every caller still waiting on this widget's config reaching the database.
  // A superseded edit carries its waiters forward rather than resolving them:
  // resolving early would tell a widget "saved" while newer text sat unwritten.
  waiters: Waiter[];
};

export function useConfigSaver(options: {
  save: (input: { id: string; config: Record<string, unknown> }) => Promise<unknown>;
  onOptimistic: (id: string, config: Record<string, unknown>) => void;
  endpoint: string;
}) {
  const { save, onOptimistic, endpoint } = options;

  const pending = useRef(new Map<string, Pending>());

  // Kept in refs so the flush listener below never needs re-registering.
  // Assigned in an effect, not during render: a render can be thrown away, and
  // a ref written by a discarded render would outlive it.
  const saveRef = useRef(save);
  const endpointRef = useRef(endpoint);

  useEffect(() => {
    saveRef.current = save;
    endpointRef.current = endpoint;
  }, [save, endpoint]);

  useEffect(() => {
    const flush = () => {
      for (const [id, entry] of pending.current) {
        clearTimeout(entry.timer);
        // superjson's wire shape for a tRPC input, same as the normal client.
        const body = new Blob([JSON.stringify({ json: { id, config: entry.config } })], {
          type: "application/json",
        });
        navigator.sendBeacon(`${endpointRef.current}/dashboard.saveConfig`, body);
        for (const waiter of entry.waiters) waiter.resolve();
      }
      pending.current.clear();
    };

    // pagehide covers reload, navigation and tab close. visibilitychange covers
    // the mobile case where a backgrounded tab is killed without pagehide.
    const onHidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);

    const map = pending.current;
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      for (const entry of map.values()) clearTimeout(entry.timer);
    };
  }, []);

  return useCallback(
    (id: string, config: Record<string, unknown>) => {
      // Paint immediately; the round trip is not the user's problem.
      onOptimistic(id, config);

      const existing = pending.current.get(id);
      if (existing) clearTimeout(existing.timer);

      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const entry = pending.current.get(id);
          pending.current.delete(id);
          saveRef
            .current({ id, config })
            .then(() => entry?.waiters.forEach((w) => w.resolve()))
            .catch((error) => entry?.waiters.forEach((w) => w.reject(error)));
        }, DEBOUNCE_MS);

        pending.current.set(id, {
          config,
          timer,
          waiters: [...(existing?.waiters ?? []), { resolve, reject }],
        });
      });
    },
    [onOptimistic],
  );
}
