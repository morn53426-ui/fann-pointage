#!/usr/bin/env bash
# Vérifie le HMAC avant déchiffrement puis délègue à la restauration PostgreSQL.
# Usage : bash scripts/vps/restaurer-sauvegarde-chiffree.sh <archive.tar.enc> [test|production]
# Mode test par défaut. ALLOW_LEGACY_BACKUP=1 autorise exceptionnellement une archive R3 sans HMAC.
set -Eeuo pipefail
umask 077

archive_arg="${1:?Indiquez le chemin de l’archive chiffrée}"
mode="${2:-test}"
case "$mode" in test|production) ;; *) echo "Mode inconnu : $mode (test ou production)." >&2; exit 2 ;; esac
[[ "$archive_arg" == /* ]] || archive_arg="$(pwd)/$archive_arg"
cle="${BACKUP_KEY_FILE:-$HOME/.fann-backup.key}"
[[ "$cle" == /* ]] || cle="$(pwd)/$cle"

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$racine"
export COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml:compose.vps.yaml}"
[[ -f "$archive_arg" && ! -L "$archive_arg" && -s "$archive_arg" ]] || { echo 'Archive absente, vide ou symbolique.' >&2; exit 2; }
[[ -f "$cle" && ! -L "$cle" && -r "$cle" && -s "$cle" ]] || { echo 'Clé de sauvegarde absente, illisible ou invalide.' >&2; exit 2; }
chmod 600 "$cle"
command -v openssl >/dev/null || { echo 'OpenSSL est requis.' >&2; exit 1; }

source scripts/vps/backup-crypto.sh
tmp="$(mktemp -d "${TMPDIR:-/tmp}/fann-restore.XXXXXXXX")"
chmod 700 "$tmp"
nettoyer() { local code=$?; rm -rf -- "$tmp"; return "$code"; }
trap nettoyer EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fann_backup_extract_ciphertext "$archive_arg" "$tmp/archive.enc" "$cle"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$cle" \
  -in "$tmp/archive.enc" -out "$tmp/archive.tar"

liste="$(tar -tf "$tmp/archive.tar")" || { echo 'Archive tar invalide.' >&2; exit 1; }
[[ "$liste" == $'base.dump\nenv.sauvegarde' ]] || { echo 'Contenu de l’archive inattendu : restauration refusée.' >&2; exit 1; }
# Refuse les liens symboliques, liens physiques, périphériques et autres types avant extraction.
liste_verbose="$(tar -tvf "$tmp/archive.tar")" || { echo 'Impossible de contrôler les types de fichiers du tar.' >&2; exit 1; }
while IFS= read -r ligne; do
  [[ "${ligne:0:1}" == '-' ]] || { echo 'Type de fichier non régulier dans l’archive : restauration refusée.' >&2; exit 1; }
done <<< "$liste_verbose"
mkdir -m 700 "$tmp/extrait"
tar --no-same-owner --no-same-permissions -xf "$tmp/archive.tar" -C "$tmp/extrait"
for fichier in base.dump env.sauvegarde; do
  [[ -f "$tmp/extrait/$fichier" && ! -L "$tmp/extrait/$fichier" && -s "$tmp/extrait/$fichier" ]] || {
    echo "Fichier $fichier absent, vide ou non régulier après extraction." >&2; exit 1;
  }
done
chmod 600 "$tmp/extrait/base.dump" "$tmp/extrait/env.sauvegarde"

if [[ -n "${BACKUP_ENV_OUTPUT:-}" ]]; then
  [[ ! -e "$BACKUP_ENV_OUTPUT" && ! -L "$BACKUP_ENV_OUTPUT" ]] || {
    echo 'BACKUP_ENV_OUTPUT existe déjà : refus de l’écraser.' >&2; exit 2;
  }
  install -m 600 -- "$tmp/extrait/env.sauvegarde" "$BACKUP_ENV_OUTPUT"
  echo "Configuration extraite dans $BACKUP_ENV_OUTPUT (contient des secrets ; conservez ce fichier hors du dépôt)."
fi

bash scripts/restaurer-sauvegarde.sh "$tmp/extrait/base.dump" "$mode"
