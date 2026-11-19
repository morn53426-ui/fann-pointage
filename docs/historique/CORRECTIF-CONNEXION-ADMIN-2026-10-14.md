> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Récupération du compte administrateur — 14 octobre 2026

## Quand l'administrateur existe mais ne peut pas se connecter

1. Ouvrir `.env` localement avec `notepad .env`.
2. Remplacer uniquement `ADMIN_INITIAL_MOT_DE_PASSE` par un secret neuf et unique d'au moins 32 caractères, URL-safe (lettres, chiffres, `_` et `-`), sans guillemets ni espace autour du `=`. Générer un candidat localement avec :

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Ne pas poster cette valeur dans un ticket ou une conversation.
3. Enregistrer `.env`, puis exécuter :

   ```bash
   npm run admin:postgres -- admin --reinitialiser-mot-de-passe
   ```

   La commande ne fonctionne que si `admin` existe, est actif et a le rôle administrateur. Elle actualise le hash et révoque les sessions antérieures ; le mot de passe n'est jamais écrit dans les journaux.
4. Se connecter dans l'interface avec l'identifiant `admin` et la nouvelle valeur de `ADMIN_INITIAL_MOT_DE_PASSE`. En cas de formulaire ancien en cache, recharger la page avec `Ctrl+F5`.

`--si-absent` ne change jamais le mot de passe d'un compte existant. Ne pas lancer la création simple sur un identifiant existant et ne pas supprimer le compte ou la base pour rétablir l'accès.

## Sécurité des secrets

Ne jamais partager la sortie complète de `docker compose config` : elle développe les variables et imprime les secrets en clair. Si cette sortie a été partagée, considérez ses secrets comme exposés et planifiez leur rotation contrôlée. Ne changez pas seulement `POSTGRES_PASSWORD` ou `POSTGRES_APP_PASSWORD` dans `.env` : les mots de passe des rôles PostgreSQL doivent être synchronisés dans la base. Sauvegardez la base avant toute rotation.

## Banc PostgreSQL isolé

`npm run test:postgres` utilise un conteneur et un volume de test jetables. Le script vérifie maintenant l'existence de `fann_pointage_test` (le seul healthcheck `pg_isready` ne garantit pas que cette base nommée existe) et, si nécessaire, crée puis initialise cette base uniquement dans l'environnement jetable. Le nettoyage vise uniquement le projet Compose unique de test, pas le volume de l'application.
