# FANN POINTAGE — architecture et statut de livraison

## 1. Stack actuelle

- Logique métier : TypeScript pur dans `src/`, testée avec le lanceur de tests de Node.
- Interface : PWA légère en français sous `web/`, sans compilation.
- API : mode catalogue PostgreSQL sous `src/api/` pour les opérations persistantes ; mode démonstration en mémoire conservé pour les essais locaux.
- Schéma et évolutions : migrations PostgreSQL sous `supabase/migrations/`.

Le mode `postgres-catalogue` persiste les données métier dans PostgreSQL et utilise l’authentification applicative ; le mode de démonstration en mémoire reste distinct. Le raccordement et la configuration de l’instance cible doivent toujours être vérifiés avant tout usage officiel.

## 2. Régimes de planning

- **Service général** : 08 h–16 h du lundi au vendredi (fin réglable de 10 h à 16 h pour un service qui termine plus tôt), hors jours fériés ajoutés au calendrier par l’administration.
- **Garde classique** : 08 h–08 h le lendemain (24 h), puis 48 h de repos ; début suivant 72 h après le début initial.
- **Urgences, jour** : 08 h–20 h, repos le jour civil suivant, puis reprise à 08 h le surlendemain ; départs espacés de 48 h.
- **Urgences, nuit** : 20 h–08 h le lendemain, repos de 08 h à 20 h, puis reprise à 20 h le même jour ; départs espacés de 24 h.

Les cycles d'Urgences de jour et de nuit sont distincts. Voir `docs/REGIMES.md`.

## 3. Score et classement mensuel

Le moteur `src/classement/` calcule un score sur 100, trie les agents avec des règles de départage stables, et génère le classement complet et le Top 5. L'API expose une lecture et une génération explicite pour les mois terminés. L'export CSV contient les rangs et scores.

Le logiciel ne gère pas de sommes à verser ni de références de paiement. Le classement est informatif et ne déclenche aucune transaction financière.

Les tables `parametres_scores`, `scores_mensuels` et `classements_mensuels` permettent la persistance des classements en mode catalogue PostgreSQL ; le mode démonstration conserve des données en mémoire. Une photographie est unique par mois et immuable.

## 4. Pointage et géolocalisation

Le QR dynamique, la session, la vérification du pointage et la localisation se font côté serveur. La position doit être lue au moment du pointage seulement. La fiabilité du GPS intérieur, le fonctionnement caméra, les permissions des téléphones et les règles de conservation doivent être validés sur site.

## 5. État des phases

| Phase | État réel |
|---|---|
| 1–3 | Utilitaires temps/distance et moteurs de régimes avec tests présents. |
| 4–5 | Pointage QR, API, rapports et PWA disponibles ; le mode catalogue persiste les opérations prises en charge dans PostgreSQL. |
| 6–7 | Scores, classement mensuel, Top 5, API et CSV disponibles ; persistance en mode catalogue PostgreSQL. |
| 8 | Tests métier/API et contrôles SQL présents ; les migrations doivent être appliquées et vérifiées sur la base cible. |
| 9 | Checklist de production ; pas de validation des téléphones, de charge ou de sécurité externe. |

Avant un pilote, confirmer la configuration PostgreSQL et les rôles sur le serveur cible, valider les règles métier avec l’établissement et effectuer les essais d’usage, de charge et de sécurité. Voir `docs/DEPLOIEMENT.md`.

- **Poste partagé de démonstration** : badges imprimables recto-verso, scan/saisie au poste, file locale IndexedDB lorsque l’API est indisponible et mise en attente d’une validation manuelle après synchronisation. La PWA comprend les vues Planning & jours fériés et Comptes utilisateurs. Le fichier JSON local sauvegarde les changements ajoutés dans cette livraison, mais ne remplace pas un dépôt transactionnel PostgreSQL.


## 6. Messagerie ciblée et export métier (migrations 0021–0022)

- **Messagerie** : l’administrateur peut diffuser à tous les comptes actifs, à un ou plusieurs comptes précis, ou à un ou plusieurs services. La migration 0022 ajoute le périmètre, la priorité et les tables de destinataires. Les messages sont enregistrés dans `messages_diffusion`, les lectures dans `messages_lectures`; les agents et responsables y accèdent sur ordinateur ou téléphone dès que leur appareil est connecté.
- **Autorisations** : la création et l’annuaire des destinataires sont réservés à l’administrateur ; la liste des messages et le marquage lu sont filtrés côté serveur selon le compte et ses affectations actives. Les confirmations de lecture sont liées à l'utilisateur connecté, sans accepter un identifiant d'utilisateur dans le corps de la requête.
- **Copie métier** : la page « Sauvegarde en ligne » permet à l'administrateur de télécharger un export JSON des agents, affectations, plannings, pointages, absences, badges sans secret, paramètres/classements et messages.
- **Confidentialité et limites** : l’export JSON expurgé retire les coordonnées GPS exactes, les adresses, téléphones et photos, mais contient encore certaines données personnelles d’exploitation. Ce n’est ni une sauvegarde complète ni une archive directement restaurable. Il exclut volontairement mots de passe, sessions et secrets QR/badges. La restauration complète exige les sauvegardes PostgreSQL chiffrées décrites dans `docs/SAUVEGARDE_SERVEUR.md`.
- **Mobile/hors connexion** : une opération est considérée enregistrée en ligne seulement après confirmation du serveur. La file locale hors ligne du poste partagé est synchronisée après reconnexion et les événements à vérifier ne sont pas supprimés silencieusement. Ne pas afficher un pointage mobile non confirmé comme validé.


## 7. Responsivité et capacité (v32d)

Voir `docs/RESPONSIVITE_SCALABILITE.md` : couche responsive globale, cache statique LRU borné, ETag/304, timeouts PostgreSQL, pool configurable et migration d’index 0027. Le déploiement reste volontairement limité à une instance backend tant que le limiteur de tentatives n’est pas partagé entre instances.
