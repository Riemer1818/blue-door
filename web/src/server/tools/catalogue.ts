import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Reads the adapter catalogue off disk.
 *
 * `tools/manifest.schema.json` is the single source; every surface is a
 * projection of it. This module is the projection's input side and holds no
 * per-tool knowledge — adding an adapter to `tools/` puts it on the page with no
 * change here.
 *
 * Known seam: this reads the repository's `tools/` directory, which works while
 * the app and the catalogue are checked out together. A deployed app will not
 * have them side by side, and at that point this loader gets a different
 * implementation behind the same shape. That is why nothing above it touches the
 * filesystem.
 *
 * Turbopack warns "dynamic filesystem access causes tracing of the whole
 * project" on the readdir below, because the path is a variable. That is the
 * honest cost of reading a catalogue that lives outside the app, and it goes
 * away with the loader, not before.
 */

const TOOLS_DIR = process.env.TOOLS_DIR ?? path.join(process.cwd(), "..", "tools");

export type Port = {
  name: string;
  type: string;
  format?: string;
  description?: string;
  /**
   * What this input demands beyond its type. Today only `alphabet`, and it
   * exists because BLU-22: a protein alignment and a DNA alignment are both
   * `Alignment/fasta`, so type alone let a protein alignment reach FastTree's
   * nucleotide-only input and produce a confident wrong tree.
   */
  requires?: { alphabet?: string };
  /**
   * An output whose alphabet is whatever the named input port carried.
   *
   * Most tools are pass-through: MAFFT aligns protein or DNA and emits whichever
   * it was given, so a fixed output alphabet would be a lie. This is what lets
   * the alphabet detected at the top of a pipeline propagate down the chain, and
   * why the RecA case is caught at step two even though MAFFT itself does not
   * care. An output carrying this has no alphabet until an input is chosen.
   */
  alphabetFrom?: string;
};

export type Operation = {
  name: string;
  description?: string;
  inputs: Port[];
  outputs: Port[];
  /** argv, never a shell string. Shown because it is the truth of what executes. */
  command: string[];
  timeoutSeconds?: number;
  stdin?: string;
  stdout?: string;
};

export type Tool = {
  id: string;
  version: string;
  description?: string;
  license?: string;
  image: string;
  machineClass: string;
  operations: Operation[];
  source: {
    repository?: string;
    ref?: string;
    commit?: string;
    imageOrigin?: string;
    dockerfile?: string;
  };
  provenance: {
    authoredBy?: string;
    authoredAt?: string;
    reviewedBy?: string;
    conformance?: { passedAt?: string; checks?: number; suiteVersion?: string };
  };
  measured?: { peakRssMb?: number; wallSeconds?: number; fixture?: string };
};

export type PortType = { name: string; description?: string; edam?: string; formats: string[] };

type RawPorts = Record<
  string,
  {
    type: string;
    format?: string;
    description?: string;
    requires?: { alphabet?: string };
    alphabet_from?: string;
  }
>;

function ports(raw: RawPorts | undefined): Port[] {
  return Object.entries(raw ?? {}).map(([name, port]) => ({
    name,
    type: port.type,
    format: port.format,
    description: port.description,
    requires: port.requires,
    alphabetFrom: port.alphabet_from,
  }));
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

export async function loadTools(): Promise<Tool[]> {
  let entries: string[];
  try {
    entries = await readdir(TOOLS_DIR);
  } catch {
    // No catalogue checked out is an empty catalogue, not a crash. The page says so.
    return [];
  }

  const tools: Tool[] = [];
  for (const entry of entries) {
    let raw: Record<string, unknown>;
    try {
      raw = await readJson(path.join(TOOLS_DIR, entry, "manifest.json"));
    } catch {
      continue; // not an adapter directory
    }

    const source = (raw.source ?? {}) as Record<string, string>;
    const provenance = (raw.provenance ?? {}) as Record<string, unknown>;
    const conformance = provenance.conformance as Record<string, unknown> | undefined;
    const measured = raw.measured as Record<string, unknown> | undefined;

    tools.push({
      id: String(raw.id),
      version: String(raw.version),
      description: raw.description as string | undefined,
      license: raw.license as string | undefined,
      image: String(raw.image),
      machineClass: String(raw.machine_class),
      operations: Object.entries(
        (raw.operations ?? {}) as Record<
          string,
          {
            description?: string;
            inputs?: RawPorts;
            outputs?: RawPorts;
            command?: string[];
            timeout_seconds?: number;
            stdin?: string;
            stdout?: string;
          }
        >,
      ).map(([name, op]) => ({
        name,
        description: op.description,
        inputs: ports(op.inputs),
        outputs: ports(op.outputs),
        command: op.command ?? [],
        timeoutSeconds: op.timeout_seconds,
        stdin: op.stdin,
        stdout: op.stdout,
      })),
      source: {
        repository: source.repository,
        ref: source.ref,
        commit: source.commit,
        imageOrigin: source.image_origin,
        dockerfile: source.dockerfile,
      },
      provenance: {
        authoredBy: provenance.authored_by as string | undefined,
        authoredAt: provenance.authored_at as string | undefined,
        reviewedBy: provenance.reviewed_by as string | undefined,
        conformance: conformance && {
          passedAt: conformance.passed_at as string | undefined,
          checks: conformance.checks as number | undefined,
          suiteVersion: conformance.suite_version as string | undefined,
        },
      },
      // Nothing fills this until the profiler lands (BLU-7). Absent must read as
      // absent, never as zero.
      measured: measured && {
        peakRssMb: measured.peak_rss_mb as number | undefined,
        wallSeconds: measured.wall_seconds as number | undefined,
        fixture: measured.fixture as string | undefined,
      },
    });
  }

  return tools.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadPortTypes(): Promise<PortType[]> {
  try {
    const raw = await readJson(path.join(TOOLS_DIR, "porttypes.json"));
    const types = (raw.types ?? {}) as Record<
      string,
      { description?: string; edam?: string; formats?: Record<string, unknown> }
    >;
    return Object.entries(types).map(([name, type]) => ({
      name,
      description: type.description,
      edam: type.edam,
      formats: Object.keys(type.formats ?? {}),
    }));
  } catch {
    return [];
  }
}

/** `Alignment/fasta` — the vocabulary the runner type-checks pipelines against. */
export function signature(port: Port): string {
  return port.format ? `${port.type}/${port.format}` : port.type;
}

/**
 * "I have an Alignment — what can I do with it?"
 *
 * Derived from manifests alone, no new data. The same relation the canvas will
 * draw; here it is listed.
 */
export function portTypeIndex(tools: Tool[]) {
  const index: Record<string, { producedBy: string[]; consumedBy: string[] }> = {};
  const entry = (key: string) => (index[key] ??= { producedBy: [], consumedBy: [] });

  for (const tool of tools) {
    for (const op of tool.operations) {
      const label = `${tool.id}.${op.name}`;
      for (const port of op.outputs) entry(signature(port)).producedBy.push(label);
      for (const port of op.inputs) entry(signature(port)).consumedBy.push(label);
    }
  }
  return index;
}
