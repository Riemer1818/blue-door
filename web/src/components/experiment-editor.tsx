"use client";

// filterSuggestionItems lives in core, not react — the react package re-exports
// most of the menu API but not this one.
import { BlockNoteSchema, filterSuggestionItems, type Block } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  useEditorChange,
} from "@blocknote/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { trpc } from "@/lib/trpc";
import { componentBlock } from "./component-block";

// One extra block type on top of everything BlockNote already gives us:
// paragraphs, headings, lists, tables, images, drag handles, slash menu.
const schema = BlockNoteSchema.create().extend({
  blockSpecs: { component: componentBlock() },
});

const SAVE_DEBOUNCE_MS = 800;

export function ExperimentEditor({ nodeId }: { nodeId: string }) {
  const node = trpc.tree.get.useQuery({ id: nodeId });
  const saveContent = trpc.tree.saveContent.useMutation();

  // The catalogue again, asked a different question: which components declare
  // the notebook surface? The dashboard asks the same table for its own.
  const catalog = trpc.dashboard.catalog.useQuery({ surface: "notebook" });

  if (node.isLoading) return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  if (node.error) return <p className="p-6 text-sm text-red-600">{node.error.message}</p>;
  if (node.data?.kind !== "experiment") {
    return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Pick an experiment from the tree.</p>;
  }

  return (
    // Keyed by id so switching experiments builds a fresh editor rather than
    // trying to swap a ProseMirror document underneath a live instance.
    <Editor
      key={nodeId}
      nodeId={nodeId}
      name={node.data.name}
      initialContent={node.data.content as unknown as Block[]}
      components={catalog.data ?? []}
      save={saveContent.mutate}
      saving={saveContent.isPending}
    />
  );
}

function Editor({
  nodeId,
  name,
  initialContent,
  components,
  save,
  saving,
}: {
  nodeId: string;
  name: string;
  initialContent: Block[];
  components: { type: string; displayName: string; description: string | null }[];
  save: (input: { id: string; content: unknown[] }) => void;
  saving: boolean;
}) {
  // BlockNote paints its own chrome, so it needs telling which way to go.
  const { resolvedTheme } = useTheme();

  const editor = useCreateBlockNote({
    schema,
    // An empty array is not a valid ProseMirror document; undefined lets
    // BlockNote start with its own empty paragraph.
    initialContent: initialContent.length > 0 ? initialContent : undefined,
  });

  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<unknown[] | null>(null);

  const flush = useCallback(() => {
    if (!pending.current) return;
    save({ id: nodeId, content: pending.current });
    pending.current = null;
    setDirty(false);
  }, [nodeId, save]);

  useEditorChange(() => {
    pending.current = editor.document;
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, editor);

  // Leaving the page mid-debounce must not lose the last edit — same rule as the
  // dashboard's config saver.
  useEffect(() => {
    const onHide = () => {
      if (!pending.current) return;
      const body = new Blob(
        [JSON.stringify({ json: { id: nodeId, content: pending.current } })],
        { type: "application/json" },
      );
      navigator.sendBeacon("/api/trpc/tree.saveContent", body);
      pending.current = null;
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
      onHide();
    };
  }, [nodeId]);

  // Every notebook component becomes a slash-menu item. Adding a component to
  // the library puts it in this menu; no code change here.
  const componentItems = useMemo(
    () =>
      components.map((component) => ({
        title: component.displayName,
        subtext: component.description ?? undefined,
        group: "Components",
        onItemClick: () => {
          editor.insertBlocks(
            [{ type: "component", props: { componentType: component.type, config: "{}" } }],
            editor.getTextCursorPosition().block,
            "after",
          );
        },
      })),
    [components, editor],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-baseline justify-between gap-4 border-b border-slate-200 px-8 py-4 dark:border-slate-800">
        <h1 className="truncate text-xl font-semibold">{name}</h1>
        <span className="shrink-0 text-xs text-slate-400">
          {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto py-6">
        <BlockNoteView editor={editor} slashMenu={false} theme={resolvedTheme === "dark" ? "dark" : "light"}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                [...getDefaultReactSlashMenuItems(editor), ...componentItems],
                query,
              )
            }
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
