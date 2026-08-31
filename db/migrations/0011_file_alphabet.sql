-- 0011: what alphabet a sequence file is written in.
--
-- BLU-22: `sequences-to-phylogeny` was run on real RecA PROTEIN sequences and
-- every check passed. FastTree was invoked with `-nt` - nucleotide mode - on a
-- protein alignment, and produced a real tree with real branch lengths under
-- the wrong evolutionary model. Nothing failed.
--
-- The cause is that `Alignment` and `Sequence` carry a format but no alphabet,
-- so a DNA alignment and a protein alignment are indistinguishable to every
-- check we have. BLU-23 fixes that properly, by making types facets. This
-- migration is the half that closes the door a PERSON walks through: once a
-- file can be labelled `protein`, the picker can stop offering it.
--
-- CONFIDENCE IS STORED, NOT JUST THE ANSWER. Nucleotide letters are a subset of
-- protein letters, so every DNA sequence is also a syntactically valid protein
-- sequence: detection can rule protein IN with certainty but can only rule DNA
-- in with enough evidence. `ambiguous` is therefore a real answer rather than a
-- failure to try harder, and it must never be resolved by guessing - a short
-- peptide of only ACGT residues is genuinely indistinguishable from DNA.
-- Storing the confidence is what lets a caller tell "we know" from "we cannot".

alter table files
  add column alphabet text
    check (alphabet in ('dna', 'rna', 'protein', 'ambiguous', 'not_sequence')),
  add column alphabet_confidence text
    check (alphabet_confidence in ('certain', 'high', 'low', 'none'));

comment on column files.alphabet is
  'NULL means not applicable - the file is not sequence-shaped, so the question
   does not arise. That is a different statement from the value ''not_sequence'',
   which means the question was asked of something that turned out not to be a
   sequence, and both differ from ''ambiguous'', which means asked and unresolved.';

-- Set and cleared together: a confidence without an answer says nothing, and an
-- answer without a confidence is exactly the over-claim this exists to prevent.
alter table files add constraint files_alphabet_has_confidence
  check ((alphabet is null) = (alphabet_confidence is null));

-- The rule and the corpus that keep the two implementations honest live in
-- tools/porttypes.json and tools/corpus/alphabet. Recorded here because a
-- reader of this column will want to know where the answer came from.
comment on column files.alphabet_confidence is
  'From the shared rule in tools/porttypes.json, implemented twice - by
   tools/runner/alphabet.py and web/src/server/tools/detect.ts - and held to one
   behaviour by the corpus at tools/corpus/alphabet.';

create or replace view tree_files
  with (security_invoker = true)
as
select
  n.id, n.owner_id, n.parent_id, n.name, n.position, n.created_at, n.updated_at,
  f.blob_key, f.byte_size, f.content_hash, f.port_type, f.port_format, f.detection,
  f.alphabet, f.alphabet_confidence
from nodes n
join files f on f.node_id = n.id
where n.kind = 'file';

grant select on tree_files to bluedoor_app;
