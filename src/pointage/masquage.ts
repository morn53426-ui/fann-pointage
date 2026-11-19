// Masquage des données de localisation pour les écrans, rapports et exports (même règle que la vue SQL v_pointages).
import type { PointageEnregistre } from "./service.ts";
import type { Acteur } from "./manuel.ts";

export interface VuePointage {
  id: string; agentId: string; serviceId: string; type: string; serverTs: string; validation: string;
  statutLocalisation: string; motifRefus: string | null;
  latitude: number | null; longitude: number | null; distanceM: number | null; precisionM: number | null;
}

/** null = l'acteur ne doit pas voir ce pointage. Coordonnées exactes : administrateur seulement. */
export function vuePointage(p: PointageEnregistre, voit: Acteur & { agentId?: string }): VuePointage | null {
  const admin = voit.role === "administrateur";
  const resp = voit.role === "responsable" && voit.servicesGeres.includes(p.serviceId);
  const soi = voit.agentId === p.agentId;
  if (!admin && !resp && !soi) return null;
  const detail = admin || resp || soi;
  return {
    id: p.id, agentId: p.agentId, serviceId: p.serviceId, type: p.type, serverTs: p.serverTs.toISOString(),
    validation: p.validation, statutLocalisation: p.statutLocalisation, motifRefus: p.motifRefus,
    latitude: admin ? p.latitude : null, longitude: admin ? p.longitude : null,
    distanceM: detail ? p.distanceM : null, precisionM: detail ? p.precisionM : null,
  };
}
