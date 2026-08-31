"use client";

import {
  ResponsiveGridLayout,
  getBreakpointFromWidth,
  useContainerWidth,
  type Layout,
} from "react-grid-layout";
import { Suspense, useCallback, useMemo, useState } from "react";

import { trpc } from "@/lib/trpc";
import { resolveWidget } from "@/widgets/registry";
import type { WidgetHost } from "@/widgets/types";
import { WidgetBoundary } from "./widget-boundary";
import { GearIcon, LockedIcon, UnlockedIcon } from "./widget-icons";
import { WidgetPicker } from "./widget-picker";
import { useConfigSaver } from "./use-config-saver";
import { WidgetSettings } from "./widget-settings";

const ROW_HEIGHT = 60;

export function DashboardGrid() {
  const utils = trpc.useUtils();
  const dashboard = trpc.dashboard.get.useQuery();
  const catalog = trpc.dashboard.catalog.useQuery();
  const breakpointRows = trpc.dashboard.breakpoints.useQuery();

  const invalidate = () => void utils.dashboard.get.invalidate();

  const addWidget = trpc.dashboard.addWidget.useMutation({ onSuccess: invalidate });
  const removeWidget = trpc.dashboard.removeWidget.useMutation({ onSuccess: invalidate });
  const saveLayout = trpc.dashboard.saveLayout.useMutation({ onSuccess: invalidate });
  const setLocked = trpc.dashboard.setLocked.useMutation({ onSuccess: invalidate });

  // Which widget's settings panel is open, if any.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  const saveConfig = trpc.dashboard.saveConfig.useMutation({
    onMutate: async () => {
      // The optimistic paint already happened in useConfigSaver; this only keeps
      // a snapshot to roll back to if the server rejects the config.
      await utils.dashboard.get.cancel();
      return { previous: utils.dashboard.get.getData() };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) utils.dashboard.get.setData(undefined, context.previous);
    },
    onSettled: invalidate,
  });

  // Paint the change now, write it 500ms later, and flush whatever is still
  // waiting if the page is torn down first.
  const paintConfig = useCallback(
    (id: string, config: Record<string, unknown>) => {
      utils.dashboard.get.setData(undefined, (old) =>
        old
          ? {
              ...old,
              widgets: old.widgets.map((w) =>
                // The column is jsonb; the validated shape is the server's job.
                w.id === id ? { ...w, config: config as typeof w.config } : w,
              ),
            }
          : old,
      );
    },
    [utils],
  );

  const saveWidgetConfig = useConfigSaver({
    save: (input) => saveConfig.mutateAsync(input),
    onOptimistic: paintConfig,
    endpoint: "/api/trpc",
  });

  const widgets = useMemo(() => dashboard.data?.widgets ?? [], [dashboard.data]);

  // Breakpoint names, their trigger widths and their column counts all come from
  // the grid_breakpoints table. Changing how many columns a phone gets is an
  // UPDATE, not a redeploy.
  const { breakpoints, cols } = useMemo(() => {
    const rows = breakpointRows.data ?? [];
    return {
      breakpoints: Object.fromEntries(rows.map((b) => [b.name, b.minWidth])),
      cols: Object.fromEntries(rows.map((b) => [b.name, b.cols])),
    };
  }, [breakpointRows.data]);

  // Per-breakpoint arrangements, each item carrying the minimum size its widget
  // type declares — clamped to that breakpoint's columns, because a 3-column
  // minimum is meaningless on a 2-column phone and the database would reject it.
  const layouts = useMemo(() => {
    const stored = dashboard.data?.layouts ?? {};
    const byId = new Map(
      widgets.map((w) => [
        String(w.id),
        { minW: w.typeMinW ?? 1, minH: w.typeMinH ?? 1, locked: Boolean(w.locked) },
      ]),
    );

    return Object.fromEntries(
      Object.entries(stored).map(([name, items]) => [
        name,
        items.map((item) => {
          const meta = byId.get(item.i);
          return {
            ...item,
            minW: Math.min(meta?.minW ?? 1, cols[name] ?? item.w),
            minH: meta?.minH ?? 1,
            // `static` is what makes the others compact *around* a locked
            // widget rather than pushing it out of the way. It also implies
            // neither draggable nor resizable, and the library then marks the
            // item react-resizable-hide so its handles disappear.
            static: meta?.locked ?? false,
          };
        }),
      ]),
    );
  }, [dashboard.data?.layouts, widgets, cols]);

  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

  // Derived from the measured width rather than held in state: the value is then
  // always the breakpoint currently on screen, with no chance of a save landing
  // under the previous one mid-resize.
  const currentBreakpoint = useMemo(() => {
    const names = Object.keys(breakpoints);
    if (names.length === 0) return null;
    return getBreakpointFromWidth(breakpoints, width);
  }, [breakpoints, width]);

  // Persist on drop, not on every frame of a drag — and only for the breakpoint
  // the person is actually looking at. A window resize rearranges the grid
  // without saving, so a laptop layout never overwrites the desktop one.
  const persist = useCallback(
    (next: Layout) => {
      if (!currentBreakpoint) return;
      saveLayout.mutate({
        breakpoint: currentBreakpoint,
        items: next.map((item) => ({ id: item.i, x: item.x, y: item.y, w: item.w, h: item.h })),
      });
    },
    [saveLayout, currentBreakpoint],
  );

  // One host per instance. Today it closes over a tRPC mutation; the day widgets
  // are sandboxed this becomes a postMessage channel and no widget changes.
  const makeHost = useCallback(
    (instanceId: string): WidgetHost => ({
      instanceId,
      saveConfig: (next) => saveWidgetConfig(instanceId, next),
      query: async (operation) => {
        throw new Error(`Host operation "${operation}" is not implemented yet.`);
      },
    }),
    [saveWidgetConfig],
  );

  const ready = mounted && widgets.length > 0 && currentBreakpoint !== null;

  // The schema comes from the catalogue, i.e. from widget_types.config_schema —
  // the same column the server validates the saved config against.
  const editing = widgets.find((w) => String(w.id) === settingsFor);
  const editingSchema = editing
    ? (catalog.data?.find((c) => c.type === editing.widgetType)?.configSchema ?? null)
    : null;

  const settingsPanel = editing ? (
    <WidgetSettings
      title={editing.typeDisplayName ?? String(editing.widgetType)}
      schema={editingSchema as Parameters<typeof WidgetSettings>[0]["schema"]}
      config={(editing.config ?? {}) as Record<string, unknown>}
      saving={saveConfig.isPending}
      error={saveConfig.error?.message ?? null}
      onClose={() => {
        saveConfig.reset();
        setSettingsFor(null);
      }}
      onSave={(next) =>
        saveConfig.mutate(
          { id: String(editing.id), config: next },
          { onSuccess: () => setSettingsFor(null) },
        )
      }
    />
  ) : null;

  return (
    // No max-width: useContainerWidth measures this element, so a capped
    // container would put the wider breakpoints permanently out of reach — with
    // max-w-6xl (1152px) the 1200px "lg" bucket can never be selected.
    <div className="w-full p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">
            {dashboard.data?.dashboard.name ?? "Dashboard"}
          </h1>
          {saveLayout.isPending ? (
            <p className="text-xs text-slate-400">Saving…</p>
          ) : null}
        </div>
        <WidgetPicker
          catalog={catalog.data ?? []}
          busy={addWidget.isPending}
          onAdd={(type) =>
            dashboard.data && addWidget.mutate({ dashboardId: dashboard.data.dashboard.id, type })
          }
        />
      </header>

      {/*
        This container is measured by useContainerWidth and must render on every
        pass. Returning a different tree while the query is loading would leave
        the hook's ref null on the one render its effect runs in, and the grid
        would then size itself against the hook's 1280px default forever.
      */}
      <div ref={containerRef}>
        {dashboard.error ? (
          <p className="rounded-lg border border-red-200 p-6 text-sm text-red-600 dark:border-red-900">
            {dashboard.error.message}
          </p>
        ) : widgets.length === 0 && !dashboard.isLoading ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500 dark:border-slate-700">
            Nothing here yet. Add a widget.
          </p>
        ) : ready ? (
          <ResponsiveGridLayout
            width={width}
            breakpoints={breakpoints}
            cols={cols}
            layouts={layouts}
            rowHeight={ROW_HEIGHT}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            onDragStop={(next) => persist(next)}
            onResizeStop={(next) => persist(next)}
            dragConfig={{
              // Grab anywhere on the card. `cancel` exempts the things a person
              // means to interact with rather than move — without it, selecting
              // text in a note or clicking a button would drag the widget instead.
              cancel:
                "input, textarea, select, option, button, a, label, [contenteditable], .react-resizable-handle",
              // A few pixels of slack so a click that wobbles stays a click.
              threshold: 4,
            }}
            // Corner plus both trailing edges: width alone from the right edge,
            // height alone from the bottom, or both from the corner.
            resizeConfig={{ enabled: true, handles: ["se", "s", "e"] }}
          >
            {widgets.map((w) => {
              const id = String(w.id);
              const type = String(w.widgetType);
              const name = w.typeDisplayName ?? type;
              const locked = Boolean(w.locked);
              const Widget = resolveWidget(type);

              return (
                <div
                  key={id}
                  className={`flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-slate-900 ${
                    locked
                      ? "border-slate-400 dark:border-slate-500"
                      : "cursor-move border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div className="widget-header flex items-center justify-between gap-1 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <span className="truncate">{name}</span>
                      {locked && (
                        <span className="shrink-0 text-slate-400" title="Locked">
                          <LockedIcon />
                        </span>
                      )}
                    </span>

                    <span className="flex shrink-0 items-center gap-0.5 text-slate-400">
                      <button
                        onClick={() => setSettingsFor(id)}
                        className="rounded p-1 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        aria-label={`${name} settings`}
                        title="Settings"
                      >
                        <GearIcon />
                      </button>
                      <button
                        onClick={() => setLocked.mutate({ id, locked: !locked })}
                        className={`rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                          locked ? "text-slate-700 dark:text-slate-200" : ""
                        }`}
                        aria-label={locked ? `Unlock ${name}` : `Lock ${name}`}
                        title={locked ? "Unlock" : "Lock in place"}
                      >
                        {locked ? <LockedIcon /> : <UnlockedIcon />}
                      </button>
                      <button
                        onClick={() => removeWidget.mutate({ id })}
                        className="rounded p-1 text-xs hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                        aria-label={`Remove ${name}`}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    <WidgetBoundary widgetType={type}>
                      <Suspense fallback={<span className="text-xs text-slate-400">Loading widget…</span>}>
                        {Widget ? (
                          <Widget
                            config={(w.config ?? {}) as Record<string, unknown>}
                            host={makeHost(id)}
                          />
                        ) : (
                          // Type exists in the database, component does not ship in
                          // this client. Say so rather than crashing.
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            No component registered for “{type}”.
                          </span>
                        )}
                      </Suspense>
                    </WidgetBoundary>
                  </div>
                </div>
              );
            })}
          </ResponsiveGridLayout>
        ) : null}
      </div>

      {settingsPanel}
    </div>
  );
}
