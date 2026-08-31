-- 0001_init: users, dashboards, widget types, widget instances, and the RLS
-- policies that make Postgres — not the API layer — the thing that decides who
-- can see a dashboard.
--
-- Run as the OWNER role (bluedoor_admin on Scaleway, postgres locally).
-- The application connects as bluedoor_app, which owns nothing.

-- ---------------------------------------------------------------------------
-- Runtime role
-- ---------------------------------------------------------------------------
-- On Scaleway this role already exists (Terraform created it with a password).
-- Locally it is created by db/local/init/00-role.sh. This block is the safety
-- net for a database where neither has run; it deliberately creates the role
-- WITHOUT login, so a password is never written into a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bluedoor_app') then
    create role bluedoor_app nologin;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Request identity
-- ---------------------------------------------------------------------------
create schema if not exists app;

-- Every policy below funnels through this. The API sets the GUC per transaction
-- with `set local app.user_id = '...'`; SET LOCAL is transaction-scoped, so a
-- pooled connection cannot leak one request's identity into the next.
--
-- The `true` second argument makes current_setting return NULL instead of
-- raising when the GUC was never set. Combined with `nullif(..., '')` an unset
-- identity yields NULL, and `owner_id = NULL` is never true — so a request that
-- forgets to set the GUC sees nothing rather than everything.
create or replace function app.current_user_id() returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

comment on function app.current_user_id() is
  'Identity of the current request, set by the API via SET LOCAL app.user_id. NULL when unset, which denies everything.';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  display_name text,
  created_at  timestamptz not null default now()
);

create unique index users_email_lower_key on users (lower(email));

-- The plugin catalogue. What widget types exist, what version, and what config
-- is legal for each is data, not a constant in the frontend bundle — installing
-- a widget is an INSERT here, not a redeploy.
create table widget_types (
  type          text primary key
                  constraint widget_types_type_format
                  check (type ~ '^[a-z][a-z0-9-]{1,62}$'),
  version       text not null,
  display_name  text not null,
  description   text,

  -- JSON Schema for this type's instance config. The API derives its validator
  -- from this column so there is one definition of a widget's settings, not two.
  config_schema jsonb not null
                  constraint widget_types_config_schema_is_object
                  check (jsonb_typeof(config_schema) = 'object'),

  -- Where the widget's code is loaded from once widgets are sandboxed and
  -- third-party. NULL means "bundled first-party component, resolved through
  -- the frontend registry by `type`".
  entry_url     text,

  default_w     int not null default 4 check (default_w between 1 and 12),
  default_h     int not null default 4 check (default_h between 1 and 40),
  min_w         int not null default 2 check (min_w between 1 and 12),
  min_h         int not null default 2 check (min_h between 1 and 40),

  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint widget_types_default_ge_min check (default_w >= min_w and default_h >= min_h)
);

create table dashboards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dashboards_owner_id_idx on dashboards (owner_id);

create trigger dashboards_touch_updated_at
  before update on dashboards
  for each row execute function app.touch_updated_at();

create table widget_instances (
  id             uuid primary key default gen_random_uuid(),
  dashboard_id   uuid not null references dashboards (id) on delete cascade,
  widget_type    text not null references widget_types (type) on delete restrict,

  -- Grid position, in grid units. Real columns rather than a blob: dragging one
  -- widget updates one row, and a stale client cannot overwrite its neighbours.
  x int not null check (x >= 0),
  y int not null check (y >= 0),
  w int not null check (w between 1 and 12),
  h int not null check (h between 1 and 40),

  -- Per-instance settings, shaped by widget_types.config_schema.
  config jsonb not null default '{}'::jsonb
           constraint widget_instances_config_is_object
           check (jsonb_typeof(config) = 'object'),

  -- Bumped when a widget type's config format changes, so a migration can find
  -- the instances that still hold the old shape. This is why config is not one
  -- blob per dashboard.
  schema_version int not null default 1 check (schema_version >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint widget_instances_fits_grid check (x + w <= 12)
);

create index widget_instances_dashboard_id_idx on widget_instances (dashboard_id);
create index widget_instances_widget_type_idx on widget_instances (widget_type);

create trigger widget_instances_touch_updated_at
  before update on widget_instances
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- FORCE matters: without it the table owner bypasses its own policies, so
-- anything running as the owner would quietly see every tenant's rows.
alter table users            enable row level security;
alter table users            force  row level security;
alter table dashboards       enable row level security;
alter table dashboards       force  row level security;
alter table widget_instances enable row level security;
alter table widget_instances force  row level security;

create policy users_self on users
  for select
  using (id = app.current_user_id());

create policy dashboards_owner on dashboards
  for all
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- Ownership of a widget is derived from its dashboard rather than duplicated,
-- so there is exactly one place a dashboard can change hands.
create policy widget_instances_owner on widget_instances
  for all
  using (
    exists (
      select 1 from dashboards d
      where d.id = widget_instances.dashboard_id
        and d.owner_id = app.current_user_id()
    )
  )
  with check (
    exists (
      select 1 from dashboards d
      where d.id = widget_instances.dashboard_id
        and d.owner_id = app.current_user_id()
    )
  );

-- widget_types is the shared plugin catalogue: readable by everyone, writable
-- only by the owner role (no policy grants write, and GRANTs below are SELECT).

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------
-- security_invoker is essential. A view without it runs with the VIEW OWNER's
-- privileges, which would bypass every policy above and turn this into a data
-- leak. Postgres 15+ only.
create view dashboard_widgets
  with (security_invoker = true)
as
select
  wi.id,
  wi.dashboard_id,
  wi.widget_type,
  wi.x,
  wi.y,
  wi.w,
  wi.h,
  wi.config,
  wi.schema_version,
  wt.display_name  as type_display_name,
  wt.version       as type_version,
  wt.entry_url     as type_entry_url,
  wt.min_w         as type_min_w,
  wt.min_h         as type_min_h,
  wt.enabled       as type_enabled
from widget_instances wi
join widget_types wt on wt.type = wi.widget_type;

-- ---------------------------------------------------------------------------
-- Grants for the runtime role
-- ---------------------------------------------------------------------------
grant usage on schema public, app to bluedoor_app;
grant execute on function app.current_user_id() to bluedoor_app;

grant select on users to bluedoor_app;
grant select on widget_types to bluedoor_app;
grant select, insert, update, delete on dashboards to bluedoor_app;
grant select, insert, update, delete on widget_instances to bluedoor_app;
grant select on dashboard_widgets to bluedoor_app;

-- The app must never create tables; migrations run as the owner.
revoke create on schema public from bluedoor_app;
