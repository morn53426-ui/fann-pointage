> **Archive Windows complète :** un fichier `.env` local prêt pour une démonstration est inclus dans cette archive, et `LANCER_FANN_POINTAGE.bat` permet de vérifier la configuration puis de démarrer Docker. Le mot de passe commun de démonstration se lit dans `.env` (`DEMO_MOT_DE_PASSE`). Ne partagez pas `.env`, n’utilisez que des données fictives et n’utilisez pas ces comptes en production.

# Mise à jour — poste partagé, badges et QR accessibles

Cette mise à jour prépare le prototype FANN POINTAGE à être testé sans téléphone personnel pour chaque brancardier.

## Deux QR différents à ne pas confondre

- **QR de pointage** : lien web à durée limitée. Dans la vue **QR de pointage**, le champ « Adresse à encoder dans le QR » permet de choisir une adresse joignable par l'appareil du brancardier. Si l'administrateur a ouvert le site via ngrok en HTTPS, l'adresse ngrok est préremplie. Si l'administrateur a ouvert `localhost`, il doit remplacer cette adresse par le tunnel HTTPS ou une URL intranet sécurisée avant de générer le QR destiné à un autre appareil.
- **Badge QR imprimé** : code technique `FANN-BADGE:...`, ce n'est pas une URL et la caméra native ne doit pas ouvrir une page web. Le responsable ouvre **Poste partagé**, puis lit le badge depuis cette page avec la caméra intégrée, un lecteur QR USB (saisie clavier) ou le champ de saisie.

## Parcours de pointage sur un appareil partagé

1. Le responsable ouvre l'application, se connecte, puis sélectionne **Badges à imprimer**.
2. Les badges de démonstration servent uniquement aux essais et ne doivent pas être distribués. Pour chaque agent réel, créez sa fiche avec une photo et imprimez son badge recto-verso après validation des données.
3. Il ouvre **Poste partagé**, choisit **Arrivée** ou **Départ**, puis scanne le badge ou saisit son code.
4. Si le serveur est disponible, le pointage est enregistré et l'heure officielle est l'heure du serveur.
5. Si la requête échoue à cause du réseau, le navigateur garde l'événement dans IndexedDB sur cet appareil et affiche clairement **NON confirmé**. Une note sur le registre papier reste nécessaire comme secours.
6. Au retour du réseau, les événements sont synchronisés et restent **à vérifier**. Un responsable doit les valider avec un motif. Leur heure capturée par l'appareil n'est utilisée pour le calcul de présence qu'après validation manuelle ; l'heure de réception serveur reste conservée séparément.

## Lancer localement avec Docker

Dans Git Bash, à la racine du projet :

```bash
cp .env.example .env
openssl rand -base64 36
openssl rand -base64 36
```

Remplacer `DEMO_MOT_DE_PASSE` et `POSTGRES_PASSWORD` dans `.env` par deux secrets différents, puis exécuter :

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

Ouvrir ensuite `http://127.0.0.1:8787` sur le même ordinateur. Pour tester le lien web depuis un téléphone, démarrer un tunnel temporaire tel que `ngrok http 8787`, ouvrir l'application via l'adresse HTTPS affichée, puis créer le QR depuis cette même adresse. Ne pas publier la démo sur Internet pour une utilisation réelle.

Par défaut, Docker n'expose le site que sur `127.0.0.1`. Pour un test sur le réseau local de confiance, `APP_BIND_ADDRESS=0.0.0.0` peut être utilisé avec un pare-feu restreint. La caméra et le service worker PWA nécessitent HTTPS ou `localhost` ; depuis une adresse IP locale en HTTP, utiliser un lecteur QR USB/la saisie ou mettre en place HTTPS intranet.

## Limites à respecter

- Le projet reste une **démo** : le dépôt PostgreSQL n'est pas raccordé aux routes de l'API. Un volume JSON Docker conserve les événements de pointage et le journal de démonstration, mais les comptes, plannings, zones et classements ne sont pas durables.
- Les badges `FANN-BADGE:<id>` sont prévisibles et ne sont pas des identifiants de production.
- La file hors ligne dépend du navigateur et de l'appareil qui l'a créée. Ne pas effacer les données du navigateur avant synchronisation ; conserver un registre papier de secours en cas de panne ou de perte de l'appareil.
- Les pointages du prototype, les comptes partagés et le code de démonstration ne doivent pas être utilisés pour gérer les présences réelles des agents.
