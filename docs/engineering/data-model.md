---
status: working
updated: 2026-08-31
owner: riemer
---

# Data model

Two surfaces over one component library. DDL is [db/migrations/](../../db/migrations/); this page
is the *intent*.

```
                    ┌──< dashboards ──< widget_instances ──< widget_layouts >── grid_breakpoints
users ──────────────┤                          │
                    └──< nodes (tree)          └──> widget_types >── surfaces
                           │  content jsonb          ▲
                           └──────────────────────────┘
                              blocks reference types by name, inside the document
```

**dashboard** — a free grid of cards. Shortcuts and things you watch all day.
**notebook** — an experiment: a document of blocks, top to bottom.

| Table | Holds | Who writes it |
|---|---|---|
| `users` | identity | auth, once it exists |
| `dashboards` | one per person, `owner_id` is the only ownership fact in the system | the app |
| `widget_types` | the component library: version, display name, default/min size, `config_schema`, and which `surfaces` it may appear on | an operator, by INSERT |
| `surfaces` | the surfaces that exist (`dashboard`, `notebook`) | an operator |
| `nodes` | the file tree: folders and experiments, arbitrarily nested. An experiment's document is `content` | the app |
| `widget_instances` | a placed widget: which type, its `config`, and whether it is `locked` | the app |
| `grid_breakpoints` | screen-size buckets and their column counts | an operator, by UPDATE |
| `widget_layouts` | geometry, one row per (widget, breakpoint) | the app, on drag/resize |

## Three decisions worth knowing

**One library, asked a different question per surface.** `widget_types.surfaces` is a `text[]`
validated against the `surfaces` table by trigger (an array cannot carry a foreign key). The
dashboard's picker and the notebook's slash menu are the same query with a different argument —
neither keeps a list, so adding a component makes it appear in the right places by itself.

**The tree is a file system, enforced as one.** `nodes` holds folders and experiments in one table,
because they are the same thing to a tree: a parent, a name, an order. Postgres refuses a folder
inside itself (recursive ancestor walk), a child of an experiment, a duplicate name in one directory
(two partial unique indexes, since a NULL parent would never collide), a move into someone else's
folder, and content on a folder.

**An experiment's document is a blob, on purpose.** `nodes.content` is BlockNote's own block array.
The reasoning and its cost are [ADR 0003](../decisions/0003-off-the-shelf-notebook.md); the short
version is that a ProseMirror document is atomic and splitting it into rows means reimplementing the
editor in SQL. Scoped to notebooks — dashboard geometry is still rows.

**`config_schema` drives the settings UI.** The shell generates each widget's gear panel from the
JSON Schema in `widget_types` — labels from `title`, help text from `description`, a dropdown
wherever there is an `enum`. A widget author gets a settings form by declaring a schema, and a
third-party widget cannot ship a form that writes config its own schema forbids, because the server
validates against the same column.

**Geometry is per breakpoint, not per widget.** A widget's position is a property of
`(widget, breakpoint)` — the same card sits top-right on a desktop and second-from-top on a phone.
That is why `widget_layouts` exists instead of `x/y/w/h` columns on `widget_instances`.

Only the breakpoint a person is actually looking at is written. Resizing a window rearranges the
grid and saves nothing, so a laptop layout can never overwrite the desktop one.
**VERIFIED** 2026-08-31: driving the browser through all five breakpoints left the stored rows byte
identical; dragging at `xs` changed `xs` rows only.

**Position is columns, not a blob.** Dragging one widget updates one row, a stale client cannot
overwrite its neighbours, and `schema_version` on `widget_instances` lets a migration find the
instances still holding an old config shape. One JSON blob per dashboard would lose all three.

**A lock is per widget, not per breakpoint.** `widget_instances.locked` pins a widget: not
draggable, not resizable, and the others compact *around* it. It deliberately does not live on
`widget_layouts` — pinning something on a desktop and finding it adrift on a phone is not what
"lock" promises.

**Ownership is derived, never duplicated.** `widget_instances` and `widget_layouts` have no
`owner_id`; their policies reach up through `dashboard_id`. A dashboard changes hands in exactly one
place.

## The rules that live in the database

- **RLS on** `users`, `dashboards`, `widget_instances`, `widget_layouts`, all with
  `FORCE ROW LEVEL SECURITY`. `widget_types` and `grid_breakpoints` are shared catalogues: readable
  by everyone, writable only by the owner role.
- **`app.current_user_id()`** reads the `app.user_id` GUC. Unset yields NULL, and `= NULL` matches
  nothing — so a request that forgets to set it sees an empty database, not someone else's.
- **Both views are `security_invoker = true`.** Without it a view runs as its owner and bypasses
  every policy above. This is the single easiest way to undo all of the security in this schema.
- **A trigger, not a CHECK, enforces "does it fit".** `x + w <= cols` depends on
  `grid_breakpoints.cols`, and a CHECK constraint cannot read another table.
  `app.check_widget_layout_fits()` raises `check_violation`, which the API maps to a 400.
- **A trigger also refuses to move a locked widget.** The client already will not, but a stale tab
  or a replayed request still cannot. Same `check_violation` path, same 400.
- **Minimum sizes are enforced, and clamped.** `widget_types.min_w`/`min_h` are measured from the
  rendered widgets, not guessed — a Counter needs 202px, so `min_h = 3` (204px at
  `rowHeight 60` + `margin 12`). The trigger checks `w >= least(min_w, cols)`: a 3-column minimum is
  meaningless on a 2-column phone.
- **Config shape is not enforced in the database.** `pg_jsonschema` is not on Scaleway's managed
  extension allowlist, so Ajv validates `config` against `widget_types.config_schema` in the API and
  Postgres only checks `jsonb_typeof(config) = 'object'`. The one concession in
  [ADR 0002](../decisions/0002-postgres-as-source-of-truth.md).

## Changing it

1. Write a new `db/migrations/NNNN_*.sql`. Never edit an applied one.
2. `./db/apply.sh`
3. `cd web && pnpm db:types` — the TypeScript types are generated from the migrated database, not
   written by hand.

If a migration drops a column a view selects, drop the view first: Postgres refuses the `ALTER`
otherwise, and the migration will fail halfway through an otherwise clean run.
