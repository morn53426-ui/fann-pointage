// Vérification SERVEUR de la position au moment du pointage. Rien n'est supposé exact :
// fraîcheur, précision, distance et indicateurs de fraude sont recalculés ici.
import { haversineMeters } from "../shared/geo.ts";

export type PermissionLoc = "accordee" | "refusee" | "indisponible";
export type StatutLoc =
  | "dans_zone" | "hors_zone" | "precision_insuffisante" | "indisponible" | "refusee"
  | "ancienne" | "suspecte" | "zone_inactive" | "zone_inconnue";
export type Validation = "accepte" | "refuse" | "a_verifier";

export interface PositionRecue {
  latitude: number; longitude: number; precisionM: number | null;
  collecteeLe: Date | null;
  /** Durée écoulée depuis l'acquisition, mesurée sur l'appareil : prioritaire sur l'horloge du téléphone. */
  ageMs: number | null;
  simulee: boolean | null; methode: string | null;
}
export interface ZoneLoc {
  id: string; nom: string; serviceId: string; actif: boolean;
  latitude: number; longitude: number; rayonM: number; precisionMaxM: number;
  horsZoneAction: "refuser" | "anomalie";
}
export interface ParamsLoc {
  ageMaxS: number;            // une position plus ancienne est refusée (anti-réutilisation)
  avanceMaxS: number;         // tolérance si l'horloge de l'appareil avance
  precisionAction: "refuser" | "a_verifier";
}
export const PARAMS_LOC_DEFAUT: ParamsLoc = { ageMaxS: 30, avanceMaxS: 10, precisionAction: "a_verifier" };

export interface VerdictLoc {
  statut: StatutLoc;
  validation: Validation;
  code: string | null;
  distanceM: number | null;     // distance au centre de la zone
  ecartZoneM: number | null;    // distance au bord de la zone (0 si dans la zone)
  precisionM: number | null;
  nomZone: string | null;
  positionSuspecte: boolean;
}

const vide = (zone: ZoneLoc | null): Omit<VerdictLoc, "statut" | "validation" | "code"> =>
  ({ distanceM: null, ecartZoneM: null, precisionM: null, nomZone: zone?.nom ?? null, positionSuspecte: false });

/** Lit une position brute venant du client ; null si inutilisable. */
export function lirePositionBrute(x: unknown): PositionRecue | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const latitude = num(o.latitude), longitude = num(o.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  let collecteeLe: Date | null = null;
  if (typeof o.collecteeLe === "string" || typeof o.collecteeLe === "number") {
    const d = new Date(o.collecteeLe);
    collecteeLe = Number.isNaN(d.getTime()) ? null : d;
  }
  const precisionBrute = num(o.precisionM);
  const precisionM = precisionBrute !== null && precisionBrute >= 0 ? precisionBrute : null;
  return {
    latitude, longitude, precisionM, collecteeLe,
    ageMs: num(o.ageMs) !== null && (num(o.ageMs) as number) >= 0 ? num(o.ageMs) : null,
    simulee: typeof o.simulee === "boolean" ? o.simulee : null,
    methode: typeof o.methode === "string" ? o.methode.slice(0, 40) : null,
  };
}

interface Anomalie { statut: StatutLoc; validation: Validation; code: string }

export function verifierLocalisation(e: {
  permission: PermissionLoc; position: PositionRecue | null; zone: ZoneLoc | null;
  maintenant: Date; params?: ParamsLoc;
}): VerdictLoc {
  const params = e.params ?? PARAMS_LOC_DEFAUT;
  const { zone, position } = e;
  if (!zone) return { statut: "zone_inconnue", validation: "refuse", code: "zone_inconnue", ...vide(null) };
  if (!zone.actif) return { statut: "zone_inactive", validation: "refuse", code: "zone_inactive", ...vide(zone) };
  if (e.permission === "refusee") return { statut: "refusee", validation: "refuse", code: "permission_refusee", ...vide(zone) };
  if (e.permission === "indisponible" || !position) {
    return { statut: "indisponible", validation: "refuse", code: "gps_indisponible", ...vide(zone) };
  }

  const distanceM = haversineMeters(
    { lat: position.latitude, lng: position.longitude },
    { lat: zone.latitude, lng: zone.longitude },
  );
  // Une distance non calculable ne doit JAMAIS conduire à une acceptation.
  if (!Number.isFinite(distanceM)) return { statut: "indisponible", validation: "refuse", code: "gps_indisponible", ...vide(zone) };
  const ecartZoneM = Math.max(0, distanceM - zone.rayonM);
  const issues: Anomalie[] = [];

  // L'horloge du téléphone n'est pas fiable : l'âge mesuré sur l'appareil (ageMs) est utilisé en priorité.
  const age = position.ageMs ?? (position.collecteeLe ? e.maintenant.getTime() - position.collecteeLe.getTime() : null);
  if (age === null || age > params.ageMaxS * 1000 || age < -params.avanceMaxS * 1000) {
    issues.push({ statut: "ancienne", validation: "refuse", code: "position_ancienne" });
  }
  if (!(distanceM <= zone.rayonM)) {
    issues.push({ statut: "hors_zone", validation: zone.horsZoneAction === "refuser" ? "refuse" : "a_verifier", code: "hors_zone" });
  }
  if (position.precisionM === null || position.precisionM > zone.precisionMaxM) {
    issues.push({ statut: "precision_insuffisante", validation: params.precisionAction === "refuser" ? "refuse" : "a_verifier", code: "precision_insuffisante" });
  }
  if (position.simulee === true) issues.push({ statut: "suspecte", validation: "a_verifier", code: "position_suspecte" });

  const retenue = issues.find((i) => i.validation === "refuse") ?? issues.find((i) => i.validation === "a_verifier");
  return {
    statut: retenue?.statut ?? "dans_zone",
    validation: retenue?.validation ?? "accepte",
    code: retenue?.code ?? null,
    distanceM, ecartZoneM, precisionM: position.precisionM, nomZone: zone.nom,
    positionSuspecte: position.simulee === true,
  };
}

