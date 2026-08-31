import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import type { WidgetProps } from "./types";

/**
 * Maps a widget type to the code that renders it.
 *
 * Note what is NOT here: display names, sizes, config schemas, whether a widget
 * is enabled. All of that lives in the widget_types table, because the catalogue
 * is data. This file answers one question only — given a type, which component?
 *
 * A type present in the database but missing here renders as "not installed"
 * rather than crashing the dashboard, which is the behaviour you want the day a
 * widget is published before the client that can render it ships.
 */
const registry: Record<string, LazyExoticComponent<ComponentType<WidgetProps>>> = {
  notes: lazy(() => import("./notes")),
  clock: lazy(() => import("./clock")),
  counter: lazy(() => import("./counter")),
};

export function resolveWidget(type: string) {
  return registry[type] ?? null;
}
