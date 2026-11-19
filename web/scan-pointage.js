// Scan QR : anti-doublon et choix du retour (son / vibration) selon la réponse RÉELLE du serveur. Logique pure, testée hors navigateur.

/**
 * Garde anti-doublon. Une caméra détecte le même QR plusieurs fois par seconde : un code n'est accepté qu'une fois
 * tant que son traitement est en cours, puis pendant `delaiMs` après son dernier envoi.
 * La sécurité reste côté serveur (jeton dynamique, clé d'idempotence, séquence arrivée/départ) ; ce garde ne fait qu'éviter les envois et signaux inutiles.
 */
export function creerGardeScan({ delaiMs = 8000, maintenant = () => Date.now() } = {}) {
  let enCours = false;
  let dernierCode = null;
  let dernierInstant = 0;
  return {
    /** Retourne true si ce scan doit être traité. */
    accepter(code) {
      const c = String(code ?? "");
      if (!c || enCours) return false;
      if (c === dernierCode && maintenant() - dernierInstant < delaiMs) return false;
      enCours = true; dernierCode = c; dernierInstant = maintenant();
      return true;
    },
    /** À appeler quand le serveur a répondu (ou que la requête a échoué). */
    terminer({ rearmer = false } = {}) {
      enCours = false;
      dernierInstant = maintenant();
      if (rearmer) dernierCode = null; // refus ou panne : le même code peut être présenté à nouveau tout de suite
    },
    get enCours() { return enCours; },
  };
}

/**
 * Niveau de signal pour un pointage de l'agent (POST /api/pointage). « ok » uniquement si le serveur a confirmé.
 */
export function niveauPointageAgent(reponse) {
  if (reponse && reponse.confirme === true) return "ok";
  if (reponse && reponse.validation === "a_verifier") return "attention";
  return "ko";
}

/** Niveau de signal pour le poste partagé (POST /api/pointage-station). */
export function niveauPointageStation(reponse) {
  if (reponse && reponse.validation === "accepte") return "ok";
  return "attention";
}
