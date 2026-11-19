#!/usr/bin/env bash
# Sauvegarde PostgreSQL + .env en archive chiffrée et authentifiée (AES-256-CBC + HMAC-SHA256).
# Les fichiers en clair restent exclusivement dans un répertoire temporaire privé, supprimé à la sortie.
set -Eeuo pipefail
umask 077

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$racine"
export COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml:compose.vps.yaml}"

garder="${BACKUP_KEEP_LOCAL:-14}"
case "$garder" in
  ''|*[!0-9]*) echo 'BACKUP_KEEP_LOCAL doit être un entier entre 1 et 3650.' >&2; exit 2 ;;
esac
(( garder >= 1 && garder <= 3650 )) || { echo 'BACKUP_KEEP_LOCAL doit être compris entre 1 et 3650.' >&2; exit 2; }

[[ -f .env && ! -L .env && -s .env ]] || { echo '.env absent, vide ou symbolique : sauvegarde refusée.' >&2; exit 2; }
[[ ! -L sauvegardes ]] || { echo 'Le répertoire sauvegardes ne doit pas être un lien symbolique.' >&2; exit 2; }
mkdir -p sauvegardes/chiffrees
[[ -d sauvegardes/chiffrees && ! -L sauvegardes/chiffrees ]] || { echo 'Le répertoire de sauvegarde chiffrée est invalide.' >&2; exit 2; }
chmod 700 sauvegardes sauvegardes/chiffrees

tmp=''
archive_tmp=''
cle_tmp=''
nettoyer() {
  local code=$?
  [[ -z "$cle_tmp" ]] || rm -f -- "$cle_tmp"
  if [[ -n "$archive_tmp" ]]; then
    rm -f -- "$archive_tmp" "${archive_tmp}".tmp.*
  fi
  [[ -z "$tmp" ]] || rm -rf -- "$tmp"
  return "$code"
}
trap nettoyer EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

tmp="$(mktemp -d "${TMPDIR:-/tmp}/fann-backup.XXXXXXXX")"
chmod 700 "$tmp"

cle="${BACKUP_KEY_FILE:-$HOME/.fann-backup.key}"
[[ "$cle" == /* ]] || cle="$racine/$cle"
[[ ! -L "$cle" ]] || { echo 'La clé de sauvegarde ne doit pas être un lien symbolique.' >&2; exit 2; }
cle_parent="$(dirname -- "$cle")"
mkdir -p -- "$cle_parent"
if [[ ! -e "$cle" ]]; then
  cle_tmp="$(mktemp "${cle}.tmp.XXXXXXXX")"
  chmod 600 "$cle_tmp"
  openssl rand -base64 48 | tr -d '\n' > "$cle_tmp"
  if ! ln -- "$cle_tmp" "$cle"; then
    rm -f -- "$cle_tmp"
    cle_tmp=''
    [[ -f "$cle" && ! -L "$cle" ]] || { echo 'Impossible de créer la clé de sauvegarde.' >&2; exit 1; }
  else
    rm -f -- "$cle_tmp"
    cle_tmp=''
    echo "Clé de sauvegarde créée : $cle. Copiez-la hors du VPS dans un gestionnaire sécurisé." >&2
  fi
fi
[[ -f "$cle" && ! -L "$cle" && -r "$cle" && -s "$cle" ]] || { echo 'Clé de sauvegarde absente ou invalide.' >&2; exit 2; }
chmod 600 "$cle"
(( $(wc -c < "$cle") >= 32 )) || { echo 'La clé de sauvegarde est trop courte.' >&2; exit 2; }

source scripts/vps/backup-crypto.sh
mkdir -m 700 "$tmp/clair" "$tmp/contenu" "$tmp/extrait"
# Le dump est produit dans l'espace temporaire privé. Il est supprimé même si le chiffrement échoue.
bash scripts/sauvegarde-postgres.sh "$tmp/clair" 1 >/dev/null
shopt -s nullglob
dumps=("$tmp/clair"/fann-pointage-*.dump)
shopt -u nullglob
(( ${#dumps[@]} == 1 )) || { echo 'Le dump PostgreSQL attendu est absent ou ambigu.' >&2; exit 1; }
dump="${dumps[0]}"
[[ -f "$dump" && ! -L "$dump" && -s "$dump" ]] || { echo 'Dump PostgreSQL invalide.' >&2; exit 1; }

cp -- "$dump" "$tmp/contenu/base.dump"
cp -- .env "$tmp/contenu/env.sauvegarde"
chmod 600 "$tmp/contenu/base.dump" "$tmp/contenu/env.sauvegarde"
tar -C "$tmp/contenu" -cf "$tmp/archive.tar" base.dump env.sauvegarde
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$cle" \
  -in "$tmp/archive.tar" -out "$tmp/archive.enc"
chmod 600 "$tmp/archive.tar" "$tmp/archive.enc"

horodatage="$(date +%Y%m%d-%H%M%S)"
archive="sauvegardes/chiffrees/fann-${horodatage}.tar.enc"
archive_tmp="sauvegardes/chiffrees/.fann-${horodatage}.tar.enc.tmp"
[[ ! -e "$archive" && ! -L "$archive" && ! -e "$archive_tmp" && ! -L "$archive_tmp" ]] || {
  echo 'Une archive portant cet horodatage existe déjà : sauvegarde refusée.' >&2; exit 1;
}
fann_backup_wrap_ciphertext "$tmp/archive.enc" "$cle" "$archive_tmp"
# Vérification complète avant publication : HMAC, déchiffrement et identité exacte du tar.
fann_backup_extract_ciphertext "$archive_tmp" "$tmp/archive.verify.enc" "$cle"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$cle" \
  -in "$tmp/archive.verify.enc" -out "$tmp/archive.verify.tar"
cmp -s "$tmp/archive.tar" "$tmp/archive.verify.tar" || { echo 'Échec de vérification de l’archive chiffrée.' >&2; exit 1; }
liste="$(tar -tf "$tmp/archive.verify.tar")" || { echo 'Archive tar invalide.' >&2; exit 1; }
[[ "$liste" == $'base.dump\nenv.sauvegarde' ]] || { echo 'Contenu inattendu dans l’archive.' >&2; exit 1; }

# Publication sans écrasement : le lien est atomique et reste sur le même système de fichiers.
ln -- "$archive_tmp" "$archive"
rm -f -- "$archive_tmp"
archive_tmp=''
chmod 600 "$archive"
echo "Sauvegarde chiffrée et authentifiée créée : $archive ($(wc -c < "$archive") octets)"

# Rétention déterministe des archives régulières uniquement.
mapfile -t archives < <(find sauvegardes/chiffrees -maxdepth 1 -type f -name 'fann-*.tar.enc' -printf '%T@ %p\n' | sort -nr | cut -d ' ' -f 2-)
for ((i=garder; i<${#archives[@]}; i++)); do
  rm -f -- "${archives[i]}"
done

# Copie distante facultative : seul le fichier chiffré est transmis.
dest="$(grep -m1 '^BACKUP_RSYNC_DEST=' .env | cut -d= -f2- || true)"
if [[ -n "$dest" ]]; then
  if rsync -a --partial --delay-updates --partial-dir=.rsync-partial \
    -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' "$archive" "$dest/"; then
    echo "Copie chiffrée distante envoyée vers $dest"
  else
    echo "ATTENTION : l’envoi distant a échoué ; la copie locale vérifiée est conservée." >&2
  fi
fi
