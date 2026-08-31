---
status: accepted
date: 2026-08-31
---

# 0003. Buy the notebook, keep the library

## Context

The dashboard needed a second surface: somewhere the actual experiments live, organised by the
person who owns them, using the same components the dashboard uses.

Three things were settled going in: an experiment page is a **document of blocks**, not a grid;
organisation is a **file system** — arbitrary folders, nested as deep as someone wants; and the
explicit instruction was to **use as much off-the-shelf software as possible**.

## Options

**Build the block editor.** The `blocks` table in migration 0007 was the start of this: one row per
block, ordered by a fractional index, mirroring `widget_instances`. It is weeks of work to reach
parity with what people expect — nesting, inline marks, drag handles, slash menu, undo, paste
handling, IME, collaborative cursors later — and none of that work is blue door's problem to solve.

**BlockNote.** A Notion-style block editor on ProseMirror/TipTap, React-native, with
`createReactBlockSpec` for custom blocks. Slash menu, drag-to-reorder and the block model arrive
working. **Chosen.**

For the tree: **react-arborist**, which brings virtualisation, drag-and-drop reparenting and inline
rename. Icons from **lucide-react** rather than the hand-drawn SVGs that had started accumulating.

## Decision

BlockNote owns the experiment document. react-arborist renders the tree. `widget_types` remains
ours, and is the seam between the two surfaces:

- A component declares which surfaces it may appear on (`widget_types.surfaces`, checked against a
  `surfaces` table). The dashboard's picker and the notebook's slash menu are the **same query with
  a different argument** — neither keeps a list.
- The notebook embeds components through **one** custom block type, `component`, carrying the
  component's name in a prop. Adding a component to the library puts it in the slash menu with no
  code change and no deploy.
- Components see the **same `WidgetHost` contract** on both surfaces. On the dashboard
  `saveConfig` writes a row; in the notebook it writes back into the document. The component cannot
  tell, which is the same property that will let it move into an iframe later.

## Consequences

What this buys: an editor that already works, a tree that already works, and one component library
serving both surfaces. The `blocks` table lasted one migration and was dropped in 0008 — a good
trade at that price.

What it costs:

- **The document is a blob.** `nodes.content` is BlockNote's own block array as `jsonb`, which is a
  deliberate exception to "position as columns, not a blob" in
  [0002](0002-postgres-as-source-of-truth.md). A ProseMirror document is atomic: it owns its
  nesting, ordering and inline marks, and every edit is a transaction against the whole document.
  Splitting it into rows means reimplementing the editor's model in SQL and keeping the two in step.
  **The exception is scoped to notebook documents.** Dashboard geometry stays rows, because there a
  stale client overwriting its neighbours is a real failure and here it is not — one author, one
  document, one editor.
- **Postgres can no longer see inside a page.** Full-text search over experiment content, or "which
  experiments embed this component", now means indexing the JSON rather than joining a table.
  **OPEN** — a generated `tsvector` column over the document's text is the likely answer; nobody has
  needed it yet.
- **A dependency with opinions.** BlockNote brings Mantine for its UI chrome alongside Tailwind, and
  its own CSS. Its Next.js guide's `serverExternalPackages` advice actively breaks the build when
  the editor is client-only, because the CSS import is then handed to Node.
- **Two debounce-and-flush implementations** now exist — one for widget config, one for the
  document — because the editor owns its own change stream. Both use `sendBeacon` on `pagehide`.
  **ASSUMED** — worth unifying if a third appears.

## What was deliberately not done

Nothing about lab-notebook *records*: no dating, signing, witnessing, locking-on-completion or audit
trail. An experiment here is a document in a folder. If blue door needs to be a regulated ELN, that
is a separate decision and a heavier one.
