#!/usr/bin/env bash
# Apply pending migrations, in order, each in its own transaction.
#
#   ./db/apply.sh                                  # local (db/local/.env defaults)
#   DATABASE_URL="$(terraform -chdir=infra/terraform output -raw admin_database_url)" ./db/apply.sh
#
# Always run as the OWNER role. The app's role owns nothing and cannot DDL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5433/bluedoor}"

psql_do() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc "$@"; }

psql_do -q -c "
  create table if not exists schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
  );"

applied="$(psql_do -tAc 'select version from schema_migrations')"

shopt -s nullglob
for file in "$ROOT"/db/migrations/*.sql; do
  version="$(basename "$file" .sql)"
  if grep -qxF "$version" <<<"$applied"; then
    echo "  skip  $version"
    continue
  fi
  echo "  apply $version"
  # Single transaction: the migration and its bookkeeping commit together, so a
  # failure halfway leaves neither behind.
  psql_do -q --single-transaction \
    -f "$file" \
    -c "insert into schema_migrations (version) values ('$version')"
done

echo "done"
