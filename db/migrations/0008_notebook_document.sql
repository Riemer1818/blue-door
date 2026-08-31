-- 0008: the experiment document is a document, not a table of rows.
--
-- 0007 modelled blocks as one row each, mirroring widget_instances. That was the
-- right shape for a grid and the wrong one here: the notebook editor is
-- BlockNote (ProseMirror underneath), and a ProseMirror document is atomic — it
-- owns its own nesting, ordering and inline marks, and every edit is a
-- transaction against the whole document. Splitting it into rows would mean
-- reimplementing the editor's model in SQL and keeping the two in step.
--
-- So this is a deliberate, scoped exception to "position as columns, not a blob"
-- from ADR 0002. It applies to notebook documents only; dashboard geometry is
-- still rows, because there a stale client overwriting its neighbours is a real
-- failure and here it is not (one author, one document, one editor).
--
-- What we keep from 0007: nodes (the file tree), surfaces, and the rule that a
-- component declares which surfaces it may appear on.

drop view if exists experiment_blocks;
drop trigger if exists blocks_check_placement on blocks;
drop function if exists app.check_block_placement();
drop table if exists blocks;

alter table nodes
  add column content jsonb not null default '[]'::jsonb
    constraint nodes_content_is_array check (jsonb_typeof(content) = 'array');

comment on column nodes.content is
  'BlockNote document for an experiment: the editor''s own block array. Empty for folders.';

-- Folders have no document. Enforced rather than merely conventional, so a
-- folder can never quietly accumulate content that nothing renders.
create or replace function app.check_node_content() returns trigger
  language plpgsql
as $$
begin
  if new.kind = 'folder' and new.content <> '[]'::jsonb then
    raise exception 'a folder cannot hold document content'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger nodes_check_content
  before insert or update of content, kind on nodes
  for each row execute function app.check_node_content();

grant execute on function app.check_node_content() to bluedoor_app;
