import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getBlob, putBlob } from "../storage/blobs";
import { detect } from "../tools/detect";
import { protectedProcedure, router } from "../trpc";

/**
 * Files: the bytes a tool run consumes and produces.
 *
 * A file is a node, so it lives in the same tree as folders and experiments and
 * inherits naming, placement and — the point — row level security. The bytes
 * live in the blob store; this table carries a pointer and the facts worth
 * querying on.
 *
 * Nothing here hands out a blob key to a client. A key is unguessable but it is
 * not an access check, and the only thing that decides who may read a file is
 * the policy on its node.
 */

/**
 * Kept small on purpose. This path buffers the whole body in memory to hash and
 * type it, which is fine for the sequence files a tool page actually takes and
 * wrong for a genome. Streaming uploads are their own problem; a refusal with a
 * clear reason beats an out-of-memory a user cannot interpret.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const filesRouter = router({
  /** Every file the caller owns, with what detection made of it. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.tx
      .selectFrom("treeFiles")
      .select([
        "id",
        "parentId",
        "name",
        "byteSize",
        "contentHash",
        "portType",
        "portFormat",
        "detection",
        "alphabet",
        "alphabetConfidence",
        "createdAt",
      ])
      .orderBy("name")
      .execute();
  }),

  /**
   * Files that can be wired to a port.
   *
   * A dropdown is a stronger claim than a passing type check. A script's silence
   * is the absence of an objection; a list containing exactly one plausible
   * option reads as a recommendation. So this returns matches AND near-misses
   * with the reason, rather than a filtered list that looks complete.
   *
   * BLU-22 is why. A RecA protein alignment and a DNA alignment are both
   * `Alignment/fasta`, so filtering on type alone offered a protein alignment
   * for FastTree's nucleotide-only input — and the run succeeded, producing a
   * real tree under the wrong evolutionary model with nothing failing anywhere.
   *
   * `ambiguous` is never a match. Nucleotide letters are a subset of protein
   * letters, so a short sequence of only ACGT genuinely cannot be resolved;
   * treating "we cannot tell" as "it is fine" would reproduce that bug through
   * a different door. Such a file stays visible with its ambiguity stated, so a
   * person can choose it deliberately — but nothing chooses it for them.
   */
  forPort: protectedProcedure
    .input(
      z.object({
        type: z.string().min(1),
        format: z.string().optional(),
        /** Omitted means the port does not care, and every alphabet matches. */
        alphabet: z.enum(["dna", "rna", "protein", "nucleotide"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.tx
        .selectFrom("treeFiles")
        .select([
          "id",
          "name",
          "byteSize",
          "portType",
          "portFormat",
          "alphabet",
          "alphabetConfidence",
        ])
        .where("portType", "=", input.type);

      if (input.format) query = query.where("portFormat", "=", input.format);
      const candidates = await query.orderBy("name").execute();

      const satisfies = (alphabet: string | null): boolean => {
        if (!input.alphabet) return true;
        if (alphabet === null || alphabet === "ambiguous" || alphabet === "not_sequence") {
          return false;
        }
        // `nucleotide` is the constraint FastTree actually needs: DNA or RNA,
        // not one specific one.
        if (input.alphabet === "nucleotide") return alphabet === "dna" || alphabet === "rna";
        return alphabet === input.alphabet;
      };

      return candidates.map((file) => ({
        ...file,
        matches: satisfies(file.alphabet),
        // Absent on a match; on a near-miss it is the whole explanation, and
        // showing the file with a reason beats hiding it with none.
        blockedBecause: satisfies(file.alphabet)
          ? null
          : file.alphabet === "ambiguous"
            ? `alphabet could not be determined, and this port needs ${input.alphabet}`
            : file.alphabet === null
              ? "alphabet was never established for this file"
              : `it is ${file.alphabet}, and this port needs ${input.alphabet}`,
      }));
    }),

  /**
   * Upload bytes as a new file node.
   *
   * The node and its `files` row are written in one transaction because the
   * database insists on it: a file node with no bytes is refused at commit. That
   * is deliberate — the alternative is an entry in the tree that renders as a
   * file and cannot be opened.
   */
  upload: protectedProcedure
    .input(
      z.object({
        parentId: z.uuid().nullable(),
        name: z.string().trim().min(1).max(200),
        /** base64 — tRPC is JSON, and this path is capped at MAX_UPLOAD_BYTES. */
        content: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bytes = Buffer.from(input.content, "base64");
      if (bytes.byteLength === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That file is empty." });
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Files are capped at ${MAX_UPLOAD_BYTES / 1024 / 1024} MB for now.`,
        });
      }

      // Content decides the type; the filename only breaks ties. A file named
      // .fasta holding an HTML error page is exactly what this catches.
      const [stored, detection] = await Promise.all([putBlob(bytes), detect(input.name, bytes)]);

      const last = await ctx.tx
        .selectFrom("nodes")
        .select(({ fn }) => fn.max("position").as("position"))
        .where((eb) =>
          input.parentId === null
            ? eb("parentId", "is", null)
            : eb("parentId", "=", input.parentId),
        )
        .executeTakeFirst();

      try {
        const node = await ctx.tx
          .insertInto("nodes")
          .values({
            ownerId: ctx.userId,
            parentId: input.parentId,
            kind: "file",
            name: input.name,
            position: Number(last?.position ?? 0) + 1,
          })
          .returning(["id", "parentId", "name"])
          .executeTakeFirstOrThrow();

        await ctx.tx
          .insertInto("files")
          .values({
            nodeId: node.id,
            blobKey: stored.key,
            byteSize: stored.size,
            contentHash: stored.hash,
            portType: detection.type,
            portFormat: detection.type ? detection.format : null,
            detection: detection.detail,
            // Null when the file is not sequence-shaped: the question does not
            // arise, which is a different statement from `not_sequence`.
            alphabet: detection.alphabet?.alphabet ?? null,
            alphabetConfidence: detection.alphabet?.confidence ?? null,
          })
          .execute();

        return {
          ...node,
          byteSize: stored.size,
          portType: detection.type,
          portFormat: detection.format,
          detection: detection.detail,
          alphabet: detection.alphabet ?? null,
        };
      } catch (error) {
        throw asClientError(error);
      }
    }),

  /**
   * The bytes back, for rendering a preview or downloading.
   *
   * Read through the node, so the row-level policy is what authorises it. Going
   * to the blob store with a key from anywhere else would be a second answer to
   * "may this person read this", and the second answer is the one that is wrong.
   */
  content: protectedProcedure
    .input(z.object({ id: z.uuid(), maxBytes: z.number().int().positive().max(1_000_000).optional() }))
    .query(async ({ ctx, input }) => {
      // Joined from the base tables rather than the `tree_files` view: a view
      // cannot carry NOT NULL, so blob_key would type as nullable and every
      // caller would need a check for a state the schema forbids.
      const file = await ctx.tx
        .selectFrom("files")
        .innerJoin("nodes", "nodes.id", "files.nodeId")
        .select(["nodes.name", "files.blobKey", "files.byteSize", "files.portType", "files.portFormat"])
        .where("nodes.id", "=", input.id)
        .executeTakeFirst();

      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "No such file." });

      const limit = input.maxBytes ?? 64 * 1024;
      const bytes = await getBlob(file.blobKey);
      const slice = bytes.subarray(0, limit);

      return {
        name: file.name,
        byteSize: Number(file.byteSize),
        portType: file.portType,
        portFormat: file.portFormat,
        text: slice.toString("utf8"),
        // Stated rather than left for the reader to infer from a cut-off line.
        truncated: bytes.byteLength > slice.byteLength,
      };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      // The files row cascades from the node. The blob is deliberately left: it
      // is content-addressed and may back another file, and reclaiming it is a
      // sweep over unreferenced keys, not something to do on a delete path.
      const result = await ctx.tx
        .deleteFrom("nodes")
        .where("id", "=", input.id)
        .where("kind", "=", "file")
        .executeTakeFirst();

      if (Number(result.numDeletedRows) === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such file." });
      }
      return { id: input.id };
    }),
});

function asClientError(error: unknown): unknown {
  if (error instanceof TRPCError) return error;
  const err = error as { code?: string; message?: string } | null;

  if (err?.code === "23505") {
    return new TRPCError({ code: "CONFLICT", message: "Something here already has that name." });
  }
  if (err?.code === "23514" || err?.code === "23503") {
    return new TRPCError({ code: "BAD_REQUEST", message: err.message ?? "Not allowed here." });
  }
  return error;
}
