> **HISTORIQUE — NE PAS UTILISER POUR INSTALLER OU EXPLOITER LA VERSION COURANTE.** Ce document décrit l’état du projet à la date où il a été écrit et peut contredire le code actuel. Référence : `docs/ETAT_ACTUEL.md` et `DEMARRER-ICI-WINDOWS.md`.

# Correctifs v18.1 — badges et règles de planning

Date : 20 octobre 2026

## 1. Défaut d'impression recto-verso corrigé

Le verso inverse les deux colonnes de chaque rangée pour correspondre à un retournement A4 portrait sur le bord long. Lorsqu'une rangée avait un nombre impair de badges, le dernier badge était imprimé dans la première colonne du verso au lieu de la deuxième. Le défaut pouvait provoquer un mauvais alignement recto-verso après découpe.

Correctif :
- extraction du calcul de disposition dans `web/badge-print-layout.js` ;
- placement explicite d'un créneau vide avant le badge isolé au verso ;
- découpage des lots par feuilles de 8 emplacements (2 × 4), sans altérer l'ordre du recto ;
- tests pour 1, 3, 9, 10 et 11 badges ;
- test Playwright ajouté pour vérifier l'emplacement vide et l'alignement horizontal du verso d'un badge seul.

Le format du badge (86 × 54 mm), les faces recto/verso, le QR et les fonctions existantes de sélection, d'aperçu et d'impression sont conservés.

## 2. Tests de règles de planning côté métier et API

- ajout d'un test unitaire confirmant que le cycle de garde accepte le prochain poste après exactement 48 h de repos ;
- ajout d'un test d'intégration API confirmant qu'une génération en doublon est refusée et ne crée pas un deuxième poste ;
- ajout d'un test d'intégration API confirmant qu'une garde débutant avant la fin des 48 h de repos est refusée côté serveur et n'est pas enregistrée.

Les règles restent appliquées par le backend ; aucune nouvelle validation limitée à l'interface n'a été ajoutée.

## 3. Vérifications exécutées

- `npm test` : 362 tests réussis, 0 échec.
- Tests ciblés badges/planning : 25 tests réussis, 0 échec.
- `node --check web/badge-print-layout.js` : réussi.
- `node --check web/app.js` : réussi.
- `node --check e2e/badges.spec.mjs` : réussi.
- Analyse TypeScript locale : aucun diagnostic dans les fichiers TypeScript modifiés. La vérification a nécessité des définitions temporaires pour PostgreSQL, car les dépendances officielles ne pouvaient pas être installées.

## 4. Limites restantes avant impression en série

- `npm ci` n'a pas pu terminer : le registre npm a renvoyé `EAI_AGAIN` (DNS/réseau inaccessible dans l'environnement de vérification).
- Par conséquent, la suite Playwright complète n'a pas été exécutée avec `@playwright/test`. Un test navigateur a été ajouté pour la correction ; le navigateur disponible dans cet environnement a bloqué l'accès au serveur local (`ERR_BLOCKED_BY_ADMINISTRATOR`).
- Aucun build applicatif n'est défini dans `package.json` ; la configuration `Dockerfile` n'a pas été construite ici.
- Une feuille de test doit encore être imprimée physiquement en recto-verso, en A4 à 100 %, retournement sur le bord long, puis découpée pour confirmer le calage réel de l'imprimante.

## 5. Vérification conseillée avant distribution

1. Installer les dépendances avec Node.js 22.18 ou plus récent.
2. Exécuter `npm run check` et `npm run test:e2e`.
3. Imprimer 1, 3, 9, 10 et 11 badges en recto-verso, sur le bord long, à l'échelle 100 %.
4. Découper une carte et vérifier le calage ainsi que le scan réel du QR sur le poste de pointage.

## Correctif v18.2 (2026-10-21) — impression badge sur téléphone
- `web/styles.css` : suppression du calque `.badge-recto-entete::before` (dégradé transparent/rgba) qui s'imprimait en bandes noires et blanches dans le PDF des navigateurs mobiles et masquait le texte blanc de l'entête.

