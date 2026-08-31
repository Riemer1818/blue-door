#!/bin/sh
# Runs once, on first container start, before any migration.
#
# Creates the runtime role. On Scaleway this is Terraform's job
# (infra/terraform/rdb.tf); the role must exist before 0001_init.sql grants to it.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'bluedoor_app') then
    create role bluedoor_app login password '${BLUEDOOR_APP_PASSWORD}';
  end if;
end
\$\$;

grant connect on database ${POSTGRES_DB} to bluedoor_app;
SQL
