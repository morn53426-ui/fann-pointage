# Déploiement de FANN POINTAGE sur un VPS (Ubuntu 24.04, HTTPS public)

Ce kit s'ajoute au projet (v20) sans modifier son code : `compose.vps.yaml`, `deploy/Caddyfile.vps` et `scripts/vps/`.
Il met en place : durcissement du serveur, HTTPS Let's Encrypt automatique (Caddy), secrets aléatoires, démarrage, création du compte `admin`, sauvegardes chiffrées quotidiennes.

## Pré-requis

- Un VPS Ubuntu 24.04 neuf : 2 vCPU, 2 Go de RAM, 20 Go de disque minimum, accès root par **clé SSH**.
- Un **nom de domaine** (ou sous-domaine) dont l'enregistrement DNS **A** pointe vers l'IP du VPS. HTTPS est obligatoire : sans lui, le navigateur bloque la caméra (scan QR) et le GPS.
  - Sans domaine : un nom du type `1-2-3-4.sslip.io` (IP du VPS avec des tirets) fonctionne pour les essais.
- Une adresse e-mail pour les avis Let's Encrypt.

## Étape 1 — Envoyer les fichiers (depuis votre PC, Git Bash)

Dans le dossier du projet (ne pas envoyer `node_modules` ni votre `.env` local : le serveur génère le sien) :

```bash
# archive du projet sans node_modules ni .env
zip -r fann.zip . -x "node_modules/*" ".env" "sauvegardes/*"
scp fann.zip root@IP_DU_VPS:~/
```

Puis copiez le contenu de ce kit **à la racine du projet** (avant de zipper, ou ajoutez-le après) : `compose.vps.yaml`, `deploy/Caddyfile.vps`, `scripts/vps/*`.

## Étape 2 — Préparer le serveur (en root, une seule fois)

```bash
ssh root@IP_DU_VPS
apt-get update && apt-get install -y unzip
mkdir -p /root/fann && unzip -q fann.zip -d /root/fann
bash /root/fann/scripts/vps/01-securiser-serveur.sh
```

Le script : met à jour le système, crée l'utilisateur `fann` (connexion par clé uniquement, root et mots de passe SSH désactivés), active le pare-feu (SSH, 80, 443), fail2ban, les mises à jour de sécurité automatiques, 2 Go de swap, Docker.

**Avant de fermer la session root**, testez dans un autre terminal : `ssh fann@IP_DU_VPS`. Si la connexion échoue, corrigez-la depuis la session root encore ouverte.

## Étape 3 — Installer le projet (utilisateur `fann`)

```bash
ssh fann@IP_DU_VPS
mkdir -p ~/fann-pointage && cd ~/fann-pointage
sudo cp -r /root/fann/. . && sudo chown -R fann:fann .
bash scripts/vps/02-generer-env.sh fann.votre-domaine.sn vous@votre-domaine.sn
nano .env        # renseigner ZONE_LAT et ZONE_LNG (coordonnées GPS réelles du site)
```

`02-generer-env.sh` crée `.env` (droits 600) avec des secrets aléatoires distincts et ne l'écrase jamais. Le mot de passe administrateur est généré (24 caractères) ; vous pouvez imposer le vôtre :
`ADMIN_INITIAL_MOT_DE_PASSE='...' bash scripts/vps/02-generer-env.sh ...`

## Étape 4 — Démarrer

```bash
bash scripts/vps/03-demarrer.sh
```

Il construit les images, démarre les services, attend `/readyz`, crée le compte `admin` s'il est absent et vérifie le certificat HTTPS (comptez 3 à 6 minutes la première fois). Connexion : `https://fann.votre-domaine.sn`, compte `admin`, mot de passe = `ADMIN_INITIAL_MOT_DE_PASSE` dans `.env` (`grep ADMIN_INITIAL .env`).

## Étape 5 — Sauvegardes

```bash
bash scripts/vps/04-installer-sauvegarde.sh
```

