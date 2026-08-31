import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { withUser } from "../identity";
import { collectOutputs, discardStaging, outputDir } from "../storage/staging";
import type { StagedInput } from "../storage/staging";

/**
 * Spawning the executor, and taking ownership of what it produced.
 *
 * `tools/runner/execute.py` runs one operation in Docker and writes a result
 * JSON to stdout plus a JSONL event stream to a file. Everything here is on the
 * trusted side of the boundary: the executor gets a directory of inputs and a
 * directory to write into, never a database connection.
 *
 * WHY THE RUN IS NOT AWAITED IN A PROCEDURE. Every tRPC resolver runs inside
 * `withUser`, which holds a pooled connection with an open transaction and the
 * `app.user_id` GUC set — that is how row-level security is enforced. Awaiting a
 * three-minute alignment there would hold a connection and a transaction for
 * three minutes, blocking vacuum and burning a pool slot per concurrent run. On
 * a laptop with one user that looks fine, which is exactly why it would reach
 * production before anyone noticed.
 *
 * So the procedure stages, spawns, and returns a run id in milliseconds; the
 * child's exit handler opens a NEW transaction to write the outcome back. That
 * is the same single path we settled on — enqueue, return an id, everything else
 * over events — with no queue table, because there is no second machine yet. The
 * day there is, the spawn becomes a queue push and nothing above this changes.
 */

const REPO_ROOT = process.env.TOOLS_DIR
  ? path.dirname(process.env.TOOLS_DIR)
  : path.join(process.cwd(), "..");
const TOOLS_DIR = process.env.TOOLS_DIR ?? path.join(REPO_ROOT, "tools");
const PYTHON = process.env.RUNNER_PYTHON ?? "python3";

/** Short, unguessable, and legal in a directory name. See runDir's check. */
export function newRunId(): string {
  return randomBytes(6).toString("hex");
}

export type ExecutorResult = {
  outcome: string;
  wall_seconds?: number;
  machine_class?: string;
  problems?: unknown[];
  evidence?: Record<string, unknown>;
  outputs?: unknown[];
};

/**
 * Start a run. Returns as soon as the child is spawned.
 *
 * The caller must already have staged inputs and prepared the output directory
 * inside its own transaction — this only launches, so that nothing long-running
 * happens while a transaction is open.
 */
export function startRun(options: {
  runId: string;
  ownerId: string;
  adapterId: string;
  operation: string;
  staged: StagedInput[];
  eventsPath: string;
  outputParent: string | null;
}): void {
  const argv = [
    path.join(TOOLS_DIR, "runner", "execute.py"),
    "--run-id",
    options.runId,
    "--adapter",
    path.join(TOOLS_DIR, options.adapterId),
    "--operation",
    options.operation,
    "--output-dir",
    outputDir(options.runId),
    "--events",
    options.eventsPath,
  ];

  for (const input of options.staged) {
    argv.push("--input", `${input.port}=${input.path}`);
    // A path is a promise about a location; a hash is a statement about content.
    // Staging and execution are separate steps, and this is the gap where a
    // stale mount or a reused directory would otherwise go unnoticed.
    argv.push("--hash", `${input.port}=${input.contentHash}`);
  }

  const child: ChildProcess = spawn(PYTHON, argv, {
    cwd: REPO_ROOT,
    // The executor inherits nothing it does not need. It builds and runs
    // containers; it must not hold a database URL or any other credential.
    // NODE_ENV only because Next's generated ProcessEnv type requires it; it is
    // not a credential and the executor ignores it.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: process.env.NODE_ENV,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  child.on("error", (error: Error) => {
    // The executor never started — a missing interpreter, a bad path. That is
    // ours, not the tool's, and it must not read as the tool failing.
    void finish(options, {
      outcome: "image_missing",
      problems: [`the executor could not be started: ${error.message}`],
    });
  });

  child.on("close", (code: number | null) => {
    let result: ExecutorResult;
    try {
      result = JSON.parse(stdout) as ExecutorResult;
    } catch {
      // No parseable result is itself a platform failure, and the exit code
      // alone cannot say which outcome it was. Never guess one.
      result = {
        outcome: "image_missing",
        problems: [
          `the executor produced no readable result (exit ${code})`,
          stderr.slice(-2000) || "no stderr",
        ],
      };
    }
    void finish(options, result);
  });
}

/**
 * Write the outcome back and take ownership of the outputs.
 *
 * A fresh transaction, opened long after the request that started the run has
 * returned. It goes through `withUser` like every other write: there is no
 * request to inherit an identity from, and every policy on `runs`, `nodes` and
 * `files` reads that GUC — without it these writes would be invisible to their
 * own owner. `withUser` also sets it parameterised rather than as a literal,
 * which is the thing its own comment warns about.
 */
async function finish(
  options: { runId: string; ownerId: string; outputParent: string | null },
  result: ExecutorResult,
): Promise<void> {
  try {
    await withUser(options.ownerId, async (tx) => {
      // Re-detected here rather than trusted: the executor reports what it
      // observed, and a disagreement between its detection and ours is a finding
      // about the file, not a reason to believe either side.
      const collected =
        result.outcome === "ok"
          ? await collectOutputs(tx, options.ownerId, options.runId, options.outputParent)
          : [];

      await tx
        .updateTable("runs")
        .set({
          outcome: result.outcome,
          wallSeconds: result.wall_seconds ?? null,
          result: JSON.stringify({ ...result, collected }),
          finishedAt: new Date(),
        })
        .where("id", "=", options.runId)
        .execute();
    });
  } finally {
    // The bytes are in the blob store by now; what is left is a copy the tool
    // may have written to. Kept on failure, since the workdir is the evidence.
    if (result.outcome === "ok") await discardStaging(options.runId);
  }
}
