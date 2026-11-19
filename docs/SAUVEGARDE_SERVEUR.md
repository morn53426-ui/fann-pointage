# Sauvegardes chiffrées vers le serveur

Chaque sauvegarde : dump PostgreSQL vérifié → chiffrement AES-256 → contrôle de relecture → copie sur le serveur → contrôle d'empreinte SHA-256 → rétention (14 copies locales, 60 sur le serveur). Aucune copie en clair n'est conservée. Planification : tous les jours à 02:00 et 13:00.

> Ces scripts PowerShell n'ont pas pu être exécutés dans l'environnement de développement (pas de Windows ni de Docker). Faites l'essai complet ci-dessous avant de vous y fier.

## 1. Préparer le serveur
Vous pouvez utiliser un mode, l'autre, ou **les deux à la fois** (recommandé : deux copies sur deux machines). Renseignez `BACKUP_DEST` dans `.env`, plusieurs destinations séparées par `;` :

`BACKUP_DEST=\\NAS\partage\fann;sauvegarde@serveur:/srv/fann`

La sauvegarde est envoyée à **chaque** destination, avec contrôle d'empreinte pour chacune. Si l'une est indisponible, l'autre est quand même alimentée, mais la tâche est marquée en échec (`ECHEC.txt`) pour vous alerter.

- **Partage Windows ou NAS** : `BACKUP_DEST=\\SERVEUR\partage\fann`. Le compte Windows qui lance la tâche doit pouvoir écrire dans ce partage (testez : `dir \\SERVEUR\partage\fann`).
- **Serveur Linux (SSH)** : `BACKUP_DEST=sauvegarde@serveur:/srv/fann`. Sur le PC :
  1. `ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\fann_backup` (touche Entrée deux fois : pas de phrase de passe, la tâche est automatique).
  2. Installez la clé publique sur le serveur : `type $env:USERPROFILE\.ssh\fann_backup.pub | ssh sauvegarde@serveur "cat >> ~/.ssh/authorized_keys"`.
  3. Connectez-vous **une fois à la main** (`ssh -i $env:USERPROFILE\.ssh\fann_backup sauvegarde@serveur`) et vérifiez l'empreinte du serveur avant de répondre « yes » : le script refuse un serveur inconnu.
  4. Utilisez un compte dédié, sans droits administrateur, limité au dossier de sauvegarde.

## 2. Installer
```powershell
powershell -ExecutionPolicy Bypass -File scripts\installer-sauvegarde.ps1
```
Crée la phrase secrète `%USERPROFILE%\fann-backup\backup.key` et la tâche planifiée `FANN-Sauvegarde`.
**Copiez immédiatement `backup.key` sur un support séparé** (clé USB gardée en lieu sûr, coffre de mots de passe), jamais sur le serveur de sauvegarde : sans elle, toutes les sauvegardes sont définitivement illisibles.

## 3. Essai complet (obligatoire)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\sauvegarde-serveur.ps1
powershell -ExecutionPolicy Bypass -File scripts\restaurer-sauvegarde.ps1
```
La première commande doit finir par « Sauvegarde terminée avec succès » et le fichier `.dump.enc` doit apparaître sur le serveur. La seconde restaure la dernière sauvegarde dans une base jetable, affiche le nombre d'agents et de services puis la supprime : c'est la preuve que la sauvegarde est exploitable. Refaites-la au moins une fois par trimestre, idéalement avec une copie rapatriée du serveur (`-Fichier`).

## 4. Surveillance
- Journal : `sauvegardes\sauvegarde.log`. En cas d'échec, le fichier `sauvegardes\ECHEC.txt` existe (il disparaît à la prochaine réussite) : vérifiez-le chaque jour ouvré.
- La tâche s'exécute dans la session de l'utilisateur : Docker Desktop doit démarrer à l'ouverture de session (Paramètres → General → *Start Docker Desktop when you sign in*) et le PC doit rester allumé.
- Pour un serveur en production, préférez Linux (cron + `docker compose`) : même principe, même `sauvegarde-postgres.sh`.

## 5. Restaurer après un incident
```powershell
powershell -ExecutionPolicy Bypass -File scripts\restaurer-sauvegarde.ps1 -Fichier C:\chemin\fann-pointage-AAAAMMJJ-HHMMSS.dump.enc -Production
```
Confirmation « RESTAURER » demandée. L'application est arrêtée, la base restaurée en une seule transaction (tout ou rien), les droits du rôle applicatif sont réappliqués par `migrate`, puis l'application redémarre. Les pointages faits après la sauvegarde sont perdus : informez les responsables.

## Limites connues
- Les sauvegardes contiennent des données personnelles : accès au serveur restreint, durée de conservation à valider avec la direction.
- Une sauvegarde toutes les 11 h au plus tard signifie jusqu'à ~11 h de pointages perdus en cas de panne ; augmentez la fréquence (`-Heures '02:00,08:00,13:00,20:00'`) si nécessaire.
- Le serveur et le PC doivent être sur un réseau de confiance ; la copie est chiffrée avant l'envoi.
