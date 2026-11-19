// Réponse de la route GET /api/emargement, partagée par le mode démo (routes.ts) et le mode PostgreSQL (operations-postgres.ts) :
// aperçu JSON de la feuille, ou classeur Excel (.xlsx en base64) avec un onglet par service.
import { construireXlsx, feuilleEmargementXlsx } from "../rapports/xlsx.ts";
import type { Emargement } from "../rapports/emargement.ts";
import { ErreurRegime } from "../shared/types.ts";
import type { Reponse } from "./routes.ts";

export const CSSI_PAR_DEFAUT = "Mme Paulette Flavine MENDY";

/** Nom de la CSSI imprimé en bas de feuille : sans caractères de contrôle ni chevrons, 80 caractères au plus. */
export function nomCssiSur(brut: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (brut ?? "").replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, 80) || CSSI_PAR_DEFAUT;
}

export function reponseEmargement(emargement: Emargement, requete: Record<string, string>): Reponse {
  if (requete.format !== "xlsx") return { statut: 200, corps: emargement };
  const feuilles = emargement.services.filter((f) => !requete.serviceId || f.serviceId === requete.serviceId);
  if (!feuilles.length) throw new ErreurRegime("introuvable", "Aucun service à exporter pour cette semaine.");
  const cssi = nomCssiSur(requete.cssi);
  const classeur = construireXlsx(feuilles.map((f) => feuilleEmargementXlsx(emargement, f, cssi)));
  return { statut: 200, corps: { nomFichier: `emargement-brancardiers-${emargement.debut}.xlsx`, contenuBase64: classeur.toString("base64") } };
}
