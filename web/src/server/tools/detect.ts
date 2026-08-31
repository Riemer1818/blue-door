import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * What type is this file?
 *
 * The runner asks a narrower question — `run.py`'s `sniff()` checks whether a
 * file matches a type the manifest already *declared*. Here nothing has been
 * declared, so this has to choose, and choosing needs rules the runner does not.
 *
 * The vocabulary and the sniffers come from `tools/porttypes.json`, deliberately
 * the same file: a file we accept for a port must be one the runner will accept
 * at execution, and two implementations of "is this an alignment" would disagree
 * eventually. This adds only the ordering.
 *
 * ORDERING, and it is the whole of the design:
 *
 * Sniffers overlap. `Alignment/fasta` and `Sequence/fasta` both match `^>`, and
 * an alignment IS valid FASTA — the difference is that every record is the same
 * length. So the more specific type has to be tried first, or every alignment is
 * detected as plain sequence and the type that exists to prevent feeding
 * unaligned data to a tree builder never fires.
 *
 * TEXT IS NOT A FALLBACK HERE. Its sniffer is `.`, which matches every file that
 * is not empty, so allowing it as a general answer would type everything and
 * make every file look ready to use. It is offered only when the extension asks
 * for it. An unrecognised file returns no type, which is honest and leaves the
 * user a real reason why it is not selectable — the same argument that makes a
 * `Text` port a caveat rather than a success.
 */

const TOOLS_DIR = process.env.TOOLS_DIR ?? path.join(process.cwd(), "..", "tools");

export type Detection = {
  type: string | null;
  format: string | null;
  /** Why detection concluded this. Shown to a user asking why a file is unusable. */
  detail: string;
};

type Format = {
  extensions?: string[];
  sniff?: string;
  structure?: string;
  comment_prefix?: string;
};

type Candidate = {
  type: string;
  format: string;
  spec: Format;
  /** Lower is tried first. */
  rank: number;
};

let cached: Candidate[] | null = null;

async function candidates(): Promise<Candidate[]> {
  if (cached) return cached;
  let raw: Record<string, { formats?: Record<string, Format> }>;
  try {
    const parsed = JSON.parse(await readFile(path.join(TOOLS_DIR, "porttypes.json"), "utf8")) as {
      types?: Record<string, { formats?: Record<string, Format> }>;
    };
    raw = parsed.types ?? {};
  } catch {
    return [];
  }

  const list: Candidate[] = [];
  for (const [type, spec] of Object.entries(raw)) {
    for (const [format, formatSpec] of Object.entries(spec.formats ?? {})) {
      if (!formatSpec.sniff) continue; // Directory has none, and is not a file
      list.push({
        type,
        format,
        spec: formatSpec,
        // A format asserting structure is strictly more specific than one that
        // only matches a first line, so it earns the first look. Text goes last
        // and only ever wins on extension.
        rank: formatSpec.structure ? 0 : type === "Text" ? 2 : 1,
      });
    }
  }
  cached = list.sort((a, b) => a.rank - b.rank);
  return cached;
}

/** Every FASTA record the same length — what makes an alignment an alignment. */
function equalLengthRecords(text: string): [boolean, string] {
  const lengths: number[] = [];
  let current: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith(">")) {
      if (current !== null) lengths.push(current);
      current = 0;
    } else if (current !== null) {
      current += line.trim().length;
    }
  }
  if (current !== null) lengths.push(current);

  if (lengths.length < 2) return [false, "fewer than two records; nothing to be aligned against"];
  const distinct = [...new Set(lengths)];
  if (distinct.length !== 1) {
    return [false, `records differ in length ${distinct.sort((a, b) => a - b).join(", ")} - unaligned`];
  }
  return [true, `${lengths.length} records of ${lengths[0]} columns`];
}

function newickTerminated(text: string): [boolean, string] {
  const stripped = text.trim();
  if (!stripped.endsWith(";")) return [false, "Newick must terminate with ';'"];
  const open = (stripped.match(/\(/g) ?? []).length;
  const close = (stripped.match(/\)/g) ?? []).length;
  if (open !== close) return [false, "unbalanced parentheses"];
  return [true, `${(stripped.match(/,/g) ?? []).length + 1} leaves`];
}

