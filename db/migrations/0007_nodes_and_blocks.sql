-- 0007: a file system, and experiment pages made of blocks.
--
-- Two surfaces now share one component library:
--
--   dashboard  — a free grid of cards. Shortcuts and things you watch all day.
--   notebook   — an experiment: an ordered document of blocks, top to bottom.
--
-- widget_types stays the single library. A type declares which surfaces it can
-- appear on, so "what can I add here?" is a query, not a hard-coded list.

-- ---------------------------------------------------------------------------
-- Where a component may appear
-- ---------------------------------------------------------------------------
create table surfaces (
  name text primary key check (name ~ '^[a-z]{3,16}$'),
  display_name text not null
);

insert into surfaces (name, display_name) values
  ('dashboard', 'Dashboard'),
  ('notebook',  'Notebook');

alter table widget_types
  add column surfaces text[] not null default '{dashboard}';

-- text[] cannot carry a foreign key, so the membership check is a constraint
-- against the surfaces table instead.
create or replace function app.check_surfaces_exist() returns trigger
  language plpgsql
as $$
declare
  unknown_surface text;
begin
  if array_length(new.surfaces, 1) is null then
    raise exception 'a component must be usable on at least one surface'
      using errcode = 'check_violation';
  end if;

  select s into unknown_surface
  from unnest(new.surfaces) as s
  where not exists (select 1 from surfaces where name = s)
  limit 1;

  if unknown_surface is not null then
    raise exception 'unknown surface %', unknown_surface
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end
$$;

create trigger widget_types_surfaces_exist
  before insert or update on widget_types
  for each row execute function app.check_surfaces_exist();

update widget_types set surfaces = '{dashboard,notebook}' where type in ('notes', 'counter');
update widget_types set surfaces = '{dashboard}'          where type = 'clock';

-- A notebook-only component. Proves the library is shared rather than copied:
-- same table, same config_schema mechanism, different surface.
insert into widget_types
  (type, version, display_name, description, config_schema, surfaces, default_w, default_h, min_w, min_h)
values (
  'text',
  '1.0.0',
  'Text',
  'A paragraph of prose. The backbone of a written-up experiment.',
  '{
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "body": { "type": "string", "title": "Body", "maxLength": 20000, "default": "" }
    }
  }'::jsonb,
  '{notebook}',
  12, 3, 3, 2
)
on conflict (type) do nothing;

-- ---------------------------------------------------------------------------
-- The file system
-- ---------------------------------------------------------------------------
-- One table for folders and experiments both, because they are the same thing
-- to a tree: something with a parent, a name and an order among its siblings.
create table nodes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users (id) on delete cascade,

  -- NULL parent means the root of this person's tree.
  parent_id  uuid references nodes (id) on delete cascade,

  kind       text not null check (kind in ('folder', 'experiment')),
  name       text not null check (length(btrim(name)) between 1 and 200),

  -- Fractional index: inserting between two siblings is a midpoint, never a
  -- renumbering of everything after it.
  position   double precision not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nodes_owner_id_idx on nodes (owner_id);
create index nodes_parent_id_idx on nodes (parent_id);

-- Two names cannot collide in one directory, exactly like a file system. Two
-- partial indexes because NULL parent_id would otherwise never conflict.
create unique index nodes_unique_name_in_folder
  on nodes (parent_id, lower(name)) where parent_id is not null;
create unique index nodes_unique_name_at_root
  on nodes (owner_id, lower(name)) where parent_id is null;

create trigger nodes_touch_updated_at
  before update on nodes
  for each row execute function app.touch_updated_at();

-- Structural rules the tree cannot be allowed to break, checked where no client
-- can route around them.
create or replace function app.check_node_placement() returns trigger
  language plpgsql
as $$
declare
  parent_kind text;
  parent_owner uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a folder cannot contain itself'
      using errcode = 'check_violation';
  end if;

  select kind, owner_id into parent_kind, parent_owner
  from nodes where id = new.parent_id;

  if parent_kind is null then
    raise exception 'parent % does not exist', new.parent_id
      using errcode = 'foreign_key_violation';
  end if;

  if parent_kind <> 'folder' then
    raise exception 'only folders can contain other items'
      using errcode = 'check_violation';
  end if;

  if parent_owner <> new.owner_id then
    raise exception 'cannot move an item into someone else''s folder'
      using errcode = 'check_violation';
  end if;

  -- Walk up from the new parent; meeting this node means the move would detach
  -- a whole subtree from the root and leave it circling itself.
  if exists (
    with recursive ancestors as (
      select id, parent_id from nodes where id = new.parent_id
      union all
      select n.id, n.parent_id from nodes n join ancestors a on n.id = a.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'that move would put a folder inside itself'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger nodes_check_placement
  before insert or update of parent_id, owner_id on nodes
  for each row execute function app.check_node_placement();

-- ---------------------------------------------------------------------------
-- Blocks: the content of an experiment
-- ---------------------------------------------------------------------------
create table blocks (
  id             uuid primary key default gen_random_uuid(),
  node_id        uuid not null references nodes (id) on delete cascade,
  block_type     text not null references widget_types (type) on delete restrict,

  position       double precision not null default 0,
  config         jsonb not null default '{}'::jsonb
                   constraint blocks_config_is_object
                   check (jsonb_typeof(config) = 'object'),
  schema_version int not null default 1 check (schema_version >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blocks_node_id_position_idx on blocks (node_id, position);

create trigger blocks_touch_updated_at
  before update on blocks
  for each row execute function app.touch_updated_at();

-- Blocks belong to experiments, and only to components that claim the notebook
-- surface. Both rules live here so any client gets them.
create or replace function app.check_block_placement() returns trigger
  language plpgsql
as $$
begin
  if (select kind from nodes where id = new.node_id) is distinct from 'experiment' then
    raise exception 'blocks can only be added to an experiment'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from widget_types
    where type = new.block_type and 'notebook' = any (surfaces)
  ) then
    raise exception 'component % cannot be used in a notebook', new.block_type
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger blocks_check_placement
  before insert or update of node_id, block_type on blocks
  for each row execute function app.check_block_placement();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table nodes  enable row level security;
alter table nodes  force  row level security;
alter table blocks enable row level security;
alter table blocks force  row level security;

create policy nodes_owner on nodes
  for all
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- Derived from the node, so an experiment changes hands in one place.
create policy blocks_owner on blocks
  for all
  using (
    exists (select 1 from nodes n where n.id = blocks.node_id and n.owner_id = app.current_user_id())
  )
  with check (
    exists (select 1 from nodes n where n.id = blocks.node_id and n.owner_id = app.current_user_id())
  );

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------
create view experiment_blocks
  with (security_invoker = true)
as
select
  b.id,
  b.node_id,
  b.block_type,
  b.position,
  b.config,
  b.schema_version,
  wt.display_name as type_display_name,
  wt.version      as type_version,
  wt.enabled      as type_enabled
from blocks b
join widget_types wt on wt.type = b.block_type;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on surfaces to bluedoor_app;
grant select, insert, update, delete on nodes to bluedoor_app;
grant select, insert, update, delete on blocks to bluedoor_app;
grant select on experiment_blocks to bluedoor_app;
grant execute on function app.check_node_placement() to bluedoor_app;
grant execute on function app.check_block_placement() to bluedoor_app;
grant execute on function app.check_surfaces_exist() to bluedoor_app;
