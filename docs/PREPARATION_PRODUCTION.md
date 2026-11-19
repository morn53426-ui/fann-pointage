# Préparation à la production — FANN POINTAGE

Mise à jour : 19 novembre 2026  
Version source : `0.2.0-preproduction.47`  
Révision de référence contrôlée : `bea74bb6d3bb1770e2c7a8bc5b35f0f85ed8e310` sur `fix/p0-backup-restore-security`.

**Statut : préproduction.** Les contrôles automatisés GitHub Actions sont verts sur cette révision. La sortie de préproduction exige encore une répétition de restauration/migration sur un clone isolé, les tests matériels sur site et la validation métier par le CHNU Fann. La PR #1 reste en brouillon ; aucune mise à jour de `main` ni aucun déploiement VPS n'est déclaré.

## 1. Contrôles automatisés réussis

La CI GitHub de la révision ci-dessus a terminé avec succès les étapes suivantes :

| Contrôle | Résultat |
|---|---|
| Installation des dépendances | Réussi |
| Audit des dépendances de production | Réussi |
| Contrôle de livraison / absence de fichiers privés et secrets livrables | Réussi |
| TypeScript | Réussi |
| Tests Node | Réussi |
| Tests de chiffrement et d'intégrité des sauvegardes | Réussi |
| Vérification des scripts navigateur | Réussi |
| Tests d'intégration sur PostgreSQL jetable (migrations, QR, concurrence) | Réussi |
| Tests E2E Playwright sur Chromium | Réussi |

