// Routes des badges (/api/badges) du mode démo : liste des badges à imprimer et renouvellement d'un badge (administrateur uniquement).
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";
import { json } from "./reponses.ts";

export async function routeBadges(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  // Les agents de démonstration conservent leurs codes pédagogiques; les nouvelles fiches reçoivent un identifiant UUID imprévisible.
  if (chemin === "/api/badges" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Accès aux badges réservé aux responsables et à l'administrateur.");
    const badges = m.infosAgents
      .filter((a) => a.actif && (user.role === "administrateur" || user.servicesGeres.includes(a.serviceId)))
      .map(async (a) => ({
        agentId: a.id,
        serviceId: a.serviceId,
        matricule: a.matricule,
        nom: a.nom,
        prenom: a.prenom,
        service: m.services.find((s) => s.id === a.serviceId)?.nom ?? a.serviceId,
        regime: a.regime,
        profession: a.profession ?? null,
        adresse: a.adresse ?? null,
        telephone: a.telephone ?? null,
        badgeCode: await m.obtenirCodeBadge(a.id),
        photoDataUrl: m.photosAgents.get(a.id) ?? null,
      }));
    const badgesResolus = await Promise.all(badges);
    return json(200, { badges: badgesResolus, demonstration: true, note: "Les fiches et badges sont conservés dans le stockage local de démonstration. Ce stockage ne remplace pas une base transactionnelle de production." });
  }

  const renouvellementBadge = /^\/api\/badges\/([A-Za-z0-9_-]{1,64})\/renouveler$/.exec(chemin);
  if (renouvellementBadge && methode === "POST") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l’administrateur peut révoquer et renouveler un badge.");
    const agentId = renouvellementBadge[1];
    const agent = m.infosAgents.find((a) => a.id === agentId && a.actif);
    if (!agent || !m.estAgentManuel(agentId)) throw new ErreurRegime("introuvable", "Agent actif non renouvelable ou fiche de démonstration.");
    const badgeCode = await m.renouvelerCodeBadge(agentId);
    await m.journaliser({ type: "badge_renouvele", agentId, at: now, detail: { auteurId: user.id, serviceId: agent.serviceId } });
    return json(200, { succes: true, badgeCode, message: "Ancien QR révoqué. Imprimez et remettez le nouveau badge à l’agent." });
  }
  return undefined;
}
