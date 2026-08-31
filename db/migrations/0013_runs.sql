-- 0013: a durable record of a tool run.
--
-- The first slice of BLU-10, and deliberately only a slice. BLU-10 wants runs,
-- an append-only event table, and an SSE endpoint serving live tail and replay
-- through one path. This is the runs half, because executing a tool needs
-- somewhere to put the answer and nothing else does yet. Events stay in the
-- JSONL file the executor writes until the rest of BLU-10 lands.
--
-- WHY A ROW AND NOT MEMORY. The run is started by a request and finishes long
-- after that request has returned, so its state cannot live in the Next process:
-- a hot reload in development discards it, and a restart in production would
-- lose every run in flight. It is also what BLU-17's run picker and BLU-11's
-- replay both read, so the row is needed regardless of how execution is
-- scheduled.
--
-- This is NOT a queue. Nothing polls it, nothing claims rows, there is no
-- worker. The app spawns the executor directly and writes the outcome back when
-- the process exits. A queue is what this becomes when the batch lane moves off
-- one host, and the shape here does not have to change when it does.

create table runs (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  owner_id      uuid not null references users (id) on delete cascade,

  -- Named, not referenced. The catalogue lives on disk (and eventually in its
  -- own repository, see BLU-20), so a foreign key here would be a lie about
  -- where the authority is. An adapter can also be removed while its runs stay
  -- worth reading.
  adapter_id    text not null,
  operation     text not null,

  -- From tools/outcomes.json, which is the single source. Not an enum and not a
  -- check constraint listing the values: the vocabulary is versioned data read
  -- by events.py and by the frontend's generated types, and a third copy here
  -- would be the drift we have spent the day removing. NULL means still running.
  outcome       text,
  wall_seconds  numeric,

  -- The executor's own result JSON, kept whole. Its shape is the executor's to
  -- change, and parsing every field into columns would make this migration a
  -- second definition of that contract.
  result        jsonb,

  -- Where the JSONL events were written. A pointer rather than the content:
  -- MAFFT wrote several hundred stderr lines for a three-sequence input, and a
  -- deep job writes megabytes.
  events_path   text,

  -- Where outputs land once collected. NULL is the tree root.
  output_parent uuid references nodes (id) on delete set null,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index runs_owner_started_idx on runs (owner_id, started_at desc);
-- BLU-17 asks "what happened to this tool lately", which is this index.
create index runs_adapter_started_idx on runs (adapter_id, started_at desc);

comment on column runs.outcome is
  'NULL while running. Values come from tools/outcomes.json - deliberately not
   constrained here, because that file is the vocabulary and a check constraint
   would be a second statement of it.';

-- A run that finished has an outcome, and one that has an outcome has finished.
-- The pair is what a reader uses to tell "still going" from "ended", and a row
-- where they disagree is unreadable in both directions.
alter table runs add constraint runs_finished_has_outcome
  check ((outcome is null) = (finished_at is null));

alter table runs enable row level security;
alter table runs force  row level security;

create policy runs_owner on runs
  for all
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

grant select, insert, update, delete on runs to bluedoor_app;
