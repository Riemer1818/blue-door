# blue door

Repo: `git@github.com:Riemer1818/blue-door.git`. Linear workspace **blue door**
(`bluedoorbiotech`), team **BLU**.

> **Status as of 2026-08-31 — running locally, deployed nowhere.** Two surfaces over one
> component library: a dashboard of user-arranged widgets, and experiments as documents of blocks
> in a file tree. Postgres holds the authority (row-level security, SQL-first schema, nine
> migrations); `web/` is Next.js 16 + tRPC + Kysely with BlockNote and react-arborist;
> `infra/terraform/` describes Scaleway Managed PostgreSQL in `fr-par` and **validates but has
> never been applied**.
>
> **Not done, and load-bearing:** there is no authentication (`web/src/server/session.ts` returns
> a dev user and throws in production), and widgets run in-process — a sandbox is required before
> running code we did not write. See the README's "Not done" and
> [docs/engineering/](docs/engineering/).

## MCP servers

- **`linear-bluedoor`** — Issue tracking for the **blue door** workspace (team BLU) via the
  token-based stdio server `npx -y @tacticlaunch/mcp-linear`. **Token-based** (workspace-scoped
  personal API key in `LINEAR_API_TOKEN`) — see the Linear note below.
- **`context7`** — Up-to-date library/framework docs (`npx -y @upstash/context7-mcp`). Needs no
  token or build step, so it works as soon as you copy the config.
- **`playwright`** — Drives a real browser so changes can be checked rather than assumed
  (`npx -y @playwright/mcp@latest --headless --isolated --browser chrome`). **`--headless`** keeps
  it from popping a window on every check; **`--isolated`** uses a throwaway profile so runs never
  inherit cookies or state; **`--browser chrome`** uses the system Chrome already installed rather
  than downloading a Playwright build. No token. All `mcp__playwright__*` tools are auto-approved in
  [.claude/settings.json](.claude/settings.json) — everything they touch is a disposable browser
  pointed at localhost.

The committed [.mcp.json.example](.mcp.json.example) holds the structure with placeholders. The
real `.mcp.json` holds the token and is **gitignored** — never commit it. This works for both
terminal `claude` and VS Code's Claude Code extension. Auto-approval is in
[.claude/settings.json](.claude/settings.json).

After cloning:
1. `cp .mcp.json.example .mcp.json`
2. Replace `REPLACE_WITH_BLUEDOOR_LINEAR_API_KEY` with a Personal API key created in Linear →
   **Settings → Security & access → Personal API keys** *while in the blue door workspace*.
   No browser login step.
3. Launch Claude Code. The first session prompts to trust `.mcp.json` — approve once. Reload the
   window if you're in the VS Code extension. **A session already running when `.mcp.json` changed
   will not see the new server** — MCP servers are connected at startup, so restart Claude Code (or
   reload the VS Code window) after editing it.
4. Verify: ask "list the BLU issues". `mcp__linear-bluedoor__*` tools should be available.

> **Linear (`mcp__linear-bluedoor__linear_*`)** — Authentication is a **workspace-scoped personal
> API key**, not OAuth. Personal keys only see the workspace they were made in — this one is scoped
> to org `bluedoorbiotech` / team BLU. Read tools (`linear_get*`, `linear_search*`) plus
> `linear_createIssue` / `linear_updateIssue` / `linear_createComment` are auto-approved in
> [.claude/settings.json](.claude/settings.json); `linear_archive*` / `linear_delete*` prompt.
>
> **Why token-auth instead of Linear's hosted OAuth server (`mcp.linear.app/mcp`)?** Claude Code
> keys OAuth credentials by server **URL**, so every project pointing at the hosted server shares
> ONE login — you cannot pin a Claude project to a specific workspace. A token in the per-project
> gitignored `.mcp.json` keeps this project hard-pinned to blue door. **Never put the `lin_api_…`
> token in a committed file** (`.claude/settings.json`, `.mcp.json.example`) — only in `.mcp.json`.

## Linear: how we use it

**Everything lives in team BLU.** There is exactly one team in this workspace, so every Linear
action — listing, creating, updating, searching — defaults to **BLU** with no team-picking needed.
Issues are referenced by their `BLU-NN` identifiers.

**Workspace shape (verified 2026-08-31):**

