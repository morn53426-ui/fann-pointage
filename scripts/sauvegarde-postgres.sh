#!/usr/bin/env bash
# Sauvegarde de la base FANN POINTAGE (format personnalisé pg_dump), avec vérification et rétention.
# Usage : bash scripts/sauvegarde-postgres.sh [dossier] [nombre_de_sauvegardes_a_garder]
set -euo pipefail
cd "$(dirname "$0")/.."
dossier="${1:-sauvegardes}"
garder="${2:-14}"
case "$garder" in ''|*[!0-9]*) echo "Le nombre de sauvegardes à garder doit être un entier." >&2; exit 2;; esac
[ "$garder" -ge 1 ] || { echo "Le nombre de sauvegardes à garder doit être au moins 1." >&2; exit 2; }
mkdir -p "$dossier"
fichier="$dossier/fann-pointage-$(date +%Y%m%d-%H%M%S).dump"
trap 'rm -f "$fichier.tmp"' EXIT
# pg_dump s'exécute dans le conteneur avec le compte propriétaire ; aucun mot de passe n'apparaît en ligne de commande.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$fichier.tmp"
[ -s "$fichier.tmp" ] || { echo "Sauvegarde vide : abandon." >&2; exit 1; }
# Vérifie que l'archive est lisible avant de la conserver.
docker compose exec -T db pg_restore --list < "$fichier.tmp" > /dev/null
mv "$fichier.tmp" "$fichier"
echo "Sauvegarde créée : $fichier ($(wc -c < "$fichier") octets)"
# Rétention : ne garde que les plus récentes.
ls -1t "$dossier"/fann-pointage-*.dump 2>/dev/null | tail -n +"$((garder + 1))" | while IFS= read -r ancien; do rm -f -- "$ancien"; done
