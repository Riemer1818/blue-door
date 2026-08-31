#!/usr/bin/env bash
# Development data only — a user and a dashboard to log in as. Never run against
# production; it is kept out of db/migrations/ for exactly that reason.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5433/bluedoor}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc -q <<'SQL'
insert into users (id, email, display_name)
values ('00000000-0000-4000-8000-000000000d01', 'dev@bluedoor.local', 'Dev User')
on conflict (id) do nothing;

insert into dashboards (id, owner_id, name)
values (
  '00000000-0000-4000-8000-0000000000da',
  '00000000-0000-4000-8000-000000000d01',
  'My dashboard'
)
on conflict (id) do nothing;
SQL

echo "seeded dev user 00000000-0000-4000-8000-000000000d01 / dashboard ...00da"
