# Modification du planning de l’unité Mobil — gardes de 24 h et repos de 56 h

## Règles appliquées

- **Équipe de jour Mobil** : prise à 08 h, fin à 16 h, du lundi au vendredi. Le samedi et le dimanche restent des jours non travaillés. Les jours fériés actifs dans le calendrier restent exclus par défaut ; une exception nécessite l’autorisation prévue dans l’application.
- **Équipe de garde Mobil** : les jours ouvrés non fériés, prise à 16 h et fin à 08 h le lendemain (16 h de service).
- **Samedi, dimanche ou jour férié** : si la date de début de la garde correspond à l’une de ces journées, prise à 08 h et fin à 08 h le lendemain (24 h de service).
- **Repos** : au moins 56 heures consécutives après la fin prévue de chaque garde, avant le prochain poste de l’agent. Le contrôle est exécuté côté serveur pour les plannings locaux et PostgreSQL.
- Les groupes de rotation **A, B et C** sont conservés. Aucun changement n’est apporté aux régimes des autres unités.

Les jours fériés sont ceux qui sont enregistrés comme actifs dans le calendrier de l’application. Les heures sont interprétées à l’heure de Dakar.

## Exemples de calcul

| Poste effectué | Fin de garde | Fin des 56 h de repos | Première reprise conforme selon les horaires Mobil |
|---|---|---|---|
| Lundi 16 h–mardi 08 h | Mardi 08 h | Jeudi 16 h | Jeudi 16 h |
| Samedi 08 h–dimanche 08 h | Dimanche 08 h | Mardi 16 h | Mardi 16 h |
| Mercredi férié 08 h–jeudi 08 h | Jeudi 08 h | Samedi 16 h | Lundi 16 h, car les prises du samedi et dimanche sont à 08 h |

## Déploiement sur le VPS Docker déjà existant

1. Transférez et décompressez cette version du projet dans le répertoire de déploiement habituel. Conservez le fichier `.env` actuel : il contient les paramètres et secrets propres au VPS.
2. Depuis le répertoire du projet, faites une sauvegarde PostgreSQL avant la mise à jour :

```bash
docker compose -f compose.yaml -f compose.vps.yaml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > sauvegarde-avant-mobil-$(date +%F-%H%M).sql
```

3. Reconstruisez les images et démarrez les services :

```bash
docker compose -f compose.yaml -f compose.vps.yaml build app migrate
docker compose -f compose.yaml -f compose.vps.yaml up -d
```

Le service `migrate` applique la migration additive `0026_mobil_gardes_24h_weekends_feries`, puis configure les droits du rôle `fann_app` avant le démarrage de `app`. Le volume PostgreSQL est conservé.

4. Vérifiez les services et les journaux :

```bash
docker compose -f compose.yaml -f compose.vps.yaml ps
docker compose -f compose.yaml -f compose.vps.yaml logs --tail=100 migrate app
curl -fsS http://127.0.0.1:8787/readyz
```

5. Dans l’application, contrôlez une génération Mobil en semaine, une garde de samedi/dimanche et une garde sur un jour férié actif. Vérifiez les heures de début/fin et les 56 h de repos dans la liste des plannings et la feuille d’émargement.

**Important :** cette migration ne réécrit aucun planning déjà enregistré. Les plannings futurs créés avec l’ancienne règle doivent être vérifiés par l’administration et, si nécessaire, annulés puis régénérés pour appliquer les nouveaux horaires. Ne lancez jamais `docker compose down -v` : cette commande supprimerait le volume PostgreSQL. Gardez le `.env` du VPS et ne remplacez jamais les secrets par ceux d’un autre environnement.
