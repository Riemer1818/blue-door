"use client";

import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";

import { ExperimentEditor } from "./experiment-editor";
import { FileTree } from "./file-tree";
import { FileViewer } from "./file-viewer";

/**
 * The Experiments surface: a tree on the left, whatever is open on the right.
 *
 * Three kinds of node now. Folders organise, experiments hold a document, and
 * files hold bytes a tool can consume. They share one tree deliberately — data
 * belongs beside the write-up that used it, and a second hierarchy would be a
 * second place to get ownership wrong.
 */
export function FilesView({ nodeId }: { nodeId?: string }) {
  const router = useRouter();

  // The tree already has every node cached, so the kind costs no extra request.
  const nodes = trpc.tree.list.useQuery();
  const kind = nodes.data?.find((node) => node.id === nodeId)?.kind;

  return (
    <div className="flex h-screen min-w-0">
      <FileTree
        selectedId={nodeId}
        onSelect={(node) => {
          // Clicking a folder expands it; the other two are destinations.
          if (node.kind !== "folder") router.push(`/files/${node.id}`);
        }}
      />

      <div className="min-w-0 flex-1 overflow-auto">
        {nodeId && kind === "file" ? (
          <FileViewer nodeId={nodeId} />
        ) : nodeId && kind === "experiment" ? (
          <ExperimentEditor nodeId={nodeId} />
        ) : nodeId && nodes.isLoading ? (
          <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              Pick an experiment, or make one. Upload a file to use it as a tool input. Folders
              nest as deep as you like — drag things around to reorganise.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
