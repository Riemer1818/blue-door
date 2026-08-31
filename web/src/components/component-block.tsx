"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { Suspense } from "react";

import { resolveWidget } from "@/widgets/registry";
import type { WidgetHost } from "@/widgets/types";
import { WidgetBoundary } from "./widget-boundary";

/**
 * One BlockNote block type that hosts any component from the library.
 *
 * Rather than a custom block per component — which would mean a code change and
 * a deploy every time a component is added — there is a single `component` block
 * carrying which type it is. What can be inserted comes from widget_types, the
 * same table the dashboard reads. One library, two surfaces.
 *
 * BlockNote props must be primitives, so the component's config travels as a
 * JSON string. That is the editor's constraint, not ours: everywhere else config
 * is jsonb.
 */
export const componentBlock = createReactBlockSpec(
  {
    type: "component",
    content: "none",
    propSchema: {
      componentType: { default: "" as string },
      config: { default: "{}" as string },
    },
  },
  {
    render: ({ block, editor }) => {
      const type = block.props.componentType;
      const Widget = resolveWidget(type);

      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(block.props.config || "{}") as Record<string, unknown>;
      } catch {
        // A hand-edited or truncated document should degrade to defaults, not
        // take the whole page down.
        config = {};
      }

      // The same host contract the dashboard implements. Here "save" means
      // "write it back into the document", and BlockNote's own change handling
      // takes it from there.
      const host: WidgetHost = {
        instanceId: block.id,
        saveConfig: async (next) => {
          editor.updateBlock(block, {
            props: { componentType: type, config: JSON.stringify(next) },
          });
        },
        query: async (operation) => {
          throw new Error(`Host operation "${operation}" is not implemented yet.`);
        },
      };

      return (
        <div className="my-1 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <WidgetBoundary widgetType={type}>
            <Suspense fallback={<span className="text-xs text-slate-400">Loading…</span>}>
              {Widget ? (
                <Widget config={config} host={host} />
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  No component registered for “{type}”.
                </span>
              )}
            </Suspense>
          </WidgetBoundary>
        </div>
      );
    },
  },
);
