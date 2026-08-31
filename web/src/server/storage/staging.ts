import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import type { Kysely } from "kysely";

import type { DB } from "@/lib/db-types";

import { materialise, putBlob } from "./blobs";
import { detect } from "../tools/detect";

/**
 * The boundary between stored files and the executor.
 *
 * Two crossings, and BOTH are driven from this side. The executor runs
 * untrusted tool code: it holds no database connection, has no credential into
 * tenant storage, and never learns a blob key. It is handed a directory of
 * inputs and writes into a directory of outputs, and everything either side of
 * that is done here, by code that knows who the caller is.
 *
 * The same argument settled the run-event sink: a producer that may be running
 * somebody else's code does not get to be a database client. Inverting it —
 * letting the executor write into the file tree — would be handing a credential
 * to the one component specifically designed to run software we did not write.
 *
 * The local staging directory here is interchangeable with a per-run volume on a
 * worker; what has to survive is the shape, not the mechanism.
 */

const STAGING_DIR = process.env.RUN_STAGING_DIR ?? path.join(process.cwd(), ".runs");

export type StagedInput = {
  port: string;
  /** Absolute path the executor may read. */
  path: string;
  /** So the executor can verify it mounted the bytes we meant. */
  contentHash: string;
  portType: string | null;
  portFormat: string | null;
};

export type CollectedOutput = {
  port: string;
  nodeId: string;
  name: string;
  byteSize: number;
  portType: string | null;
  portFormat: string | null;
  detection: string;
  /** Null when the output is not sequence-shaped and the question does not arise. */
  alphabet: string | null;
};

function runDir(runId: string): string {
  // Run ids come from the platform, never from a user, but a traversal here
  // would write outside the staging root and the check is one line.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) throw new Error("unusable run id");
  return path.join(STAGING_DIR, runId);
}

/**
 * Copy the bytes for each named port into a directory the executor can mount.
 *
 * Files are staged under the PORT's name, never the user's filename. Two
 * reasons, and the second is the one that matters: the manifest's command
 * template substitutes on port name, and a tool must not be able to observe
 * where its data came from — a filename can carry a project, a patient, a
 * hypothesis.
 *
 * Reads go through the caller's transaction, so row-level security decides what
 * may be staged. A file the caller cannot see does not resolve, and the port
 * comes back missing rather than staged from someone else's data.
 */
export async function stageInputs(
  tx: Kysely<DB>,
  runId: string,
  inputs: { port: string; fileId: string; extension?: string }[],
): Promise<{ dir: string; staged: StagedInput[]; missing: string[] }> {
  const dir = path.join(runDir(runId), "in");
  const staged: StagedInput[] = [];
  const missing: string[] = [];

  for (const input of inputs) {
    // Base tables, not the `tree_files` view: a view cannot carry NOT NULL, and
    // a nullable blob key here would be a check for a state the schema forbids.
    const file = await tx
      .selectFrom("files")
      .innerJoin("nodes", "nodes.id", "files.nodeId")
      .select(["files.blobKey", "files.contentHash", "files.portType", "files.portFormat"])
      .where("nodes.id", "=", input.fileId)
      .where("nodes.kind", "=", "file")
      .executeTakeFirst();

    if (!file) {
      missing.push(input.port);
      continue;
    }

    staged.push({
      port: input.port,
      path: await materialise(file.blobKey, dir, `${input.port}${input.extension ?? ""}`),
      contentHash: file.contentHash,
      portType: file.portType,
      portFormat: file.portFormat,
    });
  }

  return { dir, staged, missing };
}

/** Where the executor writes. Pure path; see `prepareOutputDir` before a run. */
export function outputDir(runId: string): string {
  return path.join(runDir(runId), "out");
}

