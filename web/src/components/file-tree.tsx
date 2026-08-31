"use client";

import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";

import { trpc } from "@/lib/trpc";

type FlatNode = {
  id: string;
  parentId: string | null;
  kind: string;
  name: string;
  position: number;
};

type TreeNode = { id: string; name: string; kind: string; children?: TreeNode[] };

/** Flat rows in, nested tree out. Folders always get a children array so they stay droppable when empty. */
function buildTree(rows: FlatNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      kind: row.kind,
      ...(row.kind === "folder" ? { children: [] } : {}),
    });
  }

  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent?.children) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function FileTree({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (node: { id: string; kind: string }) => void;
}) {
  const utils = trpc.useUtils();
  const nodes = trpc.tree.list.useQuery();
  const rows = useMemo<FlatNode[]>(() => nodes.data ?? [], [nodes.data]);

  const refresh = () => {
    void utils.tree.list.invalidate();
    void utils.files.list.invalidate();
  };
  const create = trpc.tree.create.useMutation({ onSuccess: refresh });
  const rename = trpc.tree.rename.useMutation({ onSuccess: refresh });
  const move = trpc.tree.move.useMutation({ onSuccess: refresh });
  const remove = trpc.tree.remove.useMutation({ onSuccess: refresh });
  const upload = trpc.files.upload.useMutation({ onSuccess: refresh });
  const picker = useRef<HTMLInputElement>(null);

  const data = useMemo(() => buildTree(rows), [rows]);

  // react-arborist virtualizes, so it wants a pixel height. Measured rather than
  // guessed, and only from the observer callback — never synchronously in an effect.
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.max(200, entry.contentRect.height)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Where the caller wants a new item: inside the selected folder, beside the
  // selected experiment, otherwise at the root.
  const selected = rows.find((r) => r.id === selectedId);
  const targetParentId = selected
    ? selected.kind === "folder"
      ? selected.id
      : selected.parentId
    : null;

  const error = create.error ?? rename.error ?? move.error ?? remove.error ?? upload.error;

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-1 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Experiments</span>
        <span className="flex gap-0.5">
          <button
            onClick={() => create.mutate({ parentId: targetParentId, kind: "folder", name: "New folder" })}
            title="New folder"
            aria-label="New folder"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <Folder size={15} />
          </button>
          <button
            onClick={() => create.mutate({ parentId: targetParentId, kind: "experiment", name: "New experiment" })}
            title="New experiment"
            aria-label="New experiment"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <Plus size={15} />
          </button>
          <button
            onClick={() => picker.current?.click()}
            title="Upload a file"
            aria-label="Upload a file"
            disabled={upload.isPending}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800"
          >
            <Upload size={15} />
          </button>
        </span>
      </div>

      {/* Read in the browser and sent as base64 through tRPC. Small files only,
          which the server enforces — a tool page takes sequence files, and a
          genome needs a streaming upload this deliberately is not. */}
      <input
        ref={picker}
        type="file"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // so picking the same file twice still fires
          if (!file) return;
          const buffer = await file.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          }
          upload.mutate({
            parentId: targetParentId,
            name: file.name,
            content: btoa(binary),
          });
        }}
      />

      {error && <p className="px-3 py-2 text-xs text-red-600">{error.message}</p>}

      <div ref={box} className="min-h-0 flex-1 py-1">
        <Tree<TreeNode>
          data={data}
          width="100%"
          height={height}
          rowHeight={28}
          indent={14}
          openByDefault={false}
          selection={selectedId}
          onSelect={(picked) => {
            const node = picked[0];
            if (node) onSelect({ id: node.id, kind: node.data.kind });
          }}
          onRename={({ id, name }) => rename.mutate({ id, name })}
          onDelete={({ ids }) => ids.forEach((id) => remove.mutate({ id }))}
          onMove={({ dragIds, parentId, index }) => {
            // Fractional index: drop between two siblings and take the midpoint,
            // so nothing else has to be renumbered.
            const siblings = rows
              .filter((r) => (r.parentId ?? null) === (parentId ?? null) && !dragIds.includes(r.id))
              .sort((a, b) => a.position - b.position);
            const before = siblings[index - 1]?.position;
            const after = siblings[index]?.position;
            const position =
              before === undefined && after === undefined
                ? 0
                : before === undefined
                  ? after! - 1
                  : after === undefined
                    ? before + 1
                    : (before + after) / 2;

            for (const id of dragIds) move.mutate({ id, parentId: parentId ?? null, position });
          }}
        >
          {Row}
        </Tree>
      </div>

      {rows.length === 0 && !nodes.isLoading && (
        <p className="px-3 pb-3 text-xs text-slate-400">
          Nothing yet. Make a folder or an experiment.
        </p>
      )}
    </div>
  );
}

function Row({ node, style, dragHandle }: NodeRendererProps<TreeNode>) {
  const isFolder = node.data.kind === "folder";

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={() => (isFolder ? node.toggle() : node.select())}
      className={`group flex h-7 cursor-pointer items-center gap-1 rounded px-1 text-sm ${
        node.isSelected
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "hover:bg-slate-100 dark:hover:bg-slate-800"
      }`}
    >
      <span className="w-3.5 shrink-0 text-slate-400">
        {isFolder ? (node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
      </span>
      <span className="shrink-0 text-slate-400">
        {isFolder ? (
          node.isOpen ? (
            <FolderOpen size={14} />
          ) : (
            <Folder size={14} />
          )
        ) : node.data.kind === "file" ? (
          // A dataset and a write-up are different things and should not share
          // an icon: one you open to read, the other you feed to a tool.
          <File size={14} />
        ) : (
          <FileText size={14} />
        )}
      </span>

      {node.isEditing ? (
        <input
          autoFocus
          defaultValue={node.data.name}
          onBlur={(e) => node.submit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") node.reset();
            if (e.key === "Enter") node.submit(e.currentTarget.value);
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate" onDoubleClick={() => node.edit()}>
          {node.data.name}
        </span>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          void deleteNode(node);
        }}
        title="Delete"
        aria-label={`Delete ${node.data.name}`}
        className="hidden shrink-0 rounded p-0.5 text-slate-400 hover:text-red-600 group-hover:block"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function deleteNode(node: NodeApi<TreeNode>) {
  const what = node.data.kind === "folder" ? "folder and everything in it" : "experiment";
  if (window.confirm(`Delete this ${what}?`)) node.tree.delete(node.id);
}
