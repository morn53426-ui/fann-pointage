# Import initial du registre — procédure protégée

Le registre nominatif n'est pas livré dans le dépôt, l'archive applicative ni l'image Docker. Conservez le fichier SQL original dans un emplacement privé, avec des droits d'accès limités et une sauvegarde protégée. Ne le copiez pas dans `registre-prive/` du projet et ne le transmettez pas dans les tickets ou journaux.

## 1. Préparer l'environnement

1. Créez et vérifiez une sauvegarde PostgreSQL restaurable avant la première importation.
2. Placez le fichier autorisé hors du dossier du projet, puis définissez `REGISTRE_INITIAL_SQL` dans l'environnement du processus d'administration. Ne mettez pas le chemin privé dans un fichier versionné.
3. Vérifiez que l'URL configurée pour `DATABASE_ADMIN_URL` pointe vers une base de recette isolée avant d'exécuter la procédure.

## 2. Prévisualiser sans conserver de données

Depuis la racine du projet, avec Node.js 22.23.4 ou plus et les dépendances installées :

```bash
REGISTRE_INITIAL_SQL="/chemin/prive/registre-initial.sql" npm run migrate:catalogue -- --preview-registre
```

Dans PowerShell, utilisez `$env:REGISTRE_INITIAL_SQL = 'C:\chemin-prive\registre-initial.sql'` puis `npm run migrate:catalogue -- --preview-registre`.

L'aperçu exécute l'import dans une transaction puis l'annule. Il vérifie le nombre attendu de fiches et ne conserve pas les modifications. Cette procédure exige un registre vide pour cet identifiant de source. Un registre partiel bloque l'opération et doit être examiné manuellement.

## 3. Appliquer l'import initial

Après validation de la sauvegarde, de l'aperçu et de la base cible :

```bash
REGISTRE_INITIAL_SQL="/chemin/prive/registre-initial.sql" npm run migrate:catalogue -- --apply-registre
```

L'import ne s'exécute jamais avec la commande habituelle `npm run migrate:catalogue` : cette commande applique uniquement les migrations de schéma. Une fois les fiches initiales présentes, les relances ne réimportent rien. Les conflits sur la référence de source n'écrasent pas les noms/prénoms existants. Une mise à jour ultérieure de l'identité doit passer par la procédure administrative autorisée, qui conserve une trace d'audit.

## 4. Refus et récupération

L'import est refusé si le registre contient un nombre partiel de fiches, si le fichier semble contenir des opérations SQL destructives ou si le résultat ne correspond pas au nombre attendu. N'essayez pas de contourner le contrôle en effaçant des lignes. Sauvegardez la base, comparez le registre et l'état courant avec l'administration, puis corrigez via une procédure documentée et auditée.

Le script n'efface pas l'historique Git antérieur et ne rend pas privé un fichier qui aurait déjà été diffusé. Si une archive ou un dépôt antérieur a exposé le registre, traitez cette exposition séparément selon la politique de confidentialité de l'établissement.