Exécution de référence sur la révision `bea74bb6` : [GitHub Actions — succès](https://github.com/morn53426-ui/fann-pointage/actions/runs/44608646615).

Ces résultats ne sont pas une preuve de fonctionnement sur le VPS réel. Ils n'attestent pas non plus le fonctionnement de la caméra, du GPS, du HTTPS avec le DNS définitif ou de l'impression sur les appareils du site.

## 2. État du schéma PostgreSQL

Le script `scripts/migrate-catalogue.mjs` applique de façon idempotente les migrations catalogue `0013` à `0027`, en vérifiant l'ENUM Mobil `0017` séparément entre `0016` et `0018`.

La dernière migration présente est `0027_indexes_performance_operational`. Le service Compose `migrate` lance le script de migration et configure les droits du rôle runtime `fann_app` avant que le service `app` ne démarre.

Pour une base existante :
- les scripts d'initialisation de l'image PostgreSQL ne sont pas rejoués sur le volume existant ;
- le service `migrate` applique les versions manquantes et les droits runtime ;
- ne jamais supprimer le volume PostgreSQL pour « relancer » les migrations ;
- le test doit être effectué sur un clone, jamais sur la base active.

Le point d'entrée de santé `/readyz` vérifie PostgreSQL et les marqueurs de migrations opérationnelles requis, jusqu'à `0027`, ainsi que la présence du régime Mobil dans l'ENUM.

## 3. Recette sur un clone — procédure obligatoire

### 3.1 Isoler l'environnement

Utilisez de préférence un VPS de recette ou un daemon Docker distinct, avec ses propres volumes PostgreSQL/runtime et son propre fichier `.env`.

**Attention : l'isolation par nom de projet Compose ne suffit pas dans cette configuration.** Le fichier `compose.yaml` déclare un nom de projet par défaut (`fann-pointage`) et fixe explicitement les noms des volumes `fann-pointage-postgres-data` et `fann-pointage-runtime-data`. Même avec `COMPOSE_PROJECT_NAME` ou `docker compose -p`, ces deux volumes explicitement nommés peuvent être réutilisés. Ne lancez donc pas un clone sur le même daemon Docker tant que vous n'avez pas remplacé ces noms et isolé les ports.

Pour un même daemon Docker, préparez un fichier local non versionné `compose.recette.yaml` contenant au minimum :
```yaml
name: fann-pointage-recette
volumes:
  fann_pgdata:
    name: fann-pointage-recette-postgres-data
  fann_runtime_data:
    name: fann-pointage-recette-runtime-data
```
Dans le `.env` propre à la recette, définissez aussi des ports libres distincts (par exemple `APP_BIND_ADDRESS=127.0.0.1`, `APP_PORT=18787`, `POSTGRES_PORT=54339`) et ne démarrez pas la surcouche VPS qui publie les ports 80/443 déjà utilisés. Lancez ensuite Compose avec `COMPOSE_FILE=compose.yaml:compose.recette.yaml`. Avant toute restauration, vérifiez localement le résultat de `docker compose config` et la liste des volumes : ils doivent tous porter les noms de recette ; ne partagez pas la sortie de configuration, qui peut contenir des secrets.

Vérifiez également avant de poursuivre :
- le nom du projet Compose, les ports publiés et les volumes sont distincts de la production ;
- le DNS ou le domaine de recette ne pointe pas vers le serveur public de production ;
- aucune commande Docker de recette ne cible le daemon/hôte de production ;
- la clé de sauvegarde est transférée séparément, via un canal sécurisé, et n'est pas stockée avec l'archive.

Ne réalisez pas cette étape sur le VPS de production en changeant simplement le nom de l'environnement dans le terminal.

### 3.2 Vérifier l'archive chiffrée et la restauration isolée

Sur l'environnement de recette uniquement :

```bash
export COMPOSE_FILE="compose.yaml:compose.vps.yaml"

# L'archive doit être copiée dans un emplacement privé de la recette.
# La clé est par défaut ~/.fann-backup.key ; sinon définir BACKUP_KEY_FILE.
bash scripts/vps/restaurer-sauvegarde-chiffree.sh /chemin-prive/fann-AAAAMMJJ-HHMMSS.tar.enc test
```

Le mode `test` :
- vérifie le HMAC de l'archive V2 avant de transmettre le ciphertext au déchiffreur ;
- déchiffre puis vérifie la structure et les types des fichiers de l'archive ;
- restaure le dump dans une base temporaire dédiée ;
- contrôle que les principales tables sont lisibles et que des agents/services sont présents ;
- supprime automatiquement la base temporaire.

Ce test prouve que l'archive peut être déchiffrée et restaurée dans un contexte isolé. Il ne met pas à niveau une copie persistante.

### 3.3 Répéter une mise à niveau sur la copie persistante

Pour tester la compatibilité d'une sauvegarde antérieure avec la version courante, restaurez-la dans la base du clone isolé. Le mode `production` du script est ici utilisé **uniquement à l'intérieur du clone de recette** : il remplace la base configurée dans le fichier `.env` de cette recette, arrête l'application de recette, restaure, lance `migrate`, puis redémarre l'application de recette. Il demande de taper `RESTAURER`.

```bash
# À exécuter uniquement depuis le répertoire du clone de recette.
export COMPOSE_FILE="compose.yaml:compose.vps.yaml"
bash scripts/vps/restaurer-sauvegarde-chiffree.sh /chemin-prive/fann-AAAAMMJJ-HHMMSS.tar.enc production
```

N'exécutez jamais cette commande sur la base de production pour une répétition. Le mode `production` remplace la base sélectionnée par Compose.

L'archive contient aussi `env.sauvegarde`. Pour l'extraire à part (jamais directement dans le dépôt), utilisez une destination privée qui n'existe pas encore :

```bash
BACKUP_ENV_OUTPUT=/chemin-prive/recuperation/.env.sauvegarde \
  bash scripts/vps/restaurer-sauvegarde-chiffree.sh /chemin-prive/fann-AAAAMMJJ-HHMMSS.tar.enc test
```

Ce fichier contient des secrets. Ne l'affichez pas dans les journaux et ne remplacez pas aveuglément le `.env` du clone : gardez les paramètres d'isolation (identifiants PostgreSQL, ports, domaine) propres à la recette. Pour tester la validité de badges déjà imprimés, la valeur `BADGE_SECRET` historique doit être reportée de manière sécurisée dans le `.env` du clone ; les autres paramètres d'infrastructure doivent rester ceux du clone.

Après la restauration persistante :
1. vérifier `docker compose ps -a`, les journaux de `migrate` et `app` et la réponse HTTP de `/readyz` ;
2. consulter les versions dans `app_schema_migrations` et confirmer que `0027_indexes_performance_operational` est présente ;
3. relancer une seconde fois le service `migrate` ou `npm run db:upgrade` sur la base de recette et confirmer qu'aucune migration manquante n'est appliquée ;
4. contrôler les rôles SQL : `fann_app` ne doit pas pouvoir exécuter DDL ni supprimer le journal d'audit ;
5. faire les scénarios fonctionnels décrits ci-dessous.

## 4. Tests fonctionnels sur la recette

Sur le clone seulement, avec un compte administrateur de recette :
- création/modification/archivage de services et d'agents ;
- émission, renouvellement et révocation des badges ;
- pointage QR et poste partagé, double pointage, badge invalide et idempotence ;
- règles Mobil, plages horaires, jours fériés et repos minimal ;
- rôles administrateur/responsable/agent et contrôle du périmètre de service ;
- anomalies, absences, rapports, exports et messagerie ciblée ;
- reprise après redémarrage et persistance des données.

Le script `npm run recette:api` peut compléter la recette, mais il crée des enregistrements de test et attend plus de deux minutes pour les scénarios de pointage : ne l'exécutez jamais sur la base de production.

## 5. Contrôles sur site avant ouverture

- [ ] Caméra et lecture QR sur les téléphones réellement utilisés.
- [ ] Géolocalisation HTTPS avec coordonnées et rayon validés sur le site.
- [ ] Connexion HTTPS/Caddy avec le DNS définitif et renouvellement du certificat.
- [ ] Impression réelle des badges CR80, des recto-verso et des feuilles d'émargement.
- [ ] Pointage hors ligne et resynchronisation sur le réseau réel.
- [ ] Validation des horaires, régimes, jours fériés, repos et zones par l'administration du CHNU Fann.
- [ ] Politique d'accès, conservation des données nominatives/photos/téléphones et responsabilités validées par l'établissement.
- [ ] Supervision, alerte d'échec des sauvegardes, copie distante et accès à la clé de déchiffrement documentés.
- [ ] Pilote d'un seul service sur une durée convenue, avec suivi et décision formelle avant ouverture générale.

## 6. Sauvegarde et restauration

Sur VPS Linux, utilisez les scripts dédiés :
- `bash scripts/vps/sauvegarde-chiffree.sh` pour créer le dump et l'archive V2 chiffrée/authentifiée ;
- `bash scripts/vps/restaurer-sauvegarde-chiffree.sh <archive.tar.enc> test` pour vérifier/restaurer dans une base temporaire ;
- `bash scripts/vps/restaurer-sauvegarde-chiffree.sh <archive.tar.enc> production` uniquement pour un rétablissement réel après validation et avec confirmation explicite.

Ne déchiffrez pas ces archives V2 avec une simple commande `openssl enc` : l'en-tête HMAC doit être vérifié par `scripts/vps/backup-crypto.sh` avant le déchiffrement. La clé `~/.fann-backup.key` doit être copiée hors du VPS et conservée séparément des archives.

Les archives historiques sans HMAC sont refusées par défaut. `ALLOW_LEGACY_BACKUP=1` est une dérogation de récupération exceptionnelle ; l'intégrité d'une archive non authentifiée ne peut pas être garantie.

Pour les sauvegardes Windows/PowerShell, suivez séparément `docs/SAUVEGARDE_SERVEUR.md`. Cette procédure n'est pas la même que le format V2 Linux/VPS ; son exécution réelle sur Windows doit être consignée avant validation de cette voie.

## 7. Limites opérationnelles restantes

- Le limiteur de tentatives est en mémoire : ne lancez qu'une seule instance `app` tant qu'un mécanisme partagé n'est pas mis en place.
- Ne publiez pas directement le port applicatif ; gardez l'accès public derrière Caddy/HTTPS.
- Les secrets de base, `SESSION_SECRET` et `BADGE_SECRET` doivent rester séparés, forts et hors du dépôt.
- Le statut CI vert ne remplace jamais la recette restaurée sur une copie représentative et la validation des appareils réels.
