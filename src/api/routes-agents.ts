// Routes des fiches d'agents du mode démo (/api/agents) : liste limitée au périmètre du responsable, création avec photo et badge,
// modification d'identité et désactivation (administrateur). Les données restent dans le magasin local du serveur de démonstration.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { randomUUID } from "node:crypto";
import { ErreurRegime } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { photoJpegValide } from "./photo.ts";
import { json, objet } from "./reponses.ts";

/** Champs imprimés sur le badge. `undefined` = non fourni (inchangé) ; chaîne vide = effacé. Refuse une valeur non textuelle ou invalide. */
function champsBadge(c: Record<string, unknown>): { profession?: string | null; adresse?: string | null; telephone?: string | null } {
  const lire = (cle: string, max: number, libelle: string): string | null | undefined => {
    const v = c[cle];
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") throw new ErreurRegime("requete_invalide", `${libelle} doit être du texte.`);
    const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (s.length > max) throw new ErreurRegime("requete_invalide", `${libelle} est limité à ${max} caractères.`);
    return s || null;
  };
  const telephone = lire("telephone", 30, "Le téléphone");
  if (telephone && !/^[0-9+()./ -]{3,30}$/.test(telephone)) throw new ErreurRegime("requete_invalide", "Le téléphone ne peut contenir que des chiffres, +, espaces, parenthèses, points et tirets (3 à 30 caractères).");
  return { profession: lire("profession", 60, "La profession"), adresse: lire("adresse", 160, "L'adresse"), telephone };
}

