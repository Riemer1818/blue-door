# Engineering

The system we write.

**Written so far:**

- [setup.md](setup.md) — clone to running, locally and (designed, not applied) on Scaleway. Ends
  with the gotchas that cost an afternoon each.
- [data-model.md](data-model.md) — the six tables, why geometry is per breakpoint, and the rules
  that live in Postgres rather than in the API.
- [widget-contract.md](widget-contract.md) — what a widget receives, and why it is shaped for a
  sandbox it does not yet run in.

The stack decision behind both is [ADR 0002](../decisions/0002-postgres-as-source-of-truth.md).

Still to write, roughly in the order they become worth it:

- `architecture.md` — the components and the seams between them, with a diagram. Currently split
  across the README's "two ideas" section and `data-model.md`.
- `auth.md` — there is none. `web/src/server/session.ts` returns a dev user and throws in
  production; ADR 0002 accepted building it as the cost of leaving Supabase. Nothing has been
  decided since.
- `sandboxing.md` — the widget contract is shaped for a sandbox that does not exist. Required
  before any third-party widget runs against real data, which is
  [principle 4](../product/principles.md).
- `environments.md` — local, staging, prod: what each is, how to reach it, what's safe to break.
  Waits on anything actually being deployed.
- `runbooks/` — one file per operational procedure (deploy, restore, rotate a key, debug a failure)
- `gotchas.md` — the things that cost someone an afternoon. Currently living at the end of
  [setup.md](setup.md); split it out when it outgrows that.

Keep this honest about what is **running** vs **designed**. The house convention from other
projects: a `WORKING —` block for what is proven live (with the date it was proven), a `NOTE —`
block for a design intention or an open fork. Never let a design doc read as if it describes a
deployed system.
