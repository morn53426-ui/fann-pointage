// Messages affichés à l'agent (français). Les codes sont stables ; les textes peuvent évoluer.
export const PROCEDURE_GPS =
  "En cas de problème GPS : activez la localisation de l'appareil, autorisez-la pour ce site, " +
  "placez-vous à l'extérieur ou près d'une fenêtre, patientez quelques secondes puis réessayez. " +
  "Si cela échoue, prévenez votre responsable : il pourra valider votre pointage avec un motif.";

export const MESSAGES: Record<string, string> = {
  requete_invalide: "Requête invalide.",
  compte_inconnu: "Compte introuvable.",
  compte_inactif: "Compte désactivé.",
  qr_invalide: "QR code invalide.",
  qr_expire: "QR code expiré : scannez le QR affiché.",
  qr_reutilise: "Ce QR code a déjà été utilisé par vous.",
  qr_mauvaise_zone: "Ce QR code ne correspond pas à votre service (ancien code, plus utilisé).",
  qr_autre_service: "Ce QR est celui d'un autre service. Scannez le QR affiché dans VOTRE service, ou pointez avec le QR de votre badge ou votre matricule.",
  zone_inconnue: "Zone de pointage introuvable.",
  zone_inactive: "Cette zone de pointage est désactivée.",
  permission_refusee: "Localisation refusée : elle est obligatoire pour pointer.",
  gps_indisponible: "Position indisponible.",
  position_ancienne: "Position trop ancienne : réessayez.",
  hors_zone: "Vous êtes en dehors de la zone autorisée.",
  zone_service_non_configuree: "Aucune zone de pointage n'est configurée dans l'hôpital : un responsable vérifiera votre pointage.",
  badge_invalide: "Ce badge n'est pas le vôtre, ou il est révoqué. Demandez un renouvellement à l'administrateur.",
  matricule_invalide: "Ce matricule ne correspond pas à votre compte.",
  precision_insuffisante: "Position trop imprécise.",
  position_suspecte: "Position suspecte : vérification par un responsable.",
  aucun_poste_planifie: "Aucun poste planifié : vérification par un responsable.",
  poste_deja_complet: "Arrivée et départ déjà enregistrés pour ce poste.",
  trop_rapproche: "Pointage trop rapproché du précédent.",
  non_enregistre: "Le pointage n'a pas pu être enregistré. Réessayez.",
};
export const message = (code: string | null): string => (code ? MESSAGES[code] ?? "Pointage refusé." : "Pointage enregistré.");
