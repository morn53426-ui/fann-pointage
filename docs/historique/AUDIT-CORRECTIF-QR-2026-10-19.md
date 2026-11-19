> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# FANN POINTAGE v15 — correctif QR et analyse des anomalies

Date : 19 octobre 2026

## Correctif appliqué

Le dépôt `src/pointage/postgres.ts` utilisait `SELECT ... FOR SHARE` pour retrouver le QR dynamique juste avant l'insertion du pointage. Or, le rôle d'exécution `fann_app` est volontairement limité à `SELECT` et `INSERT` sur `qr_tokens`. PostgreSQL exige également un privilège `UPDATE` pour exécuter une lecture avec verrou `FOR SHARE` ; c'est la cause de l'erreur `permission denied for table qr_tokens` vue dans les journaux.

Le verrou a été retiré de cette lecture, sans élargir les droits SQL du rôle applicatif. La validation finale du QR, son verrouillage et sa consommation restent assurés par le trigger PostgreSQL `consommer_qr_au_pointage`, déclaré `SECURITY DEFINER`, dans la transaction du pointage.

Un test de non-régression vérifie désormais que la requête applicative du QR ne réintroduit pas `FOR SHARE`/`FOR UPDATE` tout en conservant les contraintes de zone et d'expiration.

## Résultats vérifiés dans l'environnement d'audit

- Suite unitaire complète : **343 réussis, 0 échec**.
- Tests sécurité : **98 réussis, 0 échec**.
- E2E processus HTTP de démonstration : **17 contrôles réussis**.
- Tests ciblés du dépôt PostgreSQL : **6 réussis, 0 échec** (avec faux dépôt SQL).

Limites : le test d'intégration PostgreSQL réel (`npm run test:postgres`) n'a pas été exécuté ici car Docker n'est pas disponible dans cet environnement. Le `typecheck` n'a pas pu être relancé ici car l'installation locale des dépendances de développement ne s'est pas terminée ; la modification apportée est dans une chaîne SQL et les assertions de tests. Le typecheck qui apparaît dans les journaux utilisateur a réussi avant ce correctif.

## Autres blocages visibles dans les journaux

### Registre des agents non importé

Les journaux montrent `0/54` fiche(s) du registre initial. Les commandes `--preview-registre` et `--apply-registre` ont échoué car `REGISTRE_INITIAL_SQL` n'est pas défini. C'est le garde-fou d'import attendu : il évite d'inventer, d'effacer ou de remplacer des données nominatives. En l'état, le pointage réel ne fonctionnera pas pour un compte agent qui n'a pas de fiche active correspondante dans PostgreSQL.

Pour importer la liste autorisée, il faut disposer du fichier SQL initial approuvé, le conserver hors du dépôt, puis définir `REGISTRE_INITIAL_SQL` dans le terminal Git Bash avant de lancer l'aperçu. N'appliquer l'import qu'après avoir vérifié l'aperçu et les 54 fiches attendues. Ne pas supprimer les volumes Docker pour tenter de résoudre ce problème : cela pourrait effacer les données persistantes.

### Choisir le bon QR

- Pour la page **Pointage**, utiliser le QR dynamique généré depuis l'écran QR du service. Il expire au bout de **60 secondes** : régénérer le QR s'il a expiré.
- Le QR individuel imprimé au verso du badge n'est pas le QR dynamique de pointage. Le projet indique qu'il doit être scanné dans **Poste partagé**.
- Conserver `BADGE_SECRET` stable entre les redémarrages. Un QR signé avec un ancien secret ne peut plus être validé après un changement de secret.

## Prochain test recommandé sur l'installation locale

Après avoir intégré ce correctif au projet local, reconstruire et redémarrer le service `app`, générer un nouveau QR dynamique puis le scanner immédiatement. Examiner ensuite les journaux de l'application et de PostgreSQL. Pour vérifier le parcours PostgreSQL réel, lancer aussi `npm run test:postgres` depuis le poste avec Docker Desktop démarré ; les tests unitaires et l'E2E de démonstration ne remplacent pas ce test d'intégration.
