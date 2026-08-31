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
  /** Present only for sequence-shaped files. See `detectAlphabet`. */
  alphabet?: AlphabetVerdict;
};

export type Alphabet = "dna" | "rna" | "protein" | "ambiguous" | "not_sequence";

export type AlphabetVerdict = {
  alphabet: Alphabet;
  confidence: "certain" | "high" | "low" | "none";
  why: string;
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

/* ------------------------------------------------------------------------- *
 * Alphabet
 * ------------------------------------------------------------------------- */

type AlphabetRules = {
  strip: string;
  rules: {
    protein_only_residues: { letters: string };
    nucleotide_residues: { letters: string };
    thresholds: {
      min_residues_for_confidence: number;
      nucleotide_fraction_for_dna: number;
      nucleotide_fraction_for_protein: number;
    };
  };
};

let alphabetRules: AlphabetRules | null = null;

async function rules(): Promise<AlphabetRules | null> {
  if (alphabetRules) return alphabetRules;
  try {
    const parsed = JSON.parse(await readFile(path.join(TOOLS_DIR, "porttypes.json"), "utf8")) as {
      alphabets?: AlphabetRules;
    };
    alphabetRules = parsed.alphabets ?? null;
  } catch {
    alphabetRules = null;
  }
  return alphabetRules;
}

/**
 * Sequence characters only, plus which container they came from.
 *
 * Both halves were real bugs, one on each side of this boundary. FASTQ quality
 * lines are arbitrary printable ASCII and are full of E, F, I, L, P and Q, so
 * treating every non-header line as sequence reads a nanopore run as protein
 * with certainty. And a Newick tree is not a sequence at all, but a parser that
 * only skips `>` headers eats the taxon names and answers confidently about a
 * file it should have refused.
 *
 * So the container is identified first and anything unrecognised is refused.
 * This is the detection-versus-validation problem again: a validator is told
 * what it is looking at, a detector is not, and code written for the first is
 * dangerous in the second.
 */
function residues(text: string, strip: Set<string>): [string, string] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return ["", "empty"];

  const clean = (chunk: string) =>
    [...chunk]
      .filter((c) => !strip.has(c))
      .join("")
      .toUpperCase();

  if (lines[0].startsWith(">")) {
    return [clean(lines.filter((line) => !line.startsWith(">")).join("")), "fasta"];
  }

  if (lines[0].startsWith("@")) {
    // Four lines per record: header, sequence, '+', quality. Only the second is
    // sequence; taking the rest is what reads quality scores as residues.
    const seq: string[] = [];
    for (let i = 0; i < lines.length - 1; i += 4) {
      if (lines[i].startsWith("@")) seq.push(lines[i + 1]);
    }
    return [clean(seq.join("")), "fastq"];
  }

  return ["", "unrecognised"];
}

/**
 * Which alphabet is this written in?
 *
 * The rule lives in `tools/porttypes.json`; this is one implementation of it and
 * `tools/runner/alphabet.py` is another. Two implementations are fine — crossing
 * a language boundary on every upload would not be — but two *rules* would
 * drift, so the thresholds and letter sets are data both sides read, and the
 * shared corpus at `tools/corpus/alphabet` is what proves they still agree.
 *
 * The asymmetry to understand first: nucleotide letters are a SUBSET of protein
 * letters, so every DNA sequence is also a syntactically valid protein sequence.
 * Detection can rule protein IN with certainty — one E, F, I, L, P or Q settles
 * it — but can only ever rule DNA in with enough evidence. That is why
 * `ambiguous` is a real answer rather than a failure to try harder, and why a
 * short sequence of only ACGT cannot be resolved by any threshold.
 *
 * Never resolve `ambiguous` by guessing. A file whose alphabet is ambiguous must
 * not be offered as a match for a port that constrains alphabet — guessing here
 * is how a protein alignment reaches a nucleotide-only tree builder and produces
 * a confident wrong answer.
 */
export async function detectAlphabet(text: string): Promise<AlphabetVerdict> {
  const spec = await rules();
  if (!spec) {
    return { alphabet: "ambiguous", confidence: "none", why: "no alphabet rule is available" };
  }

  const [seq, container] = residues(text, new Set(spec.strip));
  if (container === "unrecognised" || container === "empty") {
    return {
      alphabet: "not_sequence",
      confidence: "certain",
      why: `not a recognised sequence container (${container})`,
    };
  }
  if (seq.length === 0) {
    return {
      alphabet: "not_sequence",
      confidence: "certain",
      why: `${container} with no sequence residues`,
    };
  }

  const proteinOnly = new Set(spec.rules.protein_only_residues.letters);
  const nucleotide = new Set(spec.rules.nucleotide_residues.letters);
  const limits = spec.rules.thresholds;

  const counts = new Map<string, number>();
  for (const c of seq) counts.set(c, (counts.get(c) ?? 0) + 1);

  // Positive proof beats any count: these letters cannot appear in a nucleotide
  // alphabet at all, so one of them settles the question outright.
  const found = [...counts.keys()].filter((c) => proteinOnly.has(c)).sort();
  if (found.length > 0) {
    return {
      alphabet: "protein",
      confidence: "certain",
      why: `contains ${found.join(", ")}, which no nucleotide alphabet has`,
    };
  }

  const total = seq.length;
  let nucleotideCount = 0;
  for (const [letter, n] of counts) if (nucleotide.has(letter)) nucleotideCount += n;
  const fraction = nucleotideCount / total;
  const percent = `${(fraction * 100).toFixed(1)}%`;

  if (total < limits.min_residues_for_confidence) {
    return {
      alphabet: "ambiguous",
      confidence: "none",
      why: `only ${total} residues; too little evidence either way`,
    };
  }

  if (fraction >= limits.nucleotide_fraction_for_dna) {
    const u = counts.get("U") ?? 0;
    const t = counts.get("T") ?? 0;
    const kind = u > t ? "rna" : "dna";
    return {
      alphabet: kind,
      confidence: "high",
      why:
        `${percent} of ${total} residues are nucleotide letters` +
        (kind === "rna" ? ", U outnumbers T" : ""),
    };
  }

  if (fraction <= limits.nucleotide_fraction_for_protein) {
    return {
      alphabet: "protein",
      confidence: "high",
      why: `only ${percent} of ${total} residues are nucleotide letters`,
    };
  }

  return {
    alphabet: "ambiguous",
    confidence: "low",
    why: `${percent} nucleotide letters sits between the thresholds`,
  };
}

/**
 * Content decides; the filename only breaks ties.
 *
 * A file named `.fasta` holding an HTML error page is not a FASTA, and that is
 * exactly the case worth catching — it is how a failed download becomes a
 * confidently wrong pipeline result.
 */
async function detectType(filename: string, bytes: Buffer): Promise<Detection> {
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

/**
 * Type first, then alphabet for the types that carry residues.
 *
 * Alphabet is only meaningful for sequence-shaped data, so a table or a tree
 * does not get one - an absent alphabet means "not applicable", which is a
 * different statement from `not_sequence`, and both differ from a guess.
 */
export async function detect(filename: string, bytes: Buffer): Promise<Detection> {
  const detection = await detectType(filename, bytes);
  if (detection.type !== "Sequence" && detection.type !== "Alignment") return detection;

  return { ...detection, alphabet: await detectAlphabet(bytes.toString("utf8")) };
}
