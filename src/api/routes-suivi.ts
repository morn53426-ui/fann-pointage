// Routes de suivi du mode démo : historique personnel, tableau de bord, anomalies, rapports (JSON et CSV) et validation manuelle d'un pointage.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { calculerTableauDeBord } from "../dashboard/indicateurs.ts";
import { detecterAnomalies } from "../anomalies/detection.ts";
import { exporterCsv, genererRapport } from "../rapports/rapport.ts";
import { validerManuellement } from "../pointage/manuel.ts";
import type { ActeurApp } from "../dashboard/donnees.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";
import { json, objet } from "./reponses.ts";
import { dateCle, filtres, typeRapport } from "./parametres-requete.ts";

export async function routeSuivi(req: Requete, user: Utilisateur, acteur: ActeurApp, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  if (chemin === "/api/historique" && methode === "GET") {
    if (!user.agentId) throw new ErreurRegime("non_autorise", "Ce compte n'est associé à aucun agent");
    const r = genererRapport(m.donnees(), { id: user.id, role: "brancardier", servicesGeres: [], agentId: user.agentId }, typeRapport(req.requete), dateCle(req.requete, now), now);
    return json(200, { ...r, synthese: undefined });
  }

  if (chemin === "/api/tableau-de-bord" && methode === "GET") {
    return json(200, calculerTableauDeBord(m.donnees(), acteur, now, filtres(req.requete)));
  }

  if (chemin === "/api/anomalies" && methode === "GET") {
    const noms = new Map(m.infosAgents.map((a) => [a.id, `${a.prenom} ${a.nom}`] as const));
    return json(200, { anomalies: detecterAnomalies(m.donnees(), acteur, now, filtres(req.requete)).map((a) => ({ ...a, agent: noms.get(a.agentId) ?? a.agentId })) });
  }

  if (chemin === "/api/rapports" && methode === "GET") {
    const r = genererRapport(m.donnees(), acteur, typeRapport(req.requete), dateCle(req.requete, now), now, filtres(req.requete));
    const format = req.requete.format ?? "json";
    if (format === "csv" || format === "synthese-csv") {
      if (user.role === "brancardier" && format === "synthese-csv") throw new ErreurRegime("non_autorise", "Synthèse réservée aux responsables");
      const { nomFichier, csv } = exporterCsv(r, acteur, format === "csv" ? "lignes" : "synthese");
      return { statut: 200, texte: csv, typeContenu: "text/csv; charset=utf-8", entetes: { "Content-Disposition": `attachment; filename="${nomFichier}"` } };
    }
    return json(200, user.role === "brancardier" ? { ...r, synthese: undefined } : r);
  }

  const val = /^\/api\/pointages\/([A-Za-z0-9_-]{1,64})\/validation$/.exec(chemin);
  if (val && methode === "POST") {
    const motif = objet(req.corps).motif;
    const p = await validerManuellement(m, acteur, val[1], typeof motif === "string" ? motif : "");
    return json(200, { id: p.id, validation: p.validation });
  }
  return undefined;
}