export async function routeAgentsDemo(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  // Gestion des fiches d'agents et de leurs badges (stockage local du serveur de démonstration).
  if (chemin === "/api/agents" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Gestion des agents réservée aux responsables et à l'administrateur.");
    const services = m.services.filter((s) => user.role === "administrateur" || user.servicesGeres.includes(s.id));
    const serviceIds = new Set(services.map((s) => s.id));
    const agents = m.infosAgents
      .filter((a) => serviceIds.has(a.serviceId) && a.actif)
      .map((a) => ({ ...a, service: m.services.find((s) => s.id === a.serviceId)?.nom ?? a.serviceId }));
    return json(200, { agents, services });
  }

  if (chemin === "/api/agents" && methode === "POST") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Création d'agents réservée aux responsables et à l'administrateur.");
    const c = objet(req.corps);
    const nettoyer = (v: unknown, limite: number) => typeof v === "string"
      ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limite)
      : "";
    const prenom = nettoyer(c.prenom, 80);
    const nom = nettoyer(c.nom, 80);
    const matriculeBrut = nettoyer(c.matricule, 40);
    const serviceId = nettoyer(c.serviceId, 80);
    const regimeBrut = nettoyer(c.regime, 20);
    const photoDataUrl = typeof c.photoDataUrl === "string" ? c.photoDataUrl : "";
    if (photoDataUrl && (photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl))) {
      throw new ErreurRegime("requete_invalide", "La photo doit être une image JPEG valide et compressée (maximum 80 Ko environ).");
    }
    if (!prenom || !nom) throw new ErreurRegime("requete_invalide", "Le prénom et le nom sont obligatoires.");
    if (c.prenom !== undefined && typeof c.prenom !== "string" || c.nom !== undefined && typeof c.nom !== "string") {
      throw new ErreurRegime("requete_invalide", "Le prénom et le nom doivent être du texte.");
    }
    if (!["general", "garde", "urgences", "mobil"].includes(regimeBrut)) throw new ErreurRegime("requete_invalide", "Choisissez un régime de service valide.");
    let service = m.services.find((s) => s.id === serviceId);
    if (serviceId === "__nouveau__") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut ajouter un nouveau service.");
      const serviceNom = nettoyer(c.serviceNom, 100);
      if (!serviceNom) throw new ErreurRegime("requete_invalide", "Saisissez le nom du nouveau service.");
      service = m.services.find((s) => s.nom.toLocaleLowerCase("fr") === serviceNom.toLocaleLowerCase("fr"));
      if (!service) {
        service = { id: randomUUID(), nom: serviceNom };
        await m.ajouterServiceManuellement(service);
      }
    }
    if (!service) throw new ErreurRegime("introuvable", "Service introuvable.");
    if (user.role === "responsable" && !user.servicesGeres.includes(service.id)) {
      throw new ErreurRegime("non_autorise", "Vous ne pouvez créer un agent que dans un service dont vous êtes responsable.");
    }
    if (matriculeBrut && m.infosAgents.some((a) => a.matricule?.toLocaleLowerCase("fr") === matriculeBrut.toLocaleLowerCase("fr"))) {
      throw new ErreurRegime("conflit", "Ce matricule est déjà utilisé.");
    }
    if (!photoDataUrl) throw new ErreurRegime("requete_invalide", "La photo de la personne est obligatoire pour créer un badge professionnel.");
    const agentId = randomUUID();
    const infosBadge = champsBadge(c);
    const agent = {
      id: agentId, nom, prenom, matricule: matriculeBrut || null, serviceId: service.id,
      regime: regimeBrut as Regime, actif: true,
      profession: infosBadge.profession ?? null, adresse: infosBadge.adresse ?? null, telephone: infosBadge.telephone ?? null,
    };
    // Fiche et photo sont écrites en une opération pour éviter un badge créé à moitié en cas d'erreur disque.
    await m.ajouterAgentManuellement(agent, photoDataUrl);
    await m.journaliser({ type: "agent_cree_pour_badge", agentId, at: now, detail: { auteurId: user.id, serviceId, matricule: agent.matricule, photoJointe: !!photoDataUrl } });
    return json(201, {
      agent: { ...agent, service: service.nom, badgeCode: await m.obtenirCodeBadge(agentId) },
      badgeCree: true,
      planningAConfigurer: true,
      message: "Fiche agent et badge créés. Configurez son planning avant les pointages pour éviter qu'ils soient classés à vérifier.",
    });
  }

  // Modification de l'identité d'une fiche active et désactivation sans effacer l'historique.
  const matchAgent = /^\/api\/agents\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
  if (matchAgent && methode === "PATCH") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Modification des agents réservée aux responsables et à l'administrateur.");
    const agentId = matchAgent[1];
    const existant = m.infosAgents.find((a) => a.id === agentId && a.actif);
    if (!existant) throw new ErreurRegime("introuvable", "Agent actif introuvable.");
    if (user.role === "responsable" && !user.servicesGeres.includes(existant.serviceId)) throw new ErreurRegime("non_autorise", "Agent hors de votre périmètre.");
    const c = objet(req.corps);
    const nettoyerIdentite = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
    const prenom = nettoyerIdentite(c.prenom, 80), nom = nettoyerIdentite(c.nom, 80);
    const matricule = nettoyerIdentite(c.matricule, 40) || null;
    if (!prenom || !nom) throw new ErreurRegime("requete_invalide", "Le prénom et le nom sont obligatoires.");
    const photoDataUrl = typeof c.photoDataUrl === "string" ? c.photoDataUrl : undefined;
    if (photoDataUrl && (photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl))) throw new ErreurRegime("requete_invalide", "Photo JPEG invalide ou trop volumineuse.");
    let agent;
    const infosBadge = champsBadge(c);
    try { agent = await m.modifierIdentiteAgent(agentId, { prenom, nom, matricule, ...infosBadge }, photoDataUrl); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Modification impossible."); }
    await m.journaliser({ type: "identite_agent_modifiee", agentId, at: now, detail: { auteurId: user.id, photoRemplacee: !!photoDataUrl } });
    return json(200, { agent: { ...agent, service: m.services.find((s) => s.id === agent.serviceId)?.nom ?? agent.serviceId } });
  }
  if (matchAgent && methode === "DELETE") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut désactiver une fiche agent.");
    const agentId = matchAgent[1];
    try { await m.desactiverAgentManuellement(agentId); }
    catch (e) { throw new ErreurRegime("introuvable", e instanceof Error ? e.message : "Agent introuvable."); }
    for (const [id, compte] of m.utilisateurs) if (compte.actif && compte.agentId === agentId) await m.desactiverUtilisateurManuel(id);
    await m.journaliser({ type: "agent_desactive", agentId, at: now, detail: { auteurId: user.id } });
    return json(200, { succes: true, message: "Agent désactivé. Son historique est conservé." });
  }

  return undefined;
}
