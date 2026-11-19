#!/usr/bin/env bash
# Prépare un VPS Ubuntu 24.04 NEUF : mises à jour, utilisateur « fann », SSH par clé, pare-feu, fail2ban, Docker.
# À lancer UNE FOIS, en root :   bash 01-securiser-serveur.sh
# Variables facultatives : UTILISATEUR (défaut fann), PORT_SSH (défaut 22).
# Idempotent : peut être relancé sans dégât.
set -euo pipefail

UTILISATEUR="${UTILISATEUR:-fann}"
PORT_SSH="${PORT_SSH:-22}"

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root (sudo -i)." >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || { echo "Ce script cible Ubuntu (détecté : ${ID:-inconnu})." >&2; exit 1; }
case "$PORT_SSH" in ''|*[!0-9]*) echo "PORT_SSH doit être un nombre." >&2; exit 2;; esac

export DEBIAN_FRONTEND=noninteractive
echo "==> Mises à jour système"
apt-get update -y
apt-get upgrade -y
apt-get install -y ufw fail2ban unattended-upgrades ca-certificates curl gnupg openssl rsync cron dnsutils

echo "==> Fuseau horaire"
timedatectl set-timezone Africa/Dakar || true

echo "==> Mémoire d'appoint (le build Docker peut dépasser 1 Go)"
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Utilisateur $UTILISATEUR"
if ! id "$UTILISATEUR" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$UTILISATEUR"
fi
usermod -aG sudo "$UTILISATEUR"
# Connexion par clé uniquement : sudo sans mot de passe (le compte n'a pas de mot de passe).
echo "$UTILISATEUR ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$UTILISATEUR"
chmod 440 "/etc/sudoers.d/90-$UTILISATEUR"
install -d -m 700 -o "$UTILISATEUR" -g "$UTILISATEUR" "/home/$UTILISATEUR/.ssh"
cle="/home/$UTILISATEUR/.ssh/authorized_keys"
if [ ! -s "$cle" ] && [ -s /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "$cle"
fi
chown "$UTILISATEUR:$UTILISATEUR" "$cle" 2>/dev/null || true
chmod 600 "$cle" 2>/dev/null || true

echo "==> Durcissement SSH"
if [ -s "$cle" ]; then
  # Préfixe 00- : avec sshd, la PREMIÈRE valeur lue gagne ; 50-cloud-init.conf (fréquent chez les hébergeurs) ne doit pas l'emporter.
  cat > /etc/ssh/sshd_config.d/00-fann-durcissement.conf <<CONF
Port $PORT_SSH
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
LoginGraceTime 30
CONF
  sshd -t
  systemctl reload ssh
else
  echo "ATTENTION : aucune clé SSH trouvée pour $UTILISATEUR. Le durcissement SSH est IGNORÉ pour éviter de vous enfermer dehors." >&2
  echo "Ajoutez votre clé publique dans $cle puis relancez ce script." >&2
fi

echo "==> Pare-feu (UFW)"
ufw default deny incoming
ufw default allow outgoing
ufw limit "${PORT_SSH}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban"
cat > /etc/fail2ban/jail.d/fann-sshd.local <<CONF
[sshd]
enabled = true
port = $PORT_SSH
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Mises à jour de sécurité automatiques"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<CONF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo "==> Docker (dépôt officiel)"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<CONF
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
CONF
  systemctl restart docker
fi
systemctl enable --now docker
usermod -aG docker "$UTILISATEUR"

echo
echo "Terminé. NE FERMEZ PAS cette session avant d'avoir testé, dans un AUTRE terminal :"
echo "    ssh -p $PORT_SSH $UTILISATEUR@<IP-du-serveur>"
echo "Si la connexion fonctionne, continuez avec cet utilisateur (étape 2 du guide : docs/DEPLOIEMENT_VPS.md)."
