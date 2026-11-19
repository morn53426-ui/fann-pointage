#!/usr/bin/env bash
# Planifie la sauvegarde chiffrée chaque nuit à 02:15 (heure de Dakar) via cron. À lancer en tant qu'utilisateur « fann ».
set -euo pipefail
cd "$(dirname "$0")/../.."
racine="$(pwd)"; utilisateur="$(id -un)"
[ "$(id -u)" -ne 0 ] || { echo "Lancez ce script avec l'utilisateur fann, pas en root." >&2; exit 1; }
mkdir -p "$racine/sauvegardes"
# Le fichier /etc/cron.d exige le nom de l'utilisateur dans la ligne.
echo "15 2 * * * $utilisateur cd $racine && /bin/bash scripts/vps/sauvegarde-chiffree.sh >> $racine/sauvegardes/sauvegarde.log 2>&1" | sudo tee /etc/cron.d/fann-sauvegarde >/dev/null
sudo chmod 644 /etc/cron.d/fann-sauvegarde
echo "Sauvegarde planifiée chaque nuit à 02:15. Premier essai immédiat :"
bash scripts/vps/sauvegarde-chiffree.sh
echo "Pensez à copier ~/.fann-backup.key HORS du serveur (gestionnaire de mots de passe)."
