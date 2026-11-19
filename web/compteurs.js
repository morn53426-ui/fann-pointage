// Compteurs de l'en-tête : logique pure, sans accès au DOM, testée hors navigateur.
// Le serveur (PostgreSQL) reste la seule source des chiffres : le navigateur ne fait que les afficher.

/** Valeur affichée dans la pastille rouge : « 99+ » au-delà de 99, chaîne vide quand il n'y a rien à signaler. */
export function formaterCompteur(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return v > 99 ? "99+" : String(Math.floor(v));
}

/** Libellé lu par les lecteurs d'écran : ne repose pas sur la couleur. */
export function libelleAccessible(cle, n) {
  const v = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0;
  if (cle === "messages") return v === 0 ? "Messages : aucun message non lu" : `${v} message${v > 1 ? "s" : ""} non lu${v > 1 ? "s" : ""}`;
  if (cle === "anomalies") return v === 0 ? "Anomalies : aucune anomalie en attente" : `${v} anomalie${v > 1 ? "s" : ""} en attente`;
  return `${cle} : ${v}`;
}

const entierPositif = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Fusionne la réponse de GET /api/compteurs avec les valeurs précédentes.
 * Une erreur réseau (reponse === null) ou une valeur invalide conserve la dernière valeur connue : jamais de remise à zéro mensongère.
 */
export function fusionnerCompteurs(precedent, reponse) {
  const base = { messages: precedent?.messages ?? null, anomalies: precedent?.anomalies ?? null };
  if (!reponse || typeof reponse !== "object") return base;
  const m = entierPositif(reponse.messagesNonLus);
  const a = entierPositif(reponse.anomaliesNouvelles);
  return { messages: m ?? base.messages, anomalies: a ?? base.anomalies };
}

/** Vrai si au moins un compteur a augmenté (déclenche l'animation et la vibration d'alerte). */
export function aAugmente(avant, apres) {
  return ["messages", "anomalies"].some((cle) => avant?.[cle] !== null && avant?.[cle] !== undefined && (apres?.[cle] ?? 0) > avant[cle]);
}
