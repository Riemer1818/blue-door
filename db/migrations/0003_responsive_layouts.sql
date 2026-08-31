-- 0003: one layout per breakpoint.
--
-- A widget's position stops being a property of the widget and becomes a
-- property of (widget, breakpoint): the same Notes card can sit top-right on a
-- desktop and third-from-top on a phone. So x/y/w/h move out of
-- widget_instances into their own table, keyed by breakpoint.
--
-- Breakpoints themselves become a table for the same reason widget_types is a
-- table: how many columns a screen size gets is configuration, not a constant
-- compiled into the frontend bundle.

-- ---------------------------------------------------------------------------
-- Breakpoints
-- ---------------------------------------------------------------------------
create table grid_breakpoints (
  name      text primary key check (name ~ '^[a-z]{2,8}$'),
  min_width int  not null unique check (min_width >= 0),
  cols      int  not null check (cols between 1 and 48),
  -- Ordering for the UI; also the tiebreaker when two rows are equally specific.
  sort_order int not null unique
);

comment on table grid_breakpoints is
  'Screen-size buckets and their column counts. The client reads these rather than hard-coding them.';

-- These values match react-grid-layout''s defaults, which is not an accident:
-- they are what its layout generation assumes when a breakpoint has no stored
-- arrangement of its own.
insert into grid_breakpoints (name, min_width, cols, sort_order) values
  ('lg',  1200, 12, 1),
  ('md',   996, 10, 2),
  ('sm',   768,  6, 3),
  ('xs',   480,  4, 4),
  ('xxs',    0,  2, 5);

-- ---------------------------------------------------------------------------
-- Per-breakpoint geometry
-- ---------------------------------------------------------------------------
create table widget_layouts (
  widget_instance_id uuid not null references widget_instances (id) on delete cascade,
  breakpoint         text not null references grid_breakpoints (name) on delete restrict,

  x int not null check (x >= 0),
  y int not null check (y >= 0),
  w int not null check (w >= 1),
  h int not null check (h between 1 and 40),

  updated_at timestamptz not null default now(),

  primary key (widget_instance_id, breakpoint)
);

create index widget_layouts_breakpoint_idx on widget_layouts (breakpoint);

create trigger widget_layouts_touch_updated_at
  before update on widget_layouts
  for each row execute function app.touch_updated_at();

-- "Does it fit?" now depends on the breakpoint's column count, which lives in
-- another table — so it cannot be a CHECK constraint. A trigger is the next best
-- thing, and keeps the rule in the database rather than in whichever client
-- happens to be writing.
create or replace function app.check_widget_layout_fits() returns trigger
  language plpgsql
as $$
declare
  max_cols int;
begin
  select cols into max_cols from grid_breakpoints where name = new.breakpoint;

  if max_cols is null then
    raise exception 'unknown breakpoint %', new.breakpoint
      using errcode = 'foreign_key_violation';
  end if;

  if new.w > max_cols then
    raise exception 'widget is % columns wide but breakpoint % has only %',
      new.w, new.breakpoint, max_cols
      using errcode = 'check_violation';
  end if;

  if new.x + new.w > max_cols then
    raise exception 'widget at x=% width=% overflows the % columns of breakpoint %',
      new.x, new.w, max_cols, new.breakpoint
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger widget_layouts_fits_breakpoint
  before insert or update on widget_layouts
  for each row execute function app.check_widget_layout_fits();

-- ---------------------------------------------------------------------------
-- Move existing geometry across
-- ---------------------------------------------------------------------------
-- Every existing widget gets a row at every breakpoint, its width clamped to the
-- available columns and its x pulled back so it still fits. Seeding all
-- breakpoints rather than only 'lg' means a narrow screen opens on a deliberate
-- arrangement instead of one react-grid-layout invented on the spot.
insert into widget_layouts (widget_instance_id, breakpoint, x, y, w, h)
select
  wi.id,
  b.name,
  least(wi.x, greatest(b.cols - least(wi.w, b.cols), 0)),
  wi.y,
  least(wi.w, b.cols),
  wi.h
from widget_instances wi
cross join grid_breakpoints b;

-- The old view selects these columns, so it has to go first; it is recreated
-- below without geometry.
drop view dashboard_widgets;

alter table widget_instances
  drop constraint widget_instances_fits_grid,
  drop column x,
  drop column y,
  drop column w,
  drop column h;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table widget_layouts enable row level security;
alter table widget_layouts force  row level security;

-- Ownership stays derived — dashboard -> widget -> layout — so a dashboard still
-- changes hands in exactly one place.
create policy widget_layouts_owner on widget_layouts
  for all
  using (
    exists (
      select 1
      from widget_instances wi
      join dashboards d on d.id = wi.dashboard_id
      where wi.id = widget_layouts.widget_instance_id
        and d.owner_id = app.current_user_id()
    )
  )
  with check (
    exists (
      select 1
      from widget_instances wi
      join dashboards d on d.id = wi.dashboard_id
      where wi.id = widget_layouts.widget_instance_id
        and d.owner_id = app.current_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------
-- security_invoker on both: without it a view runs as its owner and bypasses
-- every policy above.
create view dashboard_widgets
  with (security_invoker = true)
as
select
  wi.id,
  wi.dashboard_id,
  wi.widget_type,
  wi.config,
  wi.schema_version,
  wt.display_name as type_display_name,
  wt.version      as type_version,
  wt.entry_url    as type_entry_url,
  wt.min_w        as type_min_w,
  wt.min_h        as type_min_h,
  wt.enabled      as type_enabled
from widget_instances wi
join widget_types wt on wt.type = wi.widget_type;

create view dashboard_widget_layouts
  with (security_invoker = true)
as
select
  wl.widget_instance_id,
  wi.dashboard_id,
  wl.breakpoint,
  wl.x,
  wl.y,
  wl.w,
  wl.h,
  b.sort_order as breakpoint_sort_order
from widget_layouts wl
join widget_instances wi on wi.id = wl.widget_instance_id
join grid_breakpoints b on b.name = wl.breakpoint;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on grid_breakpoints to bluedoor_app;
grant select, insert, update, delete on widget_layouts to bluedoor_app;
grant select on dashboard_widgets to bluedoor_app;
grant select on dashboard_widget_layouts to bluedoor_app;
grant execute on function app.check_widget_layout_fits() to bluedoor_app;
