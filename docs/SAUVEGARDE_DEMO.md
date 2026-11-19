# Sauvegarde locale — démonstration uniquement

Le serveur actuel n'utilise pas encore PostgreSQL. Il conserve les modifications de démonstration dans `/data/pointages-demo.json`, dans le volume Docker `fann-pointage-runtime-data`.

## Faire une sauvegarde ponctuelle sous Windows

1. Démarrez Docker Desktop et FANN POINTAGE.
2. Dans le dossier du projet, ouvrez PowerShell.
3. Exécutez :

```powershell
.\scripts\sauvegarder-demo.ps1
```

Le script copie le JSON dans `backups/`, vérifie sa structure minimale et calcule un hash SHA-256. Le dossier `backups/` est exclu du ZIP et du contrôle de version.

## Limites et précautions

- C'est une sauvegarde manuelle de la version démo ; aucune tâche nocturne n'est configurée.
- Elle n'est ni chiffrée, ni envoyée sur un site distant. Les photos, fiches et historiques contenus dans cette copie doivent être protégés.
- Le hash permet de détecter une altération accidentelle, mais ne protège pas un fichier contre un utilisateur qui peut remplacer le fichier et le hash.
- N'utilisez pas cette procédure comme stratégie de sauvegarde de production. La future mise en production devra disposer de sauvegardes PostgreSQL chiffrées, de rétention, de séparation des droits, de supervision et de tests réguliers de restauration.
- Ne supprimez pas le volume Docker pour « réinitialiser » le projet : cela effacerait les données locales.
