-- 0012: the same bytes may back more than one file.
--
-- 0010 declared `files.blob_key` UNIQUE, which was wrong and in a way that only
-- shows up on the second upload. Keys are CONTENT ADDRESSED - derived from a
-- hash of the bytes - so identical content always produces an identical key.
-- A unique constraint on it therefore means each distinct set of bytes may
-- exist as a file exactly ONCE, ever, across every user of the system.
--
-- Consequences, none of them acceptable: a user cannot keep the same reference
-- dataset in two projects; two users cannot both hold a public genome; and
-- re-uploading a file you deleted fails while the blob is still referenced by
-- nobody. The failure surfaces as "something here already has that name", which
-- is the wrong diagnosis entirely - the name was fine, the bytes were the
-- collision.
--
-- Deduplication belongs in the blob store, and already happens there: putBlob
-- writes only when the key is absent. That is storage efficiency. It was never
-- meant to be an identity constraint on user-visible files, and conflating the
-- two made a private storage optimisation into a product rule.
--
-- Found by the BLU-22 regression test on its second run, which is a fair
-- argument for tests that are re-runnable rather than merely passing once.

alter table files drop constraint files_blob_key_key;

-- Kept as a plain index: "what else references these bytes" is the question a
-- garbage collector asks before reclaiming a blob, and it must stay cheap.
create index files_blob_key_idx on files (blob_key);
