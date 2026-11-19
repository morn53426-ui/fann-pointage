# Pointage QR et localisation (Phase 4)

Code : `src/pointage/` (qr, localisation, service, manuel, masquage, messages, memoire). Tests : `*.test.ts` du même dossier.

## Flux serveur (`traiterPointage`)
1. Requête valide (clé d'idempotence) ; clé déjà vue = réponse rejouée, aucun doublon.
2. Compte : l'identité vient de la **session**, jamais du corps de la requête ; compte inconnu ou inactif refusé.
3. QR : signature HMAC, expiration (60 s par défaut), un QR ne sert qu'une fois par agent. QR invalide ou expiré : refusé, **non enregistré**, événement de sécurité journalisé.
4. Poste : rattachement au poste planifié par fenêtre de temps (poste de nuit = un seul poste). Le serveur décide arrivée ou départ. Poste complet ou double scan rapproché : refusé.
5. Localisation recalculée côté serveur : permission, position présente, fraîcheur, précision, distance au centre de la zone, indicateur de position simulée, zone active.
6. **Moyens de pointage (règle métier du 25/10/2026)** :
   - **QR affiché dans le service** : réservé aux agents de CE service. Le QR d'une zone d'un autre service est refusé et non enregistré (`qr_autre_service`, journal `qr_autre_service_refuse`) ; le QR temporaire n'est pas consommé. La position doit être couverte par la zone du QR.
   - **Badge imprimé (QR du badge) ou matricule** : valables partout dans l'hôpital ; la position doit être couverte par une zone active, quel que soit son service (journal `pointage_zone_autre_service` si ce n'est pas celui de l'agent).
   - **Poste de pointage** (`/api/pointage-station`) : l'agent montre son badge, ou donne son matricule, à un superviseur (responsable ou administrateur) qui pointe avec son téléphone. Un responsable peut pointer un agent d'un autre service ; le journal garde l'auteur et `agentAutreService`.
   - **Rotation** : plusieurs agents peuvent avoir la même garde (mêmes dates) dans le même service ; chacun a son planning, ses arrivées et départs. Seuls les chevauchements d'UN MÊME agent sont refusés.
7. Enregistrement, puis réponse. **`confirme` n'est vrai que si le pointage est accepté ET enregistré.**

Décisions : `accepte`, `refuse` (enregistré, validable manuellement), `a_verifier` (précision, position simulée, hors zone si la zone est en mode « anomalie », aucun poste planifié).

## Réglages (provisoires, à faire valider)
Âge maximal d'une position 30 s ; imprécision = vérification manuelle (ou refus) ; intervalle minimal entre deux pointages 120 s ; alerte après 3 refus hors zone en 30 min ; durée du QR 60 s.

## Limites techniques
- **L'heure du téléphone n'est pas fiable** : la fraîcheur utilise d'abord `ageMs` (durée mesurée sur l'appareil), sinon l'horodatage de la position. Le serveur ne peut pas vérifier ces valeurs : un client modifié pourrait les falsifier. Une piste plus robuste (jeton « défi » émis par le serveur avant l'acquisition de la position) est dans `archive/phase4-ancien-essai/`.
- **Position simulée** : détectée seulement si l'appareil ou le navigateur le signale (souvent impossible dans un navigateur, surtout sur iPhone).
- **Précision GPS à l'intérieur des bâtiments** : à tester sur les appareils réels avant de fixer rayons et seuils.
- La distance est mesurée au centre de la zone ; la précision est jugée à part (pas de marge d'erreur ajoutée).
- Un QR affiché reste utilisable par n'importe quel agent authentifié présent dans la zone pendant sa durée de vie (photo partagée). Le contrôle de position et l'usage unique par agent limitent ce risque sans l'éliminer.

## Pas encore fait
- API HTTP, authentification réelle et lien avec PostgreSQL (dépôts en mémoire seulement).
- Écran mobile de scan (caméra, demande de localisation, affichage zone/distance/précision) : prévu avec l'interface PWA en Phase 5. Le scan caméra sur iPhone demandera une bibliothèque de lecture de QR.
- Génération et affichage du QR renouvelable côté administrateur.
