#!/usr/bin/env bash
# Sauvegarde quotidienne : dump PostgreSQL + copie du .env, chiffrés (AES-256) dans UNE archive, avec rétention.
# Si BACKUP_RSYNC_DEST est défini dans .env, l'archive est aussi envoyée vers ce serveur distant (rsync via SSH).
# Usage : bash scripts/vps/sauvegarde-chiffree.sh        (appelé chaque nuit par cron, voir 04-installer-sauvegarde.sh)
# Restauration : voir docs/DEPLOIEMENT_VPS.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
# Le compose du VPS doit être celui utilisé par les scripts du projet (docker compose exec db).
export COMPOSE_FILE="compose.yaml:compose.vps.yaml"

garder="${BACKUP_KEEP_LOCAL:-14}"
cle="${BACKUP_KEY_FILE:-$HOME/.fann-backup.key}"
dest_chiffre="sauvegardes/chiffrees"; clair="sauvegardes/clair"
mkdir -p "$dest_chiffre" "$clair"

if [ ! -s "$cle" ]; then
  openssl rand -base64 48 | tr -d '\n' > "$cle"; chmod 600 "$cle"
  echo "Clé de chiffrement créée : $cle — COPIEZ-LA HORS DU SERVEUR (sans elle les sauvegardes sont illisibles)." >&2
fi

# 1. Dump vérifié (script du projet) ; une seule copie en clair, supprimée ensuite.
bash scripts/sauvegarde-postgres.sh "$clair" 1 >/dev/null
dump="$(ls -1t "$clair"/fann-pointage-*.dump | head -n1)"
[ -s "$dump" ] || { echo "Dump introuvable ou vide." >&2; exit 1; }

# 2. Archive chiffrée : dump + .env (BADGE_SECRET nécessaire pour que les badges imprimés restent valides).
horodatage="$(date +%Y%m%d-%H%M%S)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$dump" "$tmp/base.dump"; cp .env "$tmp/env.sauvegarde"
archive="$dest_chiffre/fann-${horodatage}.tar.enc"
tar -C "$tmp" -cf - base.dump env.sauvegarde | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$cle" -out "$archive.tmp"
mv "$archive.tmp" "$archive"
rm -f "$dump"
echo "Sauvegarde chiffrée : $archive ($(wc -c < "$archive") octets)"

# 3. Rétention locale.
ls -1t "$dest_chiffre"/fann-*.tar.enc | tail -n +"$((garder + 1))" | while IFS= read -r ancien; do rm -f -- "$ancien"; done

# 4. Copie distante facultative.
dest="$(grep -m1 '^BACKUP_RSYNC_DEST=' .env | cut -d= -f2- || true)"
if [ -n "$dest" ]; then
  rsync -a --partial -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" "$archive" "$dest/" \
    && echo "Copie distante envoyée vers $dest" \
    || echo "ATTENTION : l'envoi vers $dest a échoué (la sauvegarde locale est conservée)." >&2
fi
