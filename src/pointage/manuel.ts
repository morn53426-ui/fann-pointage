// Validation manuelle exceptionnelle d'un pointage refusé ou à vérifier (hors zone, sans GPS...).
import { ErreurRegime } from "../shared/types.ts";
import type { EvenementSecurite, PointageEnregistre } from "./service.ts";

export interface Acteur { id: string; role: "administrateur" | "responsable" | "brancardier"; servicesGeres: readonly string[] }

export interface DepotsManuel {
  maintenant(): Date;
  pointageParId(id: string): Promise<PointageEnregistre | null>;
  marquerValideManuellement(id: string, acteurId: string, motif: string, at: Date): Promise<PointageEnregistre>;
  journaliser(e: EvenementSecurite): Promise<void>;
}

export async function validerManuellement(d: DepotsManuel, acteur: Acteur, pointageId: string, motif: string): Promise<PointageEnregistre> {
  if (acteur.role === "brancardier") {
    await d.journaliser({ type: "validation_manuelle_refusee", agentId: null, at: d.maintenant(), detail: { acteurId: acteur.id, pointageId } });
    throw new ErreurRegime("non_autorise", "Validation réservée aux responsables du service ou à l'administrateur");
  }
  const p = await d.pointageParId(pointageId);
  if (!p) throw new ErreurRegime("introuvable", "Pointage introuvable");
  const droit = acteur.role === "administrateur" || (acteur.role === "responsable" && acteur.servicesGeres.includes(p.serviceId));
  if (!droit) {
    await d.journaliser({ type: "validation_manuelle_refusee", agentId: p.agentId, at: d.maintenant(), detail: { acteurId: acteur.id, pointageId } });
    throw new ErreurRegime("non_autorise", "Validation réservée aux responsables du service ou à l'administrateur");
  }
  if (!motif || motif.trim() === "") throw new ErreurRegime("motif_obligatoire", "Motif obligatoire");
  if (p.validation !== "refuse" && p.validation !== "a_verifier") {
    throw new ErreurRegime("non_modifiable", `Pointage déjà définitif (${p.validation})`);
  }
  const at = d.maintenant();
  const maj = await d.marquerValideManuellement(pointageId, acteur.id, motif.trim(), at);
  await d.journaliser({ type: "validation_manuelle", agentId: p.agentId, at, detail: { acteurId: acteur.id, pointageId, motif: motif.trim(), ancienStatut: p.validation } });
  return maj;
}