// A closed, named set, mirroring run.py. Allowing arbitrary code per type would
// put tool knowledge back into the detector; BLU-8 moves these into the type's
// own directory as a sandboxed artifact, at which point this table goes away.
const STRUCTURE: Record<string, (text: string) => [boolean, string]> = {
  equal_length_records: equalLengthRecords,
  newick_terminated: newickTerminated,
};

function matchesExtension(filename: string, spec: Format): boolean {
  const lower = filename.toLowerCase();
  // Longest first, so `.aln.fasta` beats `.fasta` when both are declared.
  return [...(spec.extensions ?? [])]
    .sort((a, b) => b.length - a.length)
    .some((extension) => lower.endsWith(extension));
}

function firstMeaningfulLine(text: string, commentPrefix?: string): string | null {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // Provenance headers are not type evidence.
    if (commentPrefix && line.startsWith(commentPrefix)) continue;
    return line;
  }
  return null;
}

/**
 * Content decides; the filename only breaks ties.
 *
 * A file named `.fasta` holding an HTML error page is not a FASTA, and that is
 * exactly the case worth catching — it is how a failed download becomes a
 * confidently wrong pipeline result.
 */
export async function detect(filename: string, bytes: Buffer): Promise<Detection> {
  const text = bytes.toString("utf8");
  if (text.trim().length === 0) return { type: null, format: null, detail: "the file is empty" };

  const all = await candidates();
  if (all.length === 0) {
    return { type: null, format: null, detail: "no port-type vocabulary is available" };
  }

  let structuralMiss: string | null = null;

  /**
   * The extension narrows the field before content decides among what is left.
   *
   * Sniffers are looser than they look: `Table/csv` matches any line containing
   * a comma, which is most prose and every Newick tree. Without this, a `.txt`
   * of ordinary sentences detects as CSV and a truncated `.nwk` detects as CSV
   * too — both were real failures before this existed.
   *
   * So the filename is evidence, and content must corroborate it rather than
   * override it. A file whose extension is known to the vocabulary is only ever
   * given a type that extension allows; one whose extension means nothing falls
   * back to content alone, minus `Text`, which would otherwise take everything.
   *
   * The case this must NOT break is a failed download saved as `.fasta`: the
   * extension admits FASTA, the content does not match, and the answer is no
   * type at all rather than a plausible wrong one.
   */
  const byExtension = all.filter((candidate) => matchesExtension(filename, candidate.spec));
  const pool = byExtension.length > 0 ? byExtension : all.filter((c) => c.type !== "Text");

  for (const candidate of pool) {
    const line = firstMeaningfulLine(text, candidate.spec.comment_prefix);
    if (line === null) continue;
    if (!new RegExp(candidate.spec.sniff!).test(line)) continue;

    if (candidate.spec.structure) {
      const check = STRUCTURE[candidate.spec.structure];
      // An unknown structural check must not silently pass. Better to fall
      // through to a less specific type than to claim one we cannot verify.
      if (!check) continue;
      const [ok, detail] = check(text);
      if (!ok) {
        // Worth keeping: "looks like FASTA but the records differ in length" is
        // the most useful sentence this function can produce, and it is only
        // available on the way past.
        structuralMiss ??= `not ${candidate.type}/${candidate.format}: ${detail}`;
        continue;
      }
      return { type: candidate.type, format: candidate.format, detail };
    }

    const detail = structuralMiss
      ? `${structuralMiss}; matched ${candidate.type}/${candidate.format} instead`
      : `first line matches ${candidate.type}/${candidate.format}`;
    return { type: candidate.type, format: candidate.format, detail };
  }

  return {
    type: null,
    format: null,
    detail:
      structuralMiss ??
      "nothing in the port-type vocabulary matched. It can be kept, but not used as a typed input.",
  };
}
