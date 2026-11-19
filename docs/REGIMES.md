# Moteurs des trois régimes

Code : `src/regimes/{general,garde,urgences}/index.ts`. Chaque régime possède son propre moteur et ses tests ; l'indépendance est vérifiée dans `independance.test.ts`. Les utilitaires communs se trouvent dans `src/shared/`.

| Régime | Poste | Repos prévu | Cycle de reprise |
|---|---|---|---|
| A — Service général | 08 h–16 h du lundi au vendredi, hors jours fériés déclarés | Aucun poste les jours fériés saisis au calendrier | Du lundi au vendredi hors jours fériés |
| B — Garde classique | 08 h–08 h le lendemain (24 h) | 48 h après la fin du poste | Début suivant 72 h après le début |
| C — Urgences, équipe de jour | 08 h–20 h | 36 h après la fin du poste | Reprise à 08 h le surlendemain (débuts espacés de 48 h) ; après un vendredi : mardi 08 h ; après un dimanche : nuit du lundi 20 h |
| C — Urgences, équipe de nuit | 20 h–08 h le lendemain | 60 h après la fin du poste | Reprise à 20 h trois jours plus tard (débuts espacés de 72 h) ; après une nuit commencée un vendredi : jour du dimanche 08 h |

## Règles explicites des Urgences (texte validé du 18/10/2026)

- **Équipe de jour (08 h–20 h)** : repos habituel de 36 h, reprise à 08 h le surlendemain. **Règle du vendredi** : après un poste le vendredi, reprise le **mardi à 08 h** (84 h de repos).
- **Passage jour → nuit** : après un poste de jour le **dimanche**, poste de nuit le **lundi à 20 h** (fin mardi 08 h), puis **60 h de repos** et rotation de nuit. Entre le dimanche 20 h et le lundi 20 h, le repos est de 24 h : exception explicite.
- **Équipe de nuit (20 h–08 h)** : repos habituel de 60 h, reprise à 20 h trois jours plus tard.
- **Passage nuit → jour** : après une nuit commencée le **vendredi à 20 h** (fin samedi 08 h), poste de jour le **dimanche à 08 h–20 h** (24 h de repos après la nuit : exception explicite), puis **36 h de repos consécutives** (reprise le **mardi à 08 h**) et poursuite de la rotation de jour.
- Les samedis, dimanches et **jours fériés** suivent la rotation normale : un jour férié ne supprime aucun poste (sauf instruction contraire de l'administration, à traiter par modification motivée).
- Le moteur bloque un repos inférieur au repos habituel (erreur), calculé depuis la fin réelle du poste, sauf pour les deux passages d'équipe. Il signale par un avertissement toute reprise plus précoce ou toute équipe différente de celle prévue par la rotation.
- Tableau de rotation (noms, équipe réelle de chaque poste, repos, reprises, passages, week-ends, fériés) : `npm run planning:urgences -- --debut 2026-10-19 --fin 2026-11-15 --jour "Nom1@2026-10-17" --nuit "Nom2@2026-10-19,Nom3@2026-10-20" --feries 2026-11-01`, sortie `planning-urgences.csv` (Excel). `Nom@date` fixe le premier jour de travail ; la commande affiche les jours où aucun poste de jour ou de nuit ne commence.

### Point d'interprétation : le dimanche de jour issu de la nuit du vendredi

Deux règles s'appliquent à ce dimanche : « dimanche de jour → nuit du lundi 20 h » (règle de l'équipe de jour) et « 36 h de repos puis rotation de jour » (règle de la nuit du vendredi). La règle la plus précise l'emporte : l'agent issu de la nuit du vendredi reprend le mardi à 08 h en rotation de jour. Variante disponible : `--apres-passage nuit` applique aussi la règle du dimanche (nuit le lundi 20 h) et forme une boucle fermée de 21 jours (7 nuits, 1 dimanche de jour).

### Conséquences et points à arbitrer par l'administration

1. **L'équipe de nuit se vide.** Avec la règle validée, tout agent de nuit atteint un vendredi en 21 jours au plus (en pratique au plus 7 postes de nuit), passe en jour et n'y revient pas : l'équipe de jour ne travaille jamais le dimanche, donc le passage jour → nuit ne se déclenche que pour un agent dont le premier poste est un dimanche de jour. Sans réaffectation par l'administration (ou la variante `--apres-passage nuit`), la présence permanente de nuit n'est pas garantie.
2. **Repos de 24 h lors des deux passages** (dimanche 20 h → lundi 20 h ; samedi 08 h → dimanche 08 h), inférieurs aux repos habituels de 36 h et 60 h : appliqué comme exception explicite.
3. **Couverture du jour** : le lundi au samedi demande au moins deux agents de jour dont les vendredis diffèrent d'une semaine ; le dimanche de jour n'est assuré que par les agents venant de la nuit.

## Autres hypothèses et limites

- Règles validées le 21/10/2026 : un retard jusqu'à 20 min est toléré (compté à partir de 21 min) ; un pointage est accepté jusqu'à 1 h avant le début du poste, au-delà il passe « à vérifier » pour validation par un responsable ; la tolérance de départ anticipé n'est pas définie (0 min dans les moteurs, 5 min dans les requêtes SQL de rapport) et reste à confirmer.
- Service général d'un service qui termine avant 16 h : l'heure de fin se règle de 10 h à 16 h à la génération du planning ; le brancardier pointe alors son départ avant cette heure.
- Les fenêtres de rattachement d'un pointage au poste sont des valeurs provisoires.
- Un poste sans pointage produit une absence **à confirmer** ; aucun traitement automatique ne transforme cette situation en absence injustifiée.
- Les jours fériés officiels du Sénégal ne sont pas préchargés. L’administrateur doit saisir les dates et les vérifier avant de générer les plannings.
- En mode `postgres-catalogue` (mode opérationnel), les plannings et le calendrier sont enregistrés dans PostgreSQL ; seul le mode `demo` utilise le stockage JSON local de démonstration.
- Les remplacements et absences justifiées ne sont pas gérés par les moteurs de régime.
