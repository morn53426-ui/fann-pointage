#!/usr/bin/env bash
# Restaure un dump PostgreSQL FANN POINTAGE.
# Usage : bash scripts/restaurer-sauvegarde.sh <fichier.dump> [test|production]
# Le mode test est strict : aucune erreur pg_restore n'est ignorée et la base jetable est toujours supprimée.
set -euo pipefail
cd "$(dirname "$0")/.."
dump="${1:?Indiquez le fichier .dump}"
mode="${2:-test}"
[ -s "$dump" ] || { echo "Fichier introuvable ou vide : $dump" >&2; exit 2; }
docker compose exec -T db pg_restore --list < "$dump" > /dev/null

case "$mode" in
  test)
    # DB name stays under PostgreSQL's 63-character identifier limit and avoids collisions between tests.
    testdb="fann_restore_test_$$"
    nettoyer() {
      docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$testdb" >/dev/null 2>&1 || true
    }
    trap nettoyer EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1" && createdb -U "$POSTGRES_USER" "$1"' sh "$testdb"
    docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-privileges --exit-on-error --single-transaction' sh "$testdb" < "$dump"
    # Requiring all tables to be readable catches truncated/incomplete restores, not just a non-empty database.
    comptes=$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -At -F "|" -c "SELECT (SELECT count(*) FROM agents), (SELECT count(*) FROM services), (SELECT count(*) FROM plannings), (SELECT count(*) FROM pointages), (SELECT count(*) FROM profiles), (SELECT count(*) FROM absences_anomalies)"' sh "$testdb" | tr -d '\r')
    IFS='|' read -r agents services plannings pointages profils absences <<< "$comptes"
    for n in "$agents" "$services" "$plannings" "$pointages" "$profils" "$absences"; do
      [[ "$n" =~ ^[0-9]+$ ]] || { echo "ECHEC : comptage invalide après restauration : $comptes" >&2; exit 1; }
    done
    if [ "$services" -eq 0 ] || [ "$agents" -eq 0 ]; then
      echo "ECHEC : aucun service ou agent restauré. La sauvegarde est probablement incomplète." >&2
      exit 1
    fi
    migrations=$(docker compose exec -T db sh -c 'if psql -U "$POSTGRES_USER" -d "$1" -Atqc "SELECT to_regclass('\''public.app_schema_migrations'\'') IS NOT NULL" | grep -qx t; then psql -U "$POSTGRES_USER" -d "$1" -Atqc "SELECT count(*) FROM app_schema_migrations"; else printf 0; fi' sh "$testdb" | tr -d '\r')
    [[ "$migrations" =~ ^[0-9]+$ ]] || { echo "ECHEC : marqueurs de migration impossibles à lire." >&2; exit 1; }
    echo "Restauration isolée réussie : agents=$agents services=$services plannings=$plannings pointages=$pointages profils=$profils absences=$absences migrations=$migrations."
    echo "La sauvegarde a été restaurée avec --exit-on-error ; la base de test sera supprimée automatiquement."
    ;;
  production)
    echo "ATTENTION : le mode production remplace l'état actuel de la base. Sauvegardez-la avant de continuer." >&2
    read -r -p 'Tapez RESTAURER pour confirmer : ' confirmation
    [ "$confirmation" = "RESTAURER" ] || { echo "Annulé."; exit 0; }
    docker compose stop app
    docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction' < "$dump"
    docker compose run --rm migrate
    docker compose up -d app
    docker compose ps
    echo "Restauration terminée. Contrôlez /readyz et les données métier avant de rouvrir le service."
    ;;
  *) echo "Mode inconnu : $mode (test ou production)" >&2; exit 2;;
esac