## Correctif v18.3 (2026-10-21) — règles de pointage demandées par l'administration
- **Retard toléré : 20 min.** `TOLERANCE_RETARD_MIN = 20` (`src/shared/presence.ts`, repris par le suivi). Un retard de 20 min n'est pas compté ; à partir de 21 min il l'est, en minutes entières depuis le début du poste. Tolérance de départ anticipé inchangée (0).
- **Pointage accepté 1 h avant le début.** `AVANT_POSTE_MIN = 60` (auparavant 120). Un pointage plus tôt n'est rattaché à aucun poste : il passe « à vérifier » et l'administrateur ou le responsable le valide manuellement avec un motif (fonction existante).
- **Services qui terminent avant 16 h.** Au moment de générer un planning du service général, l'heure de fin se règle de 10 h à 16 h (champ « Heure de fin du service général » dans le formulaire ; paramètre `heureFin` de `POST /api/plannings`, contrôlé côté serveur, en mode démo comme en PostgreSQL). Le brancardier pointe alors son départ avant cette heure. La modification d'un poste général accepte aussi une fin entre 10 h et 16 h.
- Tests : 380 réussis (6 jeux de données ajustés car ils supposaient un retard de 12 ou 20 min compté ; 3 tests ajoutés).
- Non fait : une heure de fin par service enregistrée une fois pour toutes (elle se choisit à chaque génération) et la tolérance de départ anticipé.

## Correctif v18.4 (2026-10-21) — « GET /api/emargement 404 » en mode PostgreSQL
- **Cause** : la route `/api/emargement` était autorisée en mode PostgreSQL mais jamais implémentée côté base. La requête retombait sur le gestionnaire de démonstration, dont le magasin est vide : l'aperçu renvoyait des feuilles vides et l'export Excel répondait 404 (« Aucun service à exporter »).
- **Correctif** : `OperationsPostgres.emargement` (`src/api/operations-postgres.ts`) lit agents, services et plannings de la semaine dans PostgreSQL, applique le périmètre du responsable, refuse le brancardier et produit l'aperçu JSON ou le classeur .xlsx. Test ajouté.
- **Erreur corrigée de la v18.3** : la contrainte SQL `planning_coherence_regime` imposait exactement 8 h au service général, donc les plannings « fin avant 16 h » auraient été refusés par PostgreSQL. Migration `0019_general_heure_fin.sql` (2 h à 8 h), appliquée par `npm run migrate:catalogue`, et la modification d'un poste accepte la même plage. **Après déploiement, lancer `npm run migrate:catalogue`.**
- Tests : 382 réussis.

## Correctif v18.5 (2026-10-21) — pointage personnel de l'agent (badge ou matricule)
- **Nouveau moyen de pointage** : l'agent, connecté à SON compte, pointe une fois sur place en scannant SON badge imprimé (QR du badge) ou en saisissant SON matricule, à la place du QR affiché dans le service. Écran « Pointage » : sélecteur « Moyen de pointage » ; un badge scanné bascule automatiquement sur « Mon badge ».
- **Sécurité** : `POST /api/pointage` accepte `badgeCode` ou `matricule` en plus de `qrToken` (un seul des trois). Le badge ou le matricule doit être celui du compte connecté (badge actif et non révoqué, vérifié en base ; matricule comparé sans casse). Celui d'un autre agent est refusé (403). Pas de QR consommé, mais **la localisation reste obligatoire** : la zone est celle du service de l'agent (jamais fournie par le client), hors zone ou sans GPS = refusé. Service sans zone configurée : « à vérifier » par un responsable, jamais accepté automatiquement. Sources enregistrées : `badge_perso` et `matricule_perso`.
- **Alignement PostgreSQL des règles du 21/10** (oubliées en v18.3 : seuls les moteurs purs étaient à jour) : retard toléré porté de 5 à 20 min dans le tableau de bord, les rapports et les anomalies ; arrivée acceptée jusqu'à 60 min avant le début au poste partagé (15 min auparavant). Tolérance de départ anticipé inchangée (5 min côté SQL).
- Tests : 384 réussis.

## v18.6 (2026-10-21) — audit complet
Voir `AUDIT-COMPLET-2026-10-21.md` : filtres du tableau de bord PostgreSQL, seuil d'absence aligné sur la tolérance de 20 min, suppression du module `src/suivi/` et du code mort, nettoyage des paramètres inutilisés. 370 tests réussis, typage strict sans erreur.
