-- 0010: files, so the tree that looks like a file system contains files.
--
-- Until now `nodes` held folders and experiments, and `nodes.content` held a
-- BlockNote document. That was right while documents were all the product held.
-- It stops being right the moment a tool page can run something, because a run
-- consumes a file and produces one.
--
-- Two decisions worth stating, because both are easy to get wrong later:
--
-- BYTES DO NOT LIVE IN POSTGRES. A row carries a pointer and the facts you can
-- query on - size, hash, detected type. The bytes sit in a blob store behind an
-- interface, local disk today and Scaleway Object Storage later. Putting a
-- genome in a jsonb column works right up to the day it does not, and by then
-- every backup and every replica is carrying it.
--
-- FILES ARE NODES. They go in the same tree as folders and experiments, so they
-- inherit naming, placement, ordering, the cycle check and - the point - row
-- level security. A separate parallel hierarchy would be a second place to get
-- ownership wrong, and ownership is the thing that must never be wrong twice.

-- ---------------------------------------------------------------------------
-- A third kind of node
-- ---------------------------------------------------------------------------
alter table nodes drop constraint nodes_kind_check;
alter table nodes add constraint nodes_kind_check
  check (kind in ('folder', 'experiment', 'file'));

-- 0008 said a folder cannot hold document content. The real rule is narrower:
-- only an experiment can. A file's content is its bytes, and a file carrying a
-- BlockNote document as well would be two sources of truth for what it is.
create or replace function app.check_node_content() returns trigger
  language plpgsql
as $$
begin
  if new.kind <> 'experiment' and new.content <> '[]'::jsonb then
    raise exception 'only an experiment can hold document content, not a %', new.kind
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- What we know about the bytes
-- ---------------------------------------------------------------------------
create table files (
  node_id      uuid primary key references nodes (id) on delete cascade,

  -- Opaque to every caller. The blob store owns its own layout, so nothing
  -- above it can build a key by hand and nothing has to change here when the
  -- store moves from a local directory to object storage.
  blob_key     text not null unique check (length(btrim(blob_key)) > 0),

  byte_size    bigint not null check (byte_size >= 0),

  -- sha256 of the content, lowercase hex. Cheap to compute on upload, and it
  -- is what lets the executor verify it mounted the bytes we meant rather than
  -- trusting a path.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),

  -- The port-type vocabulary, detected on upload by the same rules the runner
  -- type-checks with. NULL means detection did not recognise it - which is a
  -- fact worth storing, not a failure. An unrecognised file is still a file the
  -- user can keep; it just cannot be offered for a typed port.
  port_type    text,
  port_format  text,

  -- Why detection concluded what it did, for a user asking why their file is
  -- not selectable. Absent detail on an absent type would leave them guessing.
  detection    text,

  created_at   timestamptz not null default now()
);

comment on column files.port_type is
  'Port type detected on upload, or NULL when nothing in the vocabulary matched.
   Format is meaningless without it, so the two are set and cleared together.';

alter table files add constraint files_format_needs_type
  check (port_format is null or port_type is not null);

-- ---------------------------------------------------------------------------
-- The two halves cannot drift apart
-- ---------------------------------------------------------------------------

-- A files row must hang off a node that is actually a file.
create or replace function app.check_file_node() returns trigger
  language plpgsql
as $$
declare
  node_kind text;
begin
  select kind into node_kind from nodes where id = new.node_id;
  if node_kind is null then
    raise exception 'node % does not exist', new.node_id
      using errcode = 'foreign_key_violation';
  end if;
  if node_kind <> 'file' then
    raise exception 'only a file node can carry bytes, not a %', node_kind
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger files_check_node
  before insert or update of node_id on files
  for each row execute function app.check_file_node();

-- And the reverse: a file node with no bytes is a broken row that renders as an
-- empty entry nobody can open. Deferred to commit because the node necessarily
-- exists before the files row that references it - checking immediately would
-- make the correct insert order impossible.
create or replace function app.check_file_has_bytes() returns trigger
  language plpgsql
as $$
begin
  if new.kind = 'file' and not exists (select 1 from files where node_id = new.id) then
    raise exception 'file node % has no bytes; insert its files row in the same transaction', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create constraint trigger nodes_file_has_bytes
  after insert or update of kind on nodes
  deferrable initially deferred
  for each row execute function app.check_file_has_bytes();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table files enable row level security;
alter table files force  row level security;

-- Derived from the node, exactly as blocks are, so a file changes hands in one
-- place and cannot be orphaned into visibility.
create policy files_owner on files
  for all
  using (
    exists (select 1 from nodes n where n.id = files.node_id and n.owner_id = app.current_user_id())
  )
  with check (
    exists (select 1 from nodes n where n.id = files.node_id and n.owner_id = app.current_user_id())
  );

-- ---------------------------------------------------------------------------
-- Reading a file with its node in one go
-- ---------------------------------------------------------------------------
create or replace view tree_files
  with (security_invoker = true)
as
select
  n.id, n.owner_id, n.parent_id, n.name, n.position, n.created_at, n.updated_at,
  f.blob_key, f.byte_size, f.content_hash, f.port_type, f.port_format, f.detection
from nodes n
join files f on f.node_id = n.id
where n.kind = 'file';

-- ---------------------------------------------------------------------------
-- Grants. Note the app role, not the owner: developing against the owner would
-- bypass every policy above.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on files to bluedoor_app;
grant select on tree_files to bluedoor_app;
grant execute on function app.check_file_node() to bluedoor_app;
grant execute on function app.check_file_has_bytes() to bluedoor_app;
