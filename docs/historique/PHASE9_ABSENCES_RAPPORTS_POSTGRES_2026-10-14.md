> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Phase 9 — Absences et rapports sur PostgreSQL

> Rapport historique de la révision 0.2.0-preproduction.16 (octobre 2026). Les chiffres et versions décrivent cette exécution passée ; consulter README.md et AUDIT_FINAL_FANN_POINTAGE.md pour l’état de l’archive corrigée.

**Version :** `0.2.0-preproduction.16`  
**Date :** 14 octobre 2026  
**Statut :** code raccordé et tests unitaires réussis ; intégration avec un serveur PostgreSQL réel à valider.

## Changements

- Les routes `GET/POST /api/absences` et `PATCH /api/absences/:id` sont prises en charge par `OperationsPostgres`, avant tout routeur de démonstration.
- Une absence est liée à l'agent et au service de son affectation au début de la période. Les périodes sont enregistrées en heure `Africa/Dakar`, avec dates de début/fin inclusives.
- Toute nouvelle absence reste `a_confirmer` et `impact_score=false`. Une décision `justifiee`, `injustifiee` ou `refusee` exige un motif d'au moins quatre caractères, un auteur, une date de décision et une ligne d'audit dans la même transaction. Une absence déjà décidée ne peut pas être réécrite via la route.
- La lecture du registre et l'export CSV sont limités à l'administrateur et aux responsables de services autorisés. Les notes sont limitées à 500 caractères et les CSV réutilisent le sérialiseur protégé contre l'injection de formules.
- `/api/rapports` fonctionne pour les périodes jour/semaine/mois et permet `json`, `csv` et `synthese-csv`. Les lignes proviennent des plannings et pointages PostgreSQL. Les responsables sont limités aux plannings de leurs services ; les brancardiers ne peuvent voir que leurs propres lignes. Les coordonnées exactes ne sont jamais exposées aux brancardiers et restent exportables uniquement par l'administrateur.
- La migration additive `0015_absences_rapports_postgres.sql` ajoute les colonnes de service historique, auteur, note et décision et les index nécessaires. Les permissions runtime `fann_app` permettent la lecture/insertion/mise à jour du registre, sans accorder `DELETE`, DDL ou privilèges superutilisateur.
- Le démarrage et `/readyz` exigent désormais le marqueur de migration 0015 et testent les nouvelles colonnes.

## Contrôles

- Suite complète : **277 tests réussis, 0 échec**.
- Tests de permissions, portée de service, création et décision motivée des absences : couverts par des tests unitaires avec client PostgreSQL simulé.
- Rapports : tests de limitation à l'agent brancardier, occultation des coordonnées et export CSV.
- Contrôle TypeScript exécuté avec un adaptateur temporaire de dépendance `pg` car l'installation npm dans l'environnement d'audit n'a pas abouti. Ce contrôle ne remplace pas `npm ci` / `npm run typecheck` sur Node.js 22.18+ avec les dépendances du lockfile.
- Aucun Docker ni serveur PostgreSQL réel n'était disponible dans l'environnement d'audit ; la migration et les requêtes SQL ne sont donc **pas certifiées par exécution PostgreSQL**.

## Mise à jour locale sans perdre les données

Sur la machine de recette, sauvegarder `.env` et la base avant de commencer. Ne jamais exécuter `docker compose down -v` sur le volume utile.

```bash
npm install
npm run setup:upgrade-runtime-role
docker compose config --quiet
docker compose up --build -d db
npm run migrate:catalogue
npm run db:configure-app-role
docker compose up --build -d app
docker compose ps -a
docker compose logs --tail=100 app
curl -i http://127.0.0.1:8787/readyz
npm test
npm run test:postgres
```

Le test `npm run test:postgres` utilise une base et un volume jetables distincts. Vérifier d'abord son fichier Compose avant exécution ; il est conçu pour supprimer uniquement son propre projet de test.

## Recette manuelle obligatoire

1. Connecter un administrateur et un responsable de service de test.
2. Créer une absence ; contrôler qu'elle est `a_confirmer` et ne modifie pas le classement.
3. La décider avec un motif ; vérifier l'auteur, la date et le journal d'audit. Tenter une deuxième décision et vérifier le refus.
4. Tester l'isolation des services pour les responsables et l'absence d'accès pour les brancardiers.
5. Exporter le registre en CSV et contrôler le caractère lisible et l'absence de note ou d'information hors périmètre.
6. Générer rapport quotidien, hebdomadaire et mensuel, puis exporter les deux formats CSV. Comparer plusieurs lignes connues aux pointages source de PostgreSQL.
7. Redémarrer les conteneurs et vérifier la persistance des absences et que `/readyz` reste `200`.

Cette livraison est une progression vers la recette, pas une autorisation d'utiliser le logiciel comme registre officiel avant validation par le CHNU Fann.
