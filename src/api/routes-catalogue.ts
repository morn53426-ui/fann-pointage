// Routes du registre PostgreSQL (agents, services, comptes agents) en mode « catalogue » : toute mutation est autorisée côté serveur
// uniquement à l'administrateur ; aucune donnée fictive n'est utilisée.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { ErreurRegime } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";
import type { Contexte, Reponse, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";
import { json, objet } from "./reponses.ts";

/** Phrase ajoutée au message de création/modification d'une fiche agent selon le sort du compte de connexion. */
function texteCompteAgent(r: import("./auth-postgres.ts").ResultatCompteAgent | undefined): string {
  if (!r) return "";
  if (r.cree && r.motDePasseProvisoire) return ` Compte de connexion créé : identifiant = matricule (« ${r.identifiant} »), code provisoire généré (affiché une seule fois) ; l’agent devra le changer à sa première connexion.`;
  if (r.cree) return ` Compte de connexion créé : identifiant = matricule (« ${r.identifiant} »), mot de passe provisoire = numéro de téléphone ; l’agent devra le changer à sa première connexion.`;
  const raisons: Record<string, string> = {
    matricule_absent: " Aucun compte de connexion créé : matricule manquant.",
    matricule_trop_court: " Aucun compte de connexion créé : le matricule doit contenir au moins 3 caractères.",
    telephone_absent: " Aucun compte de connexion créé : téléphone manquant ou trop court (6 chiffres minimum).",
    identifiant_deja_utilise: " Aucun compte de connexion créé : cet identifiant est déjà utilisé par un autre compte.",
  };
  return raisons[r.raison] ?? "";
}

/** `routeCatalogueAutorisee` : la route demandée fait partie de celles du registre (calculée par le routeur avant le contrôle d'accès). */
export async function routeCatalogue(ctx: Contexte, req: Requete, user: Utilisateur, routeCatalogueAutorisee: boolean): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  const cheminAgent = /^\/api\/agents\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminService = /^\/api\/services\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  // Gestion réelle du registre PostgreSQL. Toute mutation est autorisée côté serveur uniquement à l'administrateur.
  if (ctx.cataloguePersistant && routeCatalogueAutorisee) {
    if (chemin === "/api/agents" && methode === "GET") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Gestion des agents réservée à l'administrateur.");
      const [agents, services] = await Promise.all([ctx.cataloguePersistant.listerAgents(), ctx.cataloguePersistant.listerServices()]);
      return json(200, { agents, services, source: "postgresql", fictif: false });
    }
    if (chemin === "/api/agents" && methode === "POST") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Création des agents réservée à l'administrateur.");
      const c = objet(req.corps);
      const { compteAgent, ...agent } = await ctx.cataloguePersistant.creerAgent({
        prenom: typeof c.prenom === "string" ? c.prenom : "", nom: typeof c.nom === "string" ? c.nom : "",
        matricule: c.matricule === null || typeof c.matricule === "string" ? c.matricule : null,
        serviceId: typeof c.serviceId === "string" ? c.serviceId : "", regime: typeof c.regime === "string" ? c.regime as Regime : "" as Regime,
        photoDataUrl: c.photoDataUrl === null || typeof c.photoDataUrl === "string" ? c.photoDataUrl : null,
        serviceNom: typeof c.serviceNom === "string" ? c.serviceNom : null,
        profession: typeof c.profession === "string" ? c.profession : null,
        adresse: typeof c.adresse === "string" ? c.adresse : null,
        telephone: typeof c.telephone === "string" ? c.telephone : null,
      }, user.id, req.ip);
      return json(201, { agent, compteAgent: compteAgent ?? null, message: "Fiche agent enregistrée dans PostgreSQL." + texteCompteAgent(compteAgent) });
    }
    if (cheminAgent && methode === "PATCH") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Modification des agents réservée à l'administrateur.");
      const c = objet(req.corps);
      const changements: Record<string, unknown> = {};
      for (const k of ["prenom", "nom", "matricule", "serviceId", "regime", "actif", "photoDataUrl", "profession", "adresse", "telephone"]) if (c[k] !== undefined) changements[k] = c[k];
      const { compteAgent, ...agent } = await ctx.cataloguePersistant.modifierAgent(chemin.slice("/api/agents/".length), changements as import("./catalogue-postgres.ts").ModifAgent, user.id, req.ip);
      return json(200, { agent, compteAgent: compteAgent ?? null, message: "Fiche agent mise à jour dans PostgreSQL." + texteCompteAgent(compteAgent) });
    }
    if (cheminAgent && methode === "DELETE") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Désactivation des agents réservée à l'administrateur.");
      const { compteAgent: _ignore, ...agent } = await ctx.cataloguePersistant.modifierAgent(chemin.slice("/api/agents/".length), { actif: false }, user.id, req.ip);
      return json(200, { succes: true, agent, message: "Agent désactivé. L'historique des affectations et pointages est conservé." });
    }
    if (chemin === "/api/services" && methode === "GET") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Gestion des services réservée à l'administrateur.");
      return json(200, { services: await ctx.cataloguePersistant.listerServices(), source: "postgresql", fictif: false });
    }
    if (chemin === "/api/services" && methode === "POST") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Création des services réservée à l'administrateur.");
      const c = objet(req.corps);
      const service = await ctx.cataloguePersistant.creerService({ nom: typeof c.nom === "string" ? c.nom : "", regimeDefaut: typeof c.regimeDefaut === "string" ? c.regimeDefaut as Regime : "" as Regime }, user.id, req.ip);
      return json(201, { service, message: "Service enregistré dans PostgreSQL." });
    }
    if (cheminService && methode === "PATCH") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Modification des services réservée à l'administrateur.");
      const c = objet(req.corps);
      const changements: Record<string, unknown> = {};
      for (const k of ["nom", "regimeDefaut", "actif"]) if (c[k] !== undefined) changements[k] = c[k];
      const service = await ctx.cataloguePersistant.modifierService(chemin.slice("/api/services/".length), changements as import("./catalogue-postgres.ts").ModifService, user.id, req.ip);
      return json(200, { service, message: "Service mis à jour dans PostgreSQL." });
    }
    if (cheminService && methode === "DELETE") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Suppression des services réservée à l'administrateur.");
      const service = await ctx.cataloguePersistant.modifierService(chemin.slice("/api/services/".length), { actif: false }, user.id, req.ip);
      return json(200, { succes: true, service, message: "Service archivé. L'historique n'est pas supprimé." });
    }
    if (chemin === "/api/comptes-agents" && methode === "POST") {
      if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Création des comptes agents réservée à l'administrateur.");
      if (!ctx.cataloguePersistant.creerComptesAgentsManquants) return json(503, { erreur: "migration_metier_incomplete", message: "La création des comptes agents n’est pas raccordée au stockage PostgreSQL." });
      const bilan = await ctx.cataloguePersistant.creerComptesAgentsManquants(user.id, req.ip);
      return json(200, { ...bilan, message: `${bilan.crees} compte(s) agent créé(s) ; ${bilan.ignores.length} agent(s) ignoré(s) (matricule ou téléphone manquant, identifiant déjà pris).` });
    }
    return json(503, { erreur: "migration_metier_incomplete", message: "Cette fonction n'est pas encore raccordée à PostgreSQL ; aucune donnée fictive n'est utilisée." });
  }

  return undefined;
}
