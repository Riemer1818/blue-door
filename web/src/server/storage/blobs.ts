import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where the bytes live.
 *
 * A local directory today, Scaleway Object Storage in `fr-par` later. Every
 * caller sees only opaque keys, so the move is this file and nothing else — the
 * moment something above builds a key by hand or joins it to a path, that stops
 * being true.
 *
 * CONTENT ADDRESSED. The key is derived from the bytes, so uploading the same
 * dataset twice stores it once, and a key can never point at different content
 * than it did yesterday. That second property is what makes a run reproducible:
 * a report naming a hash names one specific set of bytes forever.
 *
 * Nothing here knows about users. Ownership lives on the `files` row under row
 * level security, and a key leaking tells you nothing about who holds it — but
 * a key is also unguessable, so it is not a capability worth passing around.
 */

const BLOB_DIR = process.env.BLOB_DIR ?? path.join(process.cwd(), ".blobs");

export type StoredBlob = { key: string; hash: string; size: number };

/** `sha256/ab/cd/<hash>` — fanned out so no directory holds a million entries. */
function keyFor(hash: string): string {
  return path.posix.join("sha256", hash.slice(0, 2), hash.slice(2, 4), hash);
}

function resolve(key: string): string {
  const full = path.resolve(BLOB_DIR, key);
  // A key is opaque and generated here, so traversal should be impossible. The
  // check costs nothing and the failure it prevents is reading arbitrary files
  // off the host, which is not a bug to discover in production.
  if (full !== path.resolve(BLOB_DIR) && !full.startsWith(path.resolve(BLOB_DIR) + path.sep)) {
    throw new Error("blob key escapes the store");
  }
  return full;
}

export async function putBlob(bytes: Buffer): Promise<StoredBlob> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = keyFor(hash);
  const full = resolve(key);

  await mkdir(path.dirname(full), { recursive: true });
  try {
    await stat(full);
    // Already stored. Identical content by construction, so rewriting it would
    // only risk tearing a file another run is reading.
  } catch {
    await writeFile(full, bytes);
  }
  return { key, hash, size: bytes.byteLength };
}

export async function getBlob(key: string): Promise<Buffer> {
  return readFile(resolve(key));
}

/**
 * Put a copy of the bytes somewhere the executor can mount.
 *
 * This is the trusted side of the boundary, and it is deliberately a copy. The
 * executor runs untrusted tool code with the directory bind-mounted, so handing
 * it the canonical blob would let a badly-behaved container corrupt the stored
 * copy every other run depends on. `name` comes from the port, never from the
 * user's filename — the tool must not be able to observe where its data came
 * from.
 */
export async function materialise(key: string, intoDir: string, name: string): Promise<string> {
  await mkdir(intoDir, { recursive: true });
  const destination = path.join(intoDir, name);
  await copyFile(resolve(key), destination);
  return destination;
}
