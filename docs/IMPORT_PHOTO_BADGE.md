# Importer ou remplacer la photo d'un badge

## Créer un badge avec une photo

1. Connectez-vous avec le compte administrateur.
2. Ouvrez **Badges à imprimer**.
3. Dans **Créer un badge pour un agent**, remplissez le prénom, le nom, le service et le régime de travail.
4. Dans **Photo de l'agent**, cliquez sur le champ de sélection du fichier et choisissez la photo.
5. Attendez le message vert **Photo prête** et vérifiez l'aperçu.
6. Cliquez sur **Créer la fiche et le badge**. La photo est recadrée en portrait et convertie en JPEG compact avant l'envoi.

## Remplacer la photo d'un badge déjà créé

1. Dans **Badges à imprimer**, recherchez la carte de l'agent.
2. Dans les actions de sa carte, cliquez sur **Changer la photo** (ou **Ajouter une photo** si aucune photo n'est enregistrée).
3. Choisissez le nouveau fichier, puis attendez la confirmation **Photo mise à jour**.
4. L'aperçu du badge est rechargé avec la photo enregistrée. L'opération ne modifie pas le nom ni le matricule.

Cette action est proposée pour les fiches d'agents créées dans l'application et accessibles à l'administrateur. Les cartes de démonstration restent fictives et protégées par leur filigrane.

## Formats et limites

- Formats habituellement reconnus : JPG/JPEG, PNG, WebP, GIF, BMP et AVIF, si le navigateur sait décoder le format.
- Taille maximale du fichier original : 20 Mo.
- La photo est recadrée au format portrait 4:5 et compressée en JPEG dans le navigateur avant l'envoi.
- Les fichiers HEIC/HEIF, fréquents sur iPhone, ne sont pas convertis automatiquement dans cette version. Convertissez la photo en JPG ou, pour les prochaines photos prises sur iPhone, utilisez **Réglages → Appareil photo → Formats → Le plus compatible**.
- Choisissez une photo nette, avec le visage visible, et vérifiez que vous êtes autorisé à l'utiliser sur un badge professionnel.

## Si l'application ne montre pas la nouvelle fonction

Dans le dossier du projet, ouvrez Git Bash puis exécutez :

```bash
docker compose up -d --build --force-recreate app
```

Attendez que le conteneur soit démarré, puis ouvrez `http://127.0.0.1:8787` et faites **Ctrl + F5**. Pour une PWA installée, fermez-la complètement puis rouvrez-la. Le cache de l'application a été renouvelé en `fann-pointage-v5`.

## Messages d'erreur

- **Le navigateur ne parvient pas à lire cette image** : ouvrez-la dans Photos ou Paint et enregistrez une copie JPG.
- **La photo reste trop volumineuse** : essayez une photo moins détaillée ou recadrez-la avant de la sélectionner.
- **Erreur réseau ou accès refusé** : vérifiez que vous êtes connecté avec un compte administrateur et que le conteneur de l'application est en cours d'exécution.

> Ce projet demeure une version de démonstration. Les données de personnel réelles ne doivent pas être utilisées avant la mise en place d'un stockage et d'un déploiement de production sécurisés.
## Erreur CSP `blob:http://localhost:8787/...`

Si la console affiche `violates Content Security Policy ... img-src 'self' data:`, le serveur utilise une ancienne version de sa politique de sécurité. La version corrigée autorise `blob:` uniquement pour les images afin que l'aperçu local puisse charger une photo avant son envoi. Cela n'autorise pas les scripts provenant de `blob:`.

Après mise à jour : reconstruisez le conteneur `app` (`docker compose up -d --build --force-recreate app`), puis rechargez la page avec `Ctrl + F5`. Vérifiez dans l'onglet Réseau que l'en-tête `Content-Security-Policy` contient `img-src 'self' data: blob:`. Si l'erreur demeure, vérifiez que vous avez lancé Docker depuis le dossier de la nouvelle archive et que le conteneur `app` a bien été recréé.
