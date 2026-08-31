import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc";
import { validateWidgetConfig } from "../widget-config";

// Bounds only — the real "does it fit" rule depends on the breakpoint's column
// count and is enforced by a trigger in the database, which is the only place
// that knows how many columns a breakpoint has.
const MAX_COLS = 48;

const layoutItem = z.object({
  id: z.uuid(),
  x: z.number().int().min(0).max(MAX_COLS),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(MAX_COLS),
  h: z.number().int().min(1).max(40),
});

export const dashboardRouter = router({
  /**
   * The installed plugin catalogue. Comes from the database, so a new widget type
   * appears in the picker on INSERT — no redeploy of the frontend.
   */
  catalog: protectedProcedure
    .input(z.object({ surface: z.enum(["dashboard", "notebook"]).default("dashboard") }).optional())
    .query(async ({ ctx, input }) => {
      const surface = input?.surface ?? "dashboard";

      return ctx.tx
        .selectFrom("widgetTypes")
        .select([
          "type",
          "version",
          "displayName",
          "description",
          "configSchema",
          "entryUrl",
          "defaultW",
          "defaultH",
          "minW",
          "minH",
        ])
        .where("enabled", "=", true)
        // One library, asked a different question per surface. A component
        // declares where it belongs; the caller does not keep a list.
        .where(sql<boolean>`${sql.ref("surfaces")} @> array[${sql.lit(surface)}]::text[]`)
        .orderBy("displayName")
        .execute();
    }),

  /**
   * Screen-size buckets and their column counts. The client asks rather than
   * hard-coding them, so changing how many columns a phone gets is an UPDATE.
   */
  breakpoints: protectedProcedure.query(async ({ ctx }) => {
    return ctx.tx
      .selectFrom("gridBreakpoints")
      .select(["name", "minWidth", "cols"])
      .orderBy("sortOrder")
      .execute();
  }),

  /**
   * The current user's dashboard and its widgets.
   *
   * No `where owner_id = ...` anywhere below: the policy on dashboards already
   * restricts this, and dashboard_widgets is a security_invoker view so the same
   * policy reaches through it. The filter is the database's job.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const dashboard = await ctx.tx
      .selectFrom("dashboards")
      .select(["id", "name", "updatedAt"])
      .orderBy("createdAt")
      .limit(1)
      .executeTakeFirst();

    if (!dashboard) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No dashboard for this user. Run ./db/seed-dev.sh.",
      });
    }

    const widgets = await ctx.tx
      .selectFrom("dashboardWidgets")
      .selectAll()
      .where("dashboardId", "=", dashboard.id)
      .execute();

    const rows = await ctx.tx
      .selectFrom("dashboardWidgetLayouts")
      .select(["widgetInstanceId", "breakpoint", "x", "y", "w", "h"])
      .where("dashboardId", "=", dashboard.id)
      .orderBy(["breakpointSortOrder", "y", "x"])
      .execute();

    // Reshaped into { lg: [...], md: [...] } — the form react-grid-layout wants,
    // built here rather than in the client so the wire format is the useful one.
    const layouts: Record<string, { i: string; x: number; y: number; w: number; h: number }[]> = {};
    for (const row of rows) {
      (layouts[String(row.breakpoint)] ??= []).push({
        i: String(row.widgetInstanceId),
        x: Number(row.x),
        y: Number(row.y),
        w: Number(row.w),
        h: Number(row.h),
      });
    }

    return { dashboard, widgets, layouts };
  }),

  addWidget: protectedProcedure
    .input(z.object({ dashboardId: z.uuid(), type: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const type = await ctx.tx
        .selectFrom("widgetTypes")
        .select(["type", "version", "configSchema", "defaultW", "defaultH"])
        .where("type", "=", input.type)
        .where("enabled", "=", true)
        .executeTakeFirst();

      if (!type) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown widget type "${input.type}".` });
      }

      // An empty object runs through the schema's defaults, so a new instance
      // starts with exactly the config its type declares.
      const defaults = validateWidgetConfig(type.type, type.version, type.configSchema, {});
      if (!defaults.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Widget type "${type.type}" has an unusable config_schema: ${defaults.errors.join("; ")}`,
        });
      }

      // If the dashboard is not the caller's, RLS makes the policy's WITH CHECK
      // reject this — so there is no ownership check here to forget.
      let created;
      try {
        created = await ctx.tx
          .insertInto("widgetInstances")
          .values({
            dashboardId: input.dashboardId,
            widgetType: type.type,
            config: JSON.stringify(defaults.value),
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
      } catch (error) {
        throw asForbiddenIfPolicyViolation(error);
      }

      // Place it at every breakpoint at once, each with its own idea of "the
      // bottom" and its width clamped to that breakpoint's columns. Seeding all
      // of them means a narrow screen opens on a deliberate arrangement rather
      // than one react-grid-layout invented on the spot.
      await sql`
        insert into widget_layouts (widget_instance_id, breakpoint, x, y, w, h)
        select
          ${created.id}::uuid,
          b.name,
          0,
          coalesce(placed.bottom, 0),
          least(${type.defaultW}::int, b.cols),
          ${type.defaultH}::int
        from grid_breakpoints b
        left join lateral (
          select max(wl.y + wl.h) as bottom
          from widget_layouts wl
          join widget_instances wi on wi.id = wl.widget_instance_id
          where wi.dashboard_id = ${input.dashboardId}::uuid
            and wl.breakpoint = b.name
        ) placed on true
      `.execute(ctx.tx);

      return created;
    }),

  removeWidget: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tx
        .deleteFrom("widgetInstances")
        .where("id", "=", input.id)
        .executeTakeFirst();

      // Zero rows means either "no such widget" or "not yours" — the policy makes
      // those indistinguishable from here, which is the point.
      if (Number(result.numDeletedRows) === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Widget not found." });
      }
      return { id: input.id };
    }),

  /**
   * Pin a widget in place, or release it. Locked widgets are not dragged or
   * resized, and the others compact around them.
   *
   * The lock is a property of the widget, not of a breakpoint, so it holds at
   * every screen size — pinning something on a desktop and finding it adrift on
   * a phone is not what "lock" promises.
   */
  setLocked: protectedProcedure
    .input(z.object({ id: z.uuid(), locked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tx
        .updateTable("widgetInstances")
        .set({ locked: input.locked })
        .where("id", "=", input.id)
        .executeTakeFirst();

      if (Number(result.numUpdatedRows) === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Widget not found." });
      }
      return { id: input.id, locked: input.locked };
    }),

  /**
   * Persist a drag or resize for ONE breakpoint. Resizing the window does not
   * save anything — only the arrangement a person actually made at the size they
   * made it at, which is why a phone layout does not overwrite a desktop one.
   *
   * One statement for the whole breakpoint: a dashboard moves as a unit, and a
   * partially-saved grid is a layout nobody chose.
   */
  saveLayout: protectedProcedure
    .input(
      z.object({
        breakpoint: z.string().min(1).max(8),
        items: z.array(layoutItem).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.items.length === 0) return { updated: 0 };

      try {
        const result = await sql<{ widget_instance_id: string }>`
          insert into widget_layouts (widget_instance_id, breakpoint, x, y, w, h)
          select v.id, ${input.breakpoint}, v.x, v.y, v.w, v.h
          from jsonb_to_recordset(${JSON.stringify(input.items)}::jsonb)
            as v(id uuid, x int, y int, w int, h int)
          on conflict (widget_instance_id, breakpoint) do update
            set x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h
          where (widget_layouts.x, widget_layouts.y, widget_layouts.w, widget_layouts.h)
                is distinct from (excluded.x, excluded.y, excluded.w, excluded.h)
          returning widget_instance_id
        `.execute(ctx.tx);

        return { updated: result.rows.length };
      } catch (error) {
        throw asOverflowIfCheckViolation(error);
      }
    }),

  /**
   * Save a widget's settings, checked against its type's JSON Schema. A widget
   * cannot talk itself into storing config its type does not declare.
   */
  saveConfig: protectedProcedure
    .input(z.object({ id: z.uuid(), config: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.tx
        .selectFrom("widgetInstances as wi")
        .innerJoin("widgetTypes as wt", "wt.type", "wi.widgetType")
        .select(["wi.id", "wt.type", "wt.version", "wt.configSchema"])
        .where("wi.id", "=", input.id)
        .executeTakeFirst();

      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Widget not found." });

      const validated = validateWidgetConfig(target.type, target.version, target.configSchema, input.config);
      if (!validated.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validated.errors.join("; ") });
      }

      await ctx.tx
        .updateTable("widgetInstances")
        .set({ config: JSON.stringify(validated.value) })
        .where("id", "=", input.id)
        .execute();

      return { config: validated.value };
    }),
});

// Postgres reports a policy denial as SQLSTATE 42501. Surfacing it as FORBIDDEN
// keeps the database as the thing that decided, rather than a 500 that looks like a bug.
// The breakpoint-fit trigger raises check_violation (23514). Surface it as a bad
// request: the client sent a layout that does not fit the columns it claimed.
// The database raises check_violation (23514) for two rules the client is
// supposed to have honoured already: a layout that overflows its breakpoint's
// columns, and any attempt to move a locked widget. Both are the client's fault,
// so both are 400s rather than 500s.
function asOverflowIfCheckViolation(error: unknown): unknown {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "23514" || err?.code === "23503") {
    return new TRPCError({ code: "BAD_REQUEST", message: err.message ?? "Layout does not fit." });
  }
  return error;
}

function asForbiddenIfPolicyViolation(error: unknown): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42501") {
    return new TRPCError({ code: "FORBIDDEN", message: "Not your dashboard." });
  }
  return error;
}
