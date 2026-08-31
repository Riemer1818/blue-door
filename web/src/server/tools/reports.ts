import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Reads wrap reports off disk — the artifact a human reviews before an
 * agent-authored adapter reaches the catalogue.
 *
 * `tools/agent/report.py` is the source of this shape (`schema_version` 0.1).
 * The agent emits two things per run: a JSONL event stream, which is the
 * narrative, and one `report.json`, which is the structured summary. This reads
 * the latter, deliberately and only. Folding several hundred events to answer
 * "was the license found or guessed" would repeat the mistake of parsing
 * conform.py's coloured output.
 *
 * Layout expected: WRAP_RUNS_DIR contains one directory per run, named for its
 * run id, each holding `report.json`. Same seam as the catalogue loader — this
 * works while the app and the runs directory are checked out together, and gets
 * a different implementation behind the same shape once they are not.
 */

const RUNS_DIR = process.env.WRAP_RUNS_DIR ?? path.join(process.cwd(), "..", "tools", ".runs");

/**
 * A value together with how it was arrived at.
 *
 * The whole point is that provenance is a field, never the absence of one.
 * "no license" and "assumed MIT because setup.py says so but there is no LICENSE
 * file" must not both arrive as a missing key — the second is the one that
 * becomes a legal problem quietly, and it is only visible if it is stated.
 */
export type Stated = {
  value: string | null;
  basis: "found" | "assumed" | "unknown";
  note?: string;
};

export type Caveat = {
  /**
   * `license_unknown` | `text_fallback` | `ambiguous_image` | `untested_path`,
   * and the list is open by agreement. An unrecognised kind renders generically
   * rather than being dropped — a caveat nobody anticipated is still a caveat,
   * and silently discarding it would defeat the point of deriving them.
   */
  kind: string;
  detail: string;
  where?: string;
};

/** Declared by the agent's peer session. None of these means the tool is ready. */
export type AgentOutcome = "conformant" | "needs_review" | "gave_up" | "rejected";

export type WrapReport = {
  schemaVersion: string;
  runId: string;
  adapterId: string;
  requested: { name?: string; url?: string | null };
  outcome: AgentOutcome;
  seconds: number;

  image: {
    reference?: string | null;
    digest?: string | null;
    origin?: "registry" | "built_from_source";
    basis?: string;
    note?: string;
    candidates: string[];
    /**
     * Which candidate the agent picked, tag-shaped, before it was resolved to a
     * digest. Null when the image was built from source rather than chosen.
     *
     * Exists so `ambiguous_image` compares a choice to a choice. Comparing the
     * resolved digest reference against the tag-shaped candidate list made the
     * caveat fire on every correctly-pinned run, which would have trained
     * reviewers to skip the one caveat covering the agent's own judgement.
     */
    chosenCandidate?: string | null;
  };
  source: { repository?: string; ref?: string; commit?: string };
  version: Stated;
  license: Stated;

  /** What is needed to pick the run back up — the third path at the gate. */
  session: { sdkSessionId?: string | null; resumable: boolean; resumeHint: string };

  /** Promotion is a copytree. Show the exact file list rather than infer it. */
  promotable: string[];
  rejectedFiles: { path: string; why: string }[];

  manifest: Record<string, unknown> | null;
  conformance: {
    passed?: boolean;
    stage?: string;
    checks?: number;
    failures?: { case?: string; operation?: string; port?: string; reason?: string }[];
    /** Per case and operation, present on a pass as well as a failure. */
    results?: { case?: string; operation?: string; status?: string; detail?: string }[];
    warnings?: string[];
    error?: string;
  };
  /**
   * `workspace.verify()` output. Empty when clean.
   *
   * Non-empty does NOT imply the adapter is bad. The check cannot attribute a
   * change, so concurrent work by a human in the same worktree trips it exactly
   * as an agent writing to the repository would — that is what happened on the
   * first real run, where conformance passed every check and the run was still
   * rejected. The strings name the changed paths, and that naming is the whole
   * diagnosis, so they are rendered verbatim.
   */
  guardrails: string[];
  /**
   * Outputs first: a `Text` output means nothing downstream can consume it,
   * which is a strictly worse finding than a `Text` input, and an operation can
   * name an input and an output identically (`add.alignment` does).
   */
  portTypesUsed: {
    operation: string;
    port: string;
    type: string;
    direction?: "input" | "output";
  }[];
  probes: {
    image?: string;
    /** argv, never a shell string — and routinely a long `sh -c` one-liner. */
    command: string[];
    /** null when the probe never completed. Absent and zero are different things. */
    exitCode: number | null;
    ms?: number;
  }[];
  caveats: Caveat[];
};

const BASES = new Set(["found", "assumed", "unknown"]);

