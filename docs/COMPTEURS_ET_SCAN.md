# Compteurs d'en-tête, suivi des anomalies et retour du scan QR (0.2.0-preproduction.29)

## Compteurs (pastille rouge sur l'icône)
- **Source de vérité : PostgreSQL.** `GET /api/compteurs` calcule, pour le seul compte de la session (jamais un identifiant fourni par le client) :
  - `messagesNonLus` : messages visibles pour ce compte, non archivés, sans ligne dans `messages_lectures` (l'administrateur, auteur des diffusions, reste à 0) ;
  - `anomaliesNouvelles` / `anomaliesConsultees` : administrateur et responsable uniquement (le responsable ne voit que ses services) ; `null` pour un agent.
- Les deux compteurs restent **séparés** (icône enveloppe = messages, icône triangle = anomalies). Pastille masquée à 0, `99+` au-delà de 99, libellé accessible (« 3 messages non lus », « 5 anomalies en attente »), emplacement réservé : l'en-tête ne bouge pas.
- Rafraîchissement : une seule requête légère à la connexion, à chaque changement d'écran, au retour sur l'onglet et toutes les 30 s (polling existant conservé, pas de requêtes empilées). Une erreur réseau **conserve** les derniers chiffres.
- Pas de double comptage : le chiffre est recalculé par la base, il n'est jamais incrémenté côté navigateur.

## Statuts des anomalies (migration 0025, table `anomalies_suivi`)
| Statut | Signification | Compte dans le badge |
|---|---|---|
| nouvelle | aucune ligne de suivi | oui |
| consultée | action explicite « Marquer comme consultée » | non (reste dans la liste « à suivre ») |
| traitée | action explicite « Marquer comme traitée » | non (sort de la liste « à suivre », visible avec le filtre « Traitées » ou « Toutes ») |
- **Ouvrir la liste ne change aucun statut.** « Rouvrir » remet une anomalie traitée en consultée.
- `POST /api/anomalies/:pointageId/statut` `{statut: "consultee"|"traitee"}` : administrateur et responsable (périmètre de ses services), requête paramétrée, audit dans `journal_audit`.
- `GET /api/anomalies?statut=a_suivre|nouvelle|consultee|traitee|toutes` (défaut : `a_suivre`).
- Le rôle `fann_app` reçoit SELECT/INSERT/UPDATE sur `anomalies_suivi` (pas de DELETE).
- Mise à niveau : `npm run db:upgrade` (applique 0025 puis les droits). `/readyz` exige désormais 12 migrations.

## Scan QR : bip, vibration, anti-doublon
- **Plus de bip à la lecture de la caméra.** Le bip et la vibration de succès (`signal.signaler("ok")`) ne partent qu'**après la réponse du serveur** : agent `confirme === true`, poste partagé `validation === "accepte"`.
- Refus, QR invalide/expiré, « à vérifier », panne réseau : signal d'échec ou d'attention distinct, jamais le signal de succès.
- La lecture caméra déclenche l'envoi automatiquement (agent et poste partagé). Message « Pointage enregistré avec succès » affiché seulement après confirmation.
- Anti-doublon (`web/scan-pointage.js`) : un code n'est envoyé qu'une fois tant que la requête est en cours, puis pendant 8 s ; après un refus ou une panne, le même code peut être re-présenté tout de suite. La caméra s'arrête dès la première détection. La clé d'idempotence, le jeton dynamique du QR et les contrôles de séquence restent **côté serveur**, inchangés.
- Le son est initialisé au clic sur « Scanner avec la caméra » (restriction d'autoplay). Sans vibration ou sans audio (iPhone/Safari : pas d'API de vibration), le pointage aboutit normalement.

## Vérifier
1. Admin : diffuser un message à un agent → connexion agent : pastille rouge « 1 » sur l'icône Messages ; ouvrir/lire → elle disparaît.
2. Créer un pointage hors zone ou à vérifier → pastille « Anomalies » chez l'admin/le responsable du service ; « Marquer comme consultée » puis « traitée » fait baisser le chiffre.
3. Téléphone Android (HTTPS) : Pointage → « Scanner avec la caméra » → un seul bip + une vibration courte après confirmation. Refaire avec un QR expiré : bip grave d'échec, pas de succès.