- Chaque nuit à 02:15 : dump PostgreSQL **et** copie du `.env`, dans une archive chiffrée AES-256 (`sauvegardes/chiffrees/`, 14 conservées).
- La clé est dans `~/.fann-backup.key` : **copiez-la hors du serveur** (gestionnaire de mots de passe). Sans elle, les sauvegardes sont illisibles.
- Copie distante facultative : renseignez `BACKUP_RSYNC_DEST=utilisateur@serveur:/chemin` dans `.env` (clé SSH sans mot de passe pour `fann`). **Une sauvegarde qui reste sur le même serveur ne protège pas d'une perte du serveur.**
- Le `.env` est inclus car, sans `BADGE_SECRET` identique, les badges déjà imprimés ne seraient plus valides après une réinstallation.

### Restaurer

```bash
export COMPOSE_FILE="compose.yaml:compose.vps.yaml"
mkdir -p /tmp/restauration && chmod 700 /tmp/restauration
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:$HOME/.fann-backup.key \
  -in sauvegardes/chiffrees/fann-AAAAMMJJ-HHMMSS.tar.enc | tar -x -C /tmp/restauration
bash scripts/restaurer-sauvegarde.sh /tmp/restauration/base.dump test        # essai isolé
bash scripts/restaurer-sauvegarde.sh /tmp/restauration/base.dump production  # remplace la base
```

Le mode `test` exige au moins un agent et un service dans la sauvegarde. Faites un essai de restauration **dès la première semaine** : une sauvegarde jamais restaurée n'est pas une sauvegarde prouvée.

## Mise à jour vers une nouvelle version

```bash
cd ~/fann-pointage
bash scripts/vps/sauvegarde-chiffree.sh                     # sauvegarde avant toute mise à jour
# copier les nouveaux fichiers par-dessus (sans toucher à .env ni sauvegardes/), puis :
docker compose -f compose.yaml -f compose.vps.yaml build app migrate
docker compose -f compose.yaml -f compose.vps.yaml up -d    # les migrations s'appliquent automatiquement
```

## Commandes utiles

```bash
DC="docker compose -f compose.yaml -f compose.vps.yaml"
$DC ps -a                          # état des services
$DC logs --tail=100 app            # journaux applicatifs
$DC logs --tail=50 proxy           # certificat / HTTPS
curl -s http://127.0.0.1:8787/readyz
sudo ufw status ; sudo fail2ban-client status sshd
```

## Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| Certificat non délivré | DNS qui ne pointe pas vers le VPS, ou port 80/443 fermé chez l'hébergeur | Vérifier `dig +short votre-domaine` ; ouvrir 80/443 dans le pare-feu du fournisseur ; `$DC logs proxy` |
| `migrate` : ECONNREFUSED | Base pas encore prête (corrigé par le healthcheck TCP de `compose.vps.yaml`) | Relancer `$DC up -d` |
| 429 « Trop de tentatives » à plusieurs | `TRUST_PROXY` absent : tous partagent l'IP du proxy | Vérifier que `compose.vps.yaml` est bien utilisé (`TRUST_PROXY=1`) |
| Caméra / GPS refusés | Page ouverte en HTTP ou IP nue | Utiliser l'URL `https://` du domaine |

## Points de sécurité à connaître avant d'ouvrir au public

1. **Mot de passe administrateur** : sur Internet, le minimum imposé par l'application est de 9 caractères (9 chiffres acceptés, mais ≈ 30 bits seulement : c'est faible) ; la limitation des tentatives est en mémoire et par IP. Préférez le mot de passe généré, ou restreignez l'accès à l'interface d'administration (VPN, liste d'IP) si vous gardez 9 chiffres.
2. **Base de données** : jamais exposée (liée à 127.0.0.1, port 54329) ; ne l'ouvrez pas dans le pare-feu.
3. **Docker contourne UFW** pour les ports publiés : n'ajoutez donc aucune ligne `ports:` publique dans les compose sans y réfléchir. Seul Caddy (80/443) est exposé.
4. **Données personnelles** : le registre contient noms, photos, téléphones et adresses d'agents. Vérifiez avec l'hôpital les obligations de déclaration auprès de la CDP (Sénégal) et le lieu d'hébergement autorisé.
5. **Instance unique** : l'application doit tourner en un seul exemplaire (limiteur de connexions en mémoire).

## Ce qui n'a pas pu être testé ici

Les scripts ont été vérifiés (syntaxe, génération du `.env` conforme aux contrôles de l'application, contrôle de livraison du projet), mais **pas exécutés sur un vrai VPS** ni avec Docker/Caddy : le premier déploiement doit se faire sur un serveur de recette.
