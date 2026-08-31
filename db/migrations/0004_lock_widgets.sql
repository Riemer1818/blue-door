-- 0004: pin a widget in place.
--
-- A locked widget is not dragged, not resized, and — this is the useful part —
-- other widgets compact *around* it instead of pushing it. react-grid-layout
-- calls this `static`.
--
-- The flag lives on widget_instances rather than widget_layouts, so a lock is a
-- property of the widget itself and holds at every breakpoint. The alternative
-- (lock per breakpoint) would mean pinning something on a desktop and finding it
-- adrift on a phone, which is not what "lock" promises.

alter table widget_instances
  add column locked boolean not null default false;

comment on column widget_instances.locked is
  'Pinned in place: not draggable or resizable, and other widgets compact around it.';

-- The client already refuses to move a locked widget. This is the same rule
-- stated where it cannot be bypassed: a stale tab, a replayed request or a
-- future client that forgets still cannot shift a pinned widget.
create or replace function app.reject_locked_layout_change() returns trigger
  language plpgsql
as $$
begin
  if exists (
    select 1 from widget_instances wi
    where wi.id = new.widget_instance_id
      and wi.locked
  ) then
    raise exception 'widget % is locked and cannot be moved or resized', new.widget_instance_id
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

-- WHEN keeps this off the hot path: a layout save writes every widget on the
-- dashboard, and the trigger only fires for rows whose geometry actually changed.
create trigger widget_layouts_respect_lock
  before update on widget_layouts
  for each row
  when (
    (old.x, old.y, old.w, old.h) is distinct from (new.x, new.y, new.w, new.h)
  )
  execute function app.reject_locked_layout_change();

grant execute on function app.reject_locked_layout_change() to bluedoor_app;

-- Appended, not reordered: create or replace view only permits adding columns
-- at the end.
create or replace view dashboard_widgets
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
  wt.enabled      as type_enabled,
  wi.locked
from widget_instances wi
join widget_types wt on wt.type = wi.widget_type;