function stated(raw: unknown): Stated {
  const value = (raw ?? {}) as Record<string, unknown>;
  const basis = String(value.basis ?? "unknown");
  return {
    value: (value.value as string | null) ?? null,
    // An unrecognised basis reads as `unknown` rather than as settled. Only
    // `found` may ever look settled, so anything unparseable fails closed.
    basis: (BASES.has(basis) ? basis : "unknown") as Stated["basis"],
    note: (value.note as string) || undefined,
  };
}

const OUTCOMES = new Set(["conformant", "needs_review", "gave_up", "rejected"]);

/** Sort key for port direction. Undirected ports sort between the two. */
function rank(direction?: "input" | "output"): number {
  return direction === "output" ? 0 : direction === "input" ? 2 : 1;
}

function normalise(raw: Record<string, unknown>): WrapReport {
  const image = (raw.image ?? {}) as Record<string, unknown>;
  const source = (raw.source ?? {}) as Record<string, string>;
  const session = (raw.session ?? {}) as Record<string, unknown>;
  const outcome = String(raw.outcome ?? "");

  return {
    schemaVersion: String(raw.schema_version ?? ""),
    runId: String(raw.run_id ?? ""),
    adapterId: String(raw.adapter_id ?? ""),
    requested: (raw.requested ?? {}) as WrapReport["requested"],
    // An unknown outcome is treated as needing a person, never as conformant.
    outcome: (OUTCOMES.has(outcome) ? outcome : "needs_review") as AgentOutcome,
    seconds: Number(raw.seconds ?? 0),

    image: {
      reference: (image.reference as string | null) ?? null,
      digest: (image.digest as string | null) ?? null,
      origin: image.origin as WrapReport["image"]["origin"],
      basis: image.basis as string | undefined,
      note: image.note as string | undefined,
      candidates: (image.candidates as string[]) ?? [],
      chosenCandidate: (image.chosen_candidate as string | null) ?? null,
    },
    source: { repository: source.repository, ref: source.ref, commit: source.commit },
    version: stated(raw.version),
    license: stated(raw.license),

    session: {
      sdkSessionId: (session.sdk_session_id as string | null) ?? null,
      resumable: Boolean(session.resumable),
      resumeHint: String(session.resume_hint ?? ""),
    },

    promotable: (raw.promotable as string[]) ?? [],
    rejectedFiles: (raw.rejected_files as WrapReport["rejectedFiles"]) ?? [],

    manifest: (raw.manifest as Record<string, unknown> | null) ?? null,
    conformance: (raw.conformance ?? {}) as WrapReport["conformance"],
    guardrails: (raw.guardrails as string[]) ?? [],
    portTypesUsed: (
      (raw.port_types_used as
        | { operation: string; port: string; type: string; direction?: "input" | "output" }[]
        | undefined) ?? []
    )
      .map((p) => ({
        operation: p.operation,
        port: p.port,
        type: p.type,
        direction: p.direction,
      }))
      // Outputs first — the more serious finding when either is Text. Reports
      // written before direction existed carry none, and keep their order.
      .sort((a, b) => rank(a.direction) - rank(b.direction)),
    probes: (
      (raw.probes as
        | { image?: string; command?: string[] | string; exit_code?: number | null; ms?: number }[]
        | undefined) ?? []
    ).map((p) => ({
      image: p.image,
      command: Array.isArray(p.command) ? p.command : p.command ? [p.command] : [],
      exitCode: p.exit_code ?? null,
      ms: p.ms,
    })),
    caveats: (raw.caveats as Caveat[]) ?? [],
  };
}

export async function loadReports(): Promise<WrapReport[]> {
  let entries: string[];
  try {
    entries = await readdir(RUNS_DIR);
  } catch {
    // No runs directory is no runs, not a crash. The page says so.
    return [];
  }

  const reports: WrapReport[] = [];
  for (const entry of entries) {
    try {
      const raw = JSON.parse(
        await readFile(path.join(RUNS_DIR, entry, "report.json"), "utf8"),
      ) as Record<string, unknown>;
      reports.push(normalise(raw));
    } catch {
      continue; // not a run directory
    }
  }

  // Newest first once runs carry a timestamp; run id is stable and sortable
  // enough meanwhile, and a stable order beats an arbitrary one.
  return reports.sort((a, b) => b.runId.localeCompare(a.runId));
}

export async function loadReport(runId: string): Promise<WrapReport | null> {
  return (await loadReports()).find((r) => r.runId === runId) ?? null;
}

/**
 * Two buckets, and the split is the whole UI.
 *
 * `conformant` is "ready for you to approve" — the cheap approve. The other
 * three all mean a person has to think. Nothing here is ever "done": promotion
 * is a human action by design, and no outcome anticipates it.
 */
export function needsThought(outcome: AgentOutcome): boolean {
  return outcome !== "conformant";
}

/**
 * Whether a fact may be rendered as settled. Only `found` qualifies — an
 * assumption that looks established is worse than a visible gap.
 */
export function isSettled(fact: Stated): boolean {
  return fact.basis === "found";
}
