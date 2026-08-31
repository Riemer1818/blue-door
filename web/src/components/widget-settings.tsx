"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A settings form generated from a widget type's JSON Schema.
 *
 * The shell renders this, not the widget. Two reasons: a widget author gets a
 * settings UI for free by declaring a schema, and a third-party widget cannot
 * ship a settings form that writes config its own schema forbids — the server
 * validates against the same column this form was built from.
 *
 * Deliberately small: object schemas, one level deep, with string / enum /
 * boolean / number fields. Anything richer belongs in the widget itself.
 */

type JsonSchema = {
  properties?: Record<string, SchemaField>;
  required?: string[];
};

type SchemaField = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};

function label(key: string, field: SchemaField) {
  if (field.title) return field.title;
  // Fall back to the property name, de-camel-cased: showSeconds -> Show seconds.
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function WidgetSettings({
  title,
  schema,
  config,
  saving,
  error,
  onSave,
  onClose,
}: {
  title: string;
  schema: JsonSchema | null;
  config: Record<string, unknown>;
  saving: boolean;
  error: string | null;
  onSave: (next: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(config);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The panel only ever opens from a click, so this branch is not a hydration
  // hazard — it just keeps createPortal away from a server render.
  if (typeof document === "undefined") return null;

  const fields = Object.entries(schema?.properties ?? {});
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  // Portalled to the body: the card clips its own overflow, and a panel rendered
  // inside the grid item would also start a drag when grabbed by its background.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={`${title} settings`}
        className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold">{title} settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-sm text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          {fields.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">This widget has no settings.</p>
          )}

          {fields.map(([key, field]) => {
            const value = draft[key];
            const id = `setting-${key}`;

            return (
              <div key={key} className="flex flex-col gap-1">
                <label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {label(key, field)}
                </label>

                {field.enum ? (
                  <select
                    id={id}
                    value={String(value ?? field.default ?? "")}
                    onChange={(e) => set(key, e.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    {field.enum.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : field.type === "boolean" ? (
                  <input
                    id={id}
                    type="checkbox"
                    checked={Boolean(value ?? field.default)}
                    onChange={(e) => set(key, e.target.checked)}
                    className="h-4 w-4 self-start"
                  />
                ) : field.type === "integer" || field.type === "number" ? (
                  <input
                    id={id}
                    type="number"
                    value={Number(value ?? field.default ?? 0)}
                    min={field.minimum}
                    max={field.maximum}
                    step={field.type === "integer" ? 1 : "any"}
                    onChange={(e) => set(key, e.target.value === "" ? "" : Number(e.target.value))}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                ) : (
                  <input
                    id={id}
                    type="text"
                    value={String(value ?? field.default ?? "")}
                    maxLength={field.maxLength}
                    onChange={(e) => set(key, e.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                )}

                {field.description && (
                  <span className="text-xs text-slate-400">{field.description}</span>
                )}
              </div>
            );
          })}

          {/* The server validates against the same schema this form was built
              from, so a rejection here means the form is wrong — worth showing. */}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={saving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
