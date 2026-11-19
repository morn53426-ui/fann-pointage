#!/usr/bin/env bash
# Helpers for authenticated FANN backup archives (Encrypt-then-MAC, V2).
# The HMAC key is derived independently from the encryption key file.

fann_backup_hmac_hex() {
  local ciphertext="$1" key_file="$2" mac_key_hex
  mac_key_hex="$(
    {
      printf '%s' 'FANN-BACKUP-HMAC-V2:'
      cat -- "$key_file"
    } | openssl dgst -sha256 -binary | od -An -vtx1 | tr -d ' \n'
  )" || return 1
  [[ "$mac_key_hex" =~ ^[[:xdigit:]]{64}$ ]] || return 1
  openssl dgst -sha256 -mac HMAC -macopt "hexkey:${mac_key_hex}" -binary -- "$ciphertext" \
    | od -An -vtx1 | tr -d ' \n'
}

# Write: one ASCII header line, then the original ciphertext bytes.
fann_backup_wrap_ciphertext() {
  local ciphertext="$1" key_file="$2" output="$3" mac temporary
  [[ -f "$ciphertext" && ! -L "$ciphertext" && -s "$ciphertext" ]] || {
    echo 'Texte chiffré absent, vide ou invalide.' >&2; return 2;
  }
  [[ -f "$key_file" && ! -L "$key_file" && -r "$key_file" && -s "$key_file" ]] || {
    echo 'Clé HMAC absente ou invalide.' >&2; return 2;
  }
  [[ ! -e "$output" && ! -L "$output" ]] || {
    echo "Refus d'écraser le fichier de sortie : $output" >&2; return 2;
  }
  mac="$(fann_backup_hmac_hex "$ciphertext" "$key_file")" || {
    echo 'Impossible de calculer le HMAC.' >&2; return 1;
  }
  [[ "$mac" =~ ^[[:xdigit:]]{64}$ ]] || { echo 'HMAC calculé invalide.' >&2; return 1; }
  temporary="$(mktemp "${output}.tmp.XXXXXXXX")" || return 1
  chmod 600 "$temporary"
  if ! { printf 'FANN-ENC-V2 %s\n' "$mac"; cat -- "$ciphertext"; } > "$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  chmod 600 "$temporary"
  # A hard link publishes atomically and refuses to replace an existing archive.
  if ! ln -- "$temporary" "$output"; then
    rm -f -- "$temporary"
    echo "Publication impossible ou destination déjà existante : $output" >&2
    return 1
  fi
  rm -f -- "$temporary"
}

# Verify HMAC before exposing ciphertext to the decryptor. Legacy archives are
# accepted only with an explicit ALLOW_LEGACY_BACKUP=1 opt-in and a warning.
fann_backup_extract_ciphertext() {
  local archive="$1" output="$2" key_file="$3" header expected actual temporary
  [[ -f "$archive" && ! -L "$archive" && -s "$archive" ]] || {
    echo 'Archive absente, vide ou invalide.' >&2; return 2;
  }
  [[ -f "$key_file" && ! -L "$key_file" && -r "$key_file" && -s "$key_file" ]] || {
    echo 'Clé HMAC absente ou invalide.' >&2; return 2;
  }
  [[ ! -e "$output" && ! -L "$output" ]] || {
    echo "Refus d'écraser le fichier de sortie : $output" >&2; return 2;
  }
  temporary="$(mktemp "${output}.tmp.XXXXXXXX")" || return 1
  chmod 600 "$temporary"
  # Inspect a fixed-size prefix first: legacy ciphertext is binary and is not line-oriented.
  if [[ "$(head -c 12 -- "$archive")" == 'FANN-ENC-V2 ' ]]; then
    if ! IFS= read -r header < "$archive"; then
      rm -f -- "$temporary"
      echo 'En-tête d’archive V2 tronqué.' >&2
      return 1
    fi
  else
    header=''
  fi
  if [[ "$header" =~ ^FANN-ENC-V2\ ([[:xdigit:]]{64})$ ]]; then
    expected="${BASH_REMATCH[1],,}"
    if ! tail -n +2 -- "$archive" > "$temporary" || [[ ! -s "$temporary" ]]; then
      rm -f -- "$temporary"
      echo 'Charge chiffrée absente ou illisible.' >&2
      return 1
    fi
    actual="$(fann_backup_hmac_hex "$temporary" "$key_file")" || {
      rm -f -- "$temporary"; echo 'Impossible de vérifier le HMAC.' >&2; return 1;
    }
    actual="${actual,,}"
    if [[ "$actual" != "$expected" ]]; then
      rm -f -- "$temporary"
      echo 'HMAC incorrect : archive altérée ou mauvaise clé. Restauration refusée.' >&2
      return 1
    fi
  else
    if [[ "${ALLOW_LEGACY_BACKUP:-0}" != '1' ]]; then
      rm -f -- "$temporary"
      echo 'Archive historique non authentifiée refusée. Pour une récupération exceptionnelle, définissez ALLOW_LEGACY_BACKUP=1 après vérification de sa provenance.' >&2
      return 1
    fi
    echo 'ATTENTION : archive historique sans HMAC ; son intégrité ne peut pas être garantie.' >&2
    if ! cat -- "$archive" > "$temporary"; then
      rm -f -- "$temporary"; return 1
    fi
  fi
  chmod 600 "$temporary"
  if ! ln -- "$temporary" "$output"; then
    rm -f -- "$temporary"
    echo "Publication impossible ou destination déjà existante : $output" >&2
    return 1
  fi
  rm -f -- "$temporary"
}
