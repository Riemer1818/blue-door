---
status: working
updated: 2026-08-31
owner: riemer
---

# The widget contract

A widget receives exactly two things: its own `config`, and a `host` object. It imports nothing
from the application, reads no globals, and has no database handle.

```ts
interface WidgetHost {
  readonly instanceId: string;
  saveConfig(next: Record<string, unknown>): Promise<void>;
  query(operation: string, args?: unknown): Promise<unknown>;   // not implemented yet; throws
}

interface WidgetProps<TConfig = Record<string, unknown>> {
  config: TConfig;
  host: WidgetHost;
}
```

Defined in `web/src/widgets/types.ts`.

## Why it is shaped like this

Widgets will be third-party. Third-party code running in-process can read every token this origin
holds, patch `fetch`, and walk the DOM — so it eventually has to move into an iframe, and talk to
the host over `postMessage` (probably via Comlink, which makes the far side look like ordinary
awaited calls).

That move is cheap **only if the contract was already shaped for it**. Three rules:

1. **Every host method is async.** `postMessage` cannot be synchronous. A widget that reads state
   synchronously today breaks the day it is sandboxed.
2. **Only structured-cloneable values cross the boundary.** No React elements, no class instances,
   no callbacks as arguments — none of it survives serialisation.
3. **Nothing exposes the host application.** `query` names an operation the host decides how to
   answer. It is not a query language and emphatically not SQL.

Follow those and the migration is: keep the interface, back it with postMessage, render each widget
in an iframe. Widget authors change nothing.

**A Web Worker is the cheap middle step** — real JS isolation, but no DOM. Useful for
compute-heavy widgets, useless for UI ones.

## What is NOT a boundary today

`WidgetBoundary` (`web/src/components/widget-boundary.tsx`) catches render errors so one broken
widget costs its own card rather than the page. **It is not a security boundary.** In-process
widget code can still reach anything this origin can.

**OPEN — the gate for sandboxing: before the first widget we did not write runs against real
customer data.** Until then, in-process is a deliberate, dated concession, not an oversight.

## Adding a widget type

Two steps, in this order:

1. **INSERT into `widget_types`** — type, version, display name, `config_schema` (JSON Schema),
   default and minimum size. This is what makes it appear in the picker; the catalogue is data.
   `entry_url` stays `NULL` for first-party components.
2. **Register the component** in `web/src/widgets/registry.ts` under the same `type` key.

A type present in the database with no component renders as "not installed" rather than crashing —
which is the behaviour you want the day a widget is published before the client that renders it
ships.

The JSON Schema is load-bearing: the API compiles it with Ajv to fill defaults on insert and to
reject invalid settings on save. There is one definition of a widget's config, and it is the
database column.