/**
 * Create the output directory, and refuse to reuse a dirty one.
 *
 * The executor owns everything under this path, so it must start empty — but
 * nothing made that true until now, and the failure was silent in the worst
 * way: a reused run id would leave a previous run's outputs in place, and
 * `collectOutputs` would take ownership of them as though this run had produced
 * them. Wrong provenance on a real result, with no error anywhere.
 *
 * Throwing is right rather than clearing. A non-empty directory here means
 * either a run id collision or a previous run that was never cleaned up, and
 * both are bugs worth surfacing — silently deleting whatever is there would
 * destroy the evidence needed to work out which.
 */
export async function prepareOutputDir(runId: string): Promise<string> {
  const dir = outputDir(runId);
  await mkdir(dir, { recursive: true });

  const existing = await readdir(dir);
  if (existing.length > 0) {
    throw new Error(
      `output directory for run ${runId} is not empty (${existing.join(", ")}) — ` +
        `a reused run id, or a previous run that was never discarded`,
    );
  }
  return dir;
}

/**
 * Take ownership of what a run produced.
 *
 * Everything in the output directory is treated as untrusted content that
 * happens to be on our disk. It is read, hashed, stored and type-detected here,
 * exactly as an upload would be — the executor's claim about what it wrote is
 * not evidence, and re-detecting is what catches an operation that declared
 * Alignment and produced an HTML error page.
 *
 * Results land as file nodes in the caller's tree, so a run's outputs are
 * ordinary files: renamable, movable, usable as the input to the next tool.
 */
export async function collectOutputs(
  tx: Kysely<DB>,
  ownerId: string,
  runId: string,
  parentId: string | null,
): Promise<CollectedOutput[]> {
  const dir = outputDir(runId);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return []; // nothing written; the run's outcome says why
  }

  const last = await tx
    .selectFrom("nodes")
    .select(({ fn }) => fn.max("position").as("position"))
    .where((eb) => (parentId === null ? eb("parentId", "is", null) : eb("parentId", "=", parentId)))
    .executeTakeFirst();
  let position = Number(last?.position ?? 0);

  const collected: CollectedOutput[] = [];
  for (const entry of entries.sort()) {
    const bytes = await readFile(path.join(dir, entry));
    if (bytes.byteLength === 0) continue; // an empty output is missing_output, not a file

    const [stored, detection] = await Promise.all([putBlob(bytes), detect(entry, bytes)]);

    const node = await tx
      .insertInto("nodes")
      .values({
        ownerId,
        parentId,
        kind: "file",
        // Prefixed with the run so a second run of the same tool does not
        // collide with the first, which the tree would refuse outright.
        name: `${runId}-${entry}`,
        position: (position += 1),
      })
      .returning(["id", "name"])
      .executeTakeFirstOrThrow();

    await tx
      .insertInto("files")
      .values({
        nodeId: node.id,
        blobKey: stored.key,
        byteSize: stored.size,
        contentHash: stored.hash,
        portType: detection.type,
        portFormat: detection.type ? detection.format : null,
        detection: detection.detail,
        // Outputs are typed exactly as uploads are, alphabet included. Without
        // this a tool's result could never feed a port that constrains alphabet
        // - which is the whole pipeline case: MAFFT's alignment has to satisfy
        // FastTree's nucleotide-only input, and it cannot do that unlabelled.
        alphabet: detection.alphabet?.alphabet ?? null,
        alphabetConfidence: detection.alphabet?.confidence ?? null,
      })
      .execute();

    collected.push({
      port: path.parse(entry).name,
      nodeId: node.id,
      name: node.name,
      byteSize: stored.size,
      portType: detection.type,
      portFormat: detection.format,
      detection: detection.detail,
      alphabet: detection.alphabet?.alphabet ?? null,
    });
  }

  return collected;
}

/**
 * Delete a run's staging directory.
 *
 * Only safe once collectOutputs has committed — the bytes are in the blob store
 * by then, and what is left here is a copy the executor may have written to.
 */
export async function discardStaging(runId: string): Promise<void> {
  await rm(runDir(runId), { recursive: true, force: true });
}