| | |
|---|---|
| Workflow states | `Backlog` → `Todo` → `In Progress` → `In Review` → `Done` (plus `Canceled`, `Duplicate`) |
| Labels | `Feature`, `Bug`, `Improvement` |
| Projects | none yet |
| Cycles | not enabled |
| Members | riemer@riemer.fyi |

`BLU-1` … `BLU-4` are Linear's own onboarding template issues ("Get familiar with Linear",
"Connect your tools", "Import your data", "Set up your teams"). They are **not** real work —
ignore them when summarising the backlog, and archive them once the real backlog starts.

**Ticket-per-task — Linear is the source of truth for work.** Every *separate* piece of work gets
its **own** BLU ticket before it's done. "Separate" = a distinct deliverable (a schema, a page, a
deploy pipeline, a bug fix) — don't fold unrelated changes into one ticket, and don't do untracked
work on the side. If you discover separable work mid-task, file a ticket for it rather than
silently absorbing it.

**What a well-formed ticket looks like:**
- **Title** — imperative and specific: "Add ELISA batch import endpoint", not "backend stuff".
- **Description** — scope (what changes) + acceptance criteria (how we know it's done). Link the
  relevant [docs/](docs/) page if one exists.
- **Label** — exactly one of `Feature` / `Bug` / `Improvement`.
- **Team** — BLU.

**Status workflow — keep Linear in sync.** Move a ticket to `In Progress` *before* touching code;
to `In Review` when a PR is open; to `Done` when merged. Never leave a ticket you just worked on
sitting in `Backlog`/`Todo`. If no ticket exists for what you're about to do, ask whether to
create one first.

**Branches and commits.** Branch names carry the ticket: `<type>/blu-<NN>-<slug>` where `<type>` is
`feat`/`fix`/`chore`/`docs`. Commit subjects lead with the identifier: `BLU-12: add batch import`.
This is what makes the git history and the Linear backlog readable against each other.

**Useful tools** (`mcp__linear-bluedoor__linear_*`):
- `linear_getIssues` / `linear_getIssueById` / `linear_searchIssues` — browse, read, filter
- `linear_createIssue` / `linear_updateIssue` — create or change an issue
- `linear_getComments` / `linear_createComment` — issue discussion
- `linear_getTeams`, `linear_getUsers`, `linear_getWorkflowStates`, `linear_getLabels` — metadata
- `linear_getProjects` / `linear_getProjectById` — projects (none exist yet)

## The docs collection

[docs/](docs/) is where we accumulate knowledge that outlives any single ticket — product thinking,
market research, and engineering reference. **Read [docs/README.md](docs/README.md) before writing
into it**; it holds the conventions (naming, front-matter, when a doc is worth writing, how to cite
sources). The short version:

- [docs/product/](docs/product/) — [principles](docs/product/principles.md), [theses](docs/product/theses.md), [user research](docs/product/user-research/)
- [docs/market/](docs/market/) — the [ELN landscape](docs/market/eln-landscape/README.md): competitors, adjacent substitutes, sources
- [docs/engineering/](docs/engineering/) — [setup](docs/engineering/setup.md), [data model](docs/engineering/data-model.md), [widget contract](docs/engineering/widget-contract.md)
- [docs/decisions/](docs/decisions/) — dated ADRs: what we chose, and why, and what we gave up

**Start at [docs/product/principles.md](docs/product/principles.md)** for what a good product looks
like here, then [docs/product/theses.md](docs/product/theses.md) — six theses from June 2026 scored
against the August market scan. Together they are the fastest route to what we believe and how
strongly. Much of that material came from `~/Desktop/lintel`, the June predecessor of this project;
whether that folder is retired is [ADR 0001](docs/decisions/0001-fold-lintel-into-blue-door.md),
still `proposed`.

Keep docs honest: mark what is **verified** vs **assumed** vs **open**, and date anything that will
go stale. A confidently wrong doc is worse than no doc.

## Code style

- No emoji in code, comments, commit messages, or documentation
- Comments concise and technical
- Straightforward, professional language

## UI

Simpler and cleaner wins. Only show information a user acts on — no breakpoint names, column
counts, internal state, or other debug readouts in the interface. Prefer no subtitle over a
subtitle that restates what the screen already shows.
