#!/bin/sh
set -eu

if [ "${POSTGRES_APP_USER:-fann_app}" != "fann_app" ]; then
  echo >&2 "POSTGRES_APP_USER doit être fann_app pour correspondre à la liste de privilèges."
  exit 1
fi
if [ -z "${POSTGRES_APP_PASSWORD:-}" ] || [ "${#POSTGRES_APP_PASSWORD}" -lt 32 ]; then
  echo >&2 "POSTGRES_APP_PASSWORD doit être un secret unique d'au moins 32 caractères."
  exit 1
fi
case "$POSTGRES_APP_PASSWORD" in
  *[!A-Za-z0-9_-]*) echo >&2 "POSTGRES_APP_PASSWORD doit être URL-safe (base64url)."; exit 1 ;;
esac

# La valeur du mot de passe est passée comme variable psql puis citée par format(%L).
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE fann_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fann_app')
\gexec
SELECT format(
  'ALTER ROLE fann_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L',
  :'app_password'
)
\gexec
SQL
