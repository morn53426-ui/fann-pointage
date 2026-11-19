> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Rapport des correctifs de préproduction — FANN POINTAGE v20

**Révision source :** `0.2.0-preproduction.25`  
**Date :** 22 octobre 2026  
**Décision :** candidate de préproduction améliorée ; **pas encore homologuée pour la production**.

## 1. Correctifs livrés

### Messagerie avec destinataires

- Diffusion générale à tous les comptes actifs.
- Envoi à un ou plusieurs comptes non-administrateurs sélectionnés.
- Envoi à un ou plusieurs services actifs.
- Choix de priorité normale ou urgente.
- Consultation des messages filtrée côté serveur selon le compte et ses affectations de service actives.
- Contrôle administrateur pour l'annuaire de destinataires et la création de messages.
- Un agent qui n'est pas destinataire ne peut pas confirmer la lecture d'un message ciblé.
- Migration additive `0022_messagerie_destinataires`, droits du rôle runtime et vérification des prérequis dans `/readyz`.

### Confidentialité de l'export métier

L'export JSON est maintenant au format `fann-pointage-export-metier-v2`. Il retire les mots de passe, sessions/secrets d'authentification, secrets QR/badges, coordonnées GPS exactes, adresses, téléphones et photos. Il reste susceptible de contenir des informations nominatives, d'affectation ou de présence : accès limité à l'administrateur et stockage protégé sont toujours nécessaires. Cet export ne peut pas restaurer entièrement la base PostgreSQL.

### Contrôle de restauration

`scripts/restaurer-sauvegarde.sh` utilise désormais un mode test plus strict :

- vérifie l'archive via `pg_restore --list` ;
- restaure dans une base jetable dédiée ;
- utilise `--exit-on-error` et `--single-transaction` sans ignorer les erreurs du moteur de restauration ;
- vérifie la lecture des tables métier de référence et exige au moins un agent et un service ;
- supprime la base de test automatiquement à la sortie.

Le mode production exige la confirmation littérale `RESTAURER`, arrête l'application, restaure en mode fail-closed, réapplique les migrations puis redémarre l'application uniquement si les étapes réussissent.

### Livraison et documentation

- Version incrémentée à `0.2.0-preproduction.25`.
- Documentation de migration, sauvegarde, confidentialité, recette ciblée et limites de déploiement mise à jour.
- `compose.yaml` documente l'application des migrations jusqu'à `0022`.

## 2. Vérifications effectuées dans cet environnement

| Vérification | Résultat |
|---|---|
| `npm test` | **381 réussis, 0 échec** |
| `node --check web/app.js` | Réussi |
| `node --check scripts/migrate-catalogue.mjs` | Réussi |
| `bash -n scripts/restaurer-sauvegarde.sh` | Réussi |
| `node scripts/check-delivery.mjs` | Réussi, aucun chemin privé interdit ni motif de secret détecté |
| Tests unitaires ciblant messagerie/migrations | Inclus dans la suite de 381 tests ; la suite comprend notamment le contrôle d'accès au répertoire des destinataires et le refus de lecture pour un non-destinataire |

La suite s'exécute avec Node `22.16.0`, inférieur à la contrainte du projet (`>=22.18`). Les tests ne prouvent donc ni la construction de production ni l'intégration avec une instance réelle.

## 3. Risques qui restent ouverts

1. **PostgreSQL/Docker de production non testés ici.** Il faut exécuter les migrations `0021` et `0022` et vérifier `/readyz` sur une copie de recette.
2. **Sauvegarde distante et restauration réelle non démontrées.** Il faut restaurer un dump provenant de la vraie destination distante, conserver les compteurs et le journal de test, et répéter l'opération avant chaque migration de production.
3. **Contrôle TypeScript et audit npm non qualifiés.** `node_modules` est absent et `npm ci` n'a pas abouti dans cet environnement. Réexécuter `npm ci`, `npm run typecheck` et `npm audit --omit=dev` sous Node 22.18+ dans une CI connectée.
4. **RLS PostgreSQL par périmètre métier.** Certaines politiques de `fann_app` utilisent encore `USING (true)`/`WITH CHECK (true)` ; la séparation agent/service repose donc largement sur l'API. Ne pas exposer les identifiants DB au navigateur ; prévoir un durcissement SQL supplémentaire pour une défense en profondeur.
5. **Limiteur de connexions en mémoire.** Il se remet à zéro au redémarrage et n'est pas partagé entre instances. Conserver une seule instance de l'application et limiter l'accès réseau comme décrit dans `docs/PREPARATION_PRODUCTION.md`.
6. **Hors ligne mobile.** La file locale existante concerne le pointage sur poste partagé ; cela ne constitue pas une synchronisation hors connexion complète pour tous les écrans mobiles.
7. **Essais de terrain non exécutés.** iPhone/Android, caméra, GPS, HTTPS, imprimante, concurrence et validation métier des plannings nécessitent la recette de l'établissement.

## 4. Procédure recommandée de mise à jour sur une installation existante

1. Effectuer une sauvegarde PostgreSQL **chiffrée** et vérifier qu'une copie existe hors du serveur.
2. Archiver le `.env` de façon sûre ; conserver les volumes PostgreSQL et runtime actuels.
3. Installer Node `>=22.18` et les dépendances du lockfile, puis exécuter les tests/typecheck/audit dans l'environnement de CI.
4. Après validation sur une copie de recette, exécuter :

   ```bash
   docker compose build app migrate
   docker compose up -d
   docker compose ps -a
   docker compose logs --tail=100 migrate app
   npm run health
   ```

5. Vérifier `/readyz`, un compte admin, un responsable et deux agents : diffusion générale, message direct, message par service, refus d'accès pour un non-destinataire, marquage lu et retour après reconnexion.
6. Exécuter `bash scripts/restaurer-sauvegarde.sh sauvegardes/nom-de-votre-dump.dump test` avec un dump récupéré depuis le stockage distant.
7. Piloter un service sur une période déterminée avant toute extension.

**Ne jamais exécuter `docker compose down -v` pour forcer une migration : cela peut supprimer les données persistantes.**

## 5. Verdict

Les mises à jour de code demandées ont été intégrées et la suite de tests automatisés passe. La version `0.2.0-preproduction.25` est livrée comme **candidate de préproduction**. Elle ne doit pas être présentée comme prête pour une production hospitalière tant que la recette PostgreSQL/Docker, l'audit des dépendances et une restauration effective n'ont pas été validés et documentés.
