-- 0006: minimum sizes that reflect what each widget actually needs.
--
-- Every type shipped with min_w/min_h of 2, which was a placeholder, not a
-- measurement. At h=2 (132px at the current row height) a Counter needs 202px,
-- so it scrolled inside its own card. Sizes below are measured from the rendered
-- widgets, not guessed.
--
-- Grid geometry, for the arithmetic: rowHeight 60px, margin 12px, so
--   height(h) = h * 60 + (h - 1) * 12   ->   h=2: 132px, h=3: 204px, h=4: 276px

-- Minimum and default move in one statement: widget_types_default_ge_min is
-- checked per row, so raising a minimum above its default in a separate update
-- would fail on the row in between.
update widget_types wt
set min_w = m.min_w,
    min_h = m.min_h,
    default_w = greatest(wt.default_w, m.min_w),
    default_h = greatest(wt.default_h, m.min_h)
from (values
  ('notes',   3, 3),   -- a textarea needs room to be a textarea
  ('clock',   2, 2),   -- 109px of content
  ('counter', 2, 3)    -- 193px: label, value, buttons
) as m(type, min_w, min_h)
where wt.type = m.type;

-- Bring existing placements up to the new minimums, at every breakpoint, without
-- letting a widened widget run off the right edge of its grid. Computed in a CTE
-- because UPDATE ... FROM cannot reference the target table from a LATERAL.
with target as (
  select
    wl.widget_instance_id,
    wl.breakpoint,
    b.cols,
    least(greatest(wl.w, least(wt.min_w, b.cols)), b.cols) as new_w,
    greatest(wl.h, wt.min_h)                               as new_h
  from widget_layouts wl
  join widget_instances wi on wi.id = wl.widget_instance_id
  join widget_types wt on wt.type = wi.widget_type
  join grid_breakpoints b on b.name = wl.breakpoint
  where wl.w < least(wt.min_w, b.cols)
     or wl.h < wt.min_h
)
update widget_layouts wl
set w = t.new_w,
    h = t.new_h,
    x = least(wl.x, greatest(t.cols - t.new_w, 0))
from target t
where t.widget_instance_id = wl.widget_instance_id
  and t.breakpoint = wl.breakpoint;

-- Enforcement, so the rule holds for any client. Replaces the fit check from
-- 0003 with one that also knows about minimums.
create or replace function app.check_widget_layout_fits() returns trigger
  language plpgsql
as $$
declare
  max_cols int;
  wt_min_w int;
  wt_min_h int;
  eff_min_w int;
begin
  select cols into max_cols from grid_breakpoints where name = new.breakpoint;

  if max_cols is null then
    raise exception 'unknown breakpoint %', new.breakpoint
      using errcode = 'foreign_key_violation';
  end if;

  select wt.min_w, wt.min_h into wt_min_w, wt_min_h
  from widget_instances wi
  join widget_types wt on wt.type = wi.widget_type
  where wi.id = new.widget_instance_id;

  -- A 3-column minimum is meaningless on a 2-column phone, so the minimum is
  -- clamped to what the breakpoint actually offers.
  eff_min_w := least(coalesce(wt_min_w, 1), max_cols);

  if new.w < eff_min_w then
    raise exception 'widget needs at least % columns at breakpoint %, got %',
      eff_min_w, new.breakpoint, new.w
      using errcode = 'check_violation';
  end if;

  if new.h < coalesce(wt_min_h, 1) then
    raise exception 'widget needs at least % rows, got %', wt_min_h, new.h
      using errcode = 'check_violation';
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
