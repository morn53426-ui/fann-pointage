#!/usr/bin/env bash
# Publie uniquement l'archive déjà chiffrée. Un échec distant doit remonter à cron/CI.
fann_backup_copy_remote() {
  local archive="\${1:?Archive locale requise.}"
  local destination="\${2:-}"
  local status

  [[ -n "$destination" ]] || return 0
  [[ -f "$archive" && ! -L "$archive" && -s "$archive" ]] || {
    echo "Archive locale absente, vide ou invalide : $archive" >&2
    return 2
  }

  if rsync -a --partial --delay-updates --partial-dir=.rsync-partial \
    -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' "$archive" "$destination/"; then
    echo "Copie chiffrée distante envoyée vers $destination"
  else
    status=$?
    echo "ERREUR : l'envoi distant vers $destination a échoué (rsync=$status). La copie locale vérifiée est conservée : $archive" >&2
    return "$status"
  fi
}
