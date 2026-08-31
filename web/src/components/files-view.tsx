"use client";

import { useRouter } from "next/navigation";

import { ExperimentEditor } from "./experiment-editor";
import { FileTree } from "./file-tree";

/**
 * The Experiments surface: a file tree on the left, the open experiment on the
 * right. Folders organise; experiments hold the document.
 */
export function FilesView({ nodeId }: { nodeId?: string }) {
  const router = useRouter();

  return (
    <div className="flex h-screen min-w-0">
      <FileTree
        selectedId={nodeId}
        onSelect={(node) => {
          // Clicking a folder expands it; only an experiment is a destination.
          if (node.kind === "experiment") router.push(`/files/${node.id}`);
        }}
      />

      <div className="min-w-0 flex-1">
        {nodeId ? (
          <ExperimentEditor nodeId={nodeId} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              Pick an experiment, or make one. Folders nest as deep as you like — drag things
              around to reorganise.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
