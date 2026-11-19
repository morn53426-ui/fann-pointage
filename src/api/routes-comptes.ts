// Routes de gestion des comptes (/api/utilisateurs) : liste, création, réinitialisation de mot de passe, réactivation et désactivation.
// Réservées à l'administrateur ; PostgreSQL en mode persistant, magasin local uniquement en mode démo.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { randomUUID } from "node:crypto";
import { ErreurRegime } from "../shared/types.ts";
import type { Contexte, Reponse, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";
import { hashMotDePasseAsync } from "./auth.ts";
import { controlerMotDePasse, provisoireExpire } from "./mot-de-passe.ts";
import { json, objet } from "./reponses.ts";

/** Convertit uniquement les erreurs métier connues en messages client sûrs ; les erreurs SQL restent des 500 génériques. */
function erreurCompteDepuisDepot(e: unknown): ErreurRegime | null {
  if (e instanceof ErreurRegime) return e;
  const message = e instanceof Error ? e.message : "";
  const conflits = [
    "Cet identifiant est déjà utilisé.",
    "Un élément du compte existe déjà.",
    "Cet agent est déjà associé à un compte.",
    "Impossible de désactiver le dernier compte administrateur actif.",
    "Impossible de réactiver ce compte : la fiche de l’agent est absente ou désactivée.",
    "Cette modification entre en conflit avec une contrainte de compte.",
  ];
  const invalides = [
    "L’identifiant doit contenir entre 3 et 80 caractères valides.",
    "Le mot de passe doit être fourni sous forme de hash scrypt valide.",
    "Rôle de compte invalide.",
    "Identifiant agent PostgreSQL invalide.",
    "Identifiant service PostgreSQL invalide.",
    "Un compte brancardier doit être lié à une fiche agent.",
    "Un responsable doit gérer au moins un service.",
    "Seul un responsable peut recevoir des services gérés.",
    "Sélectionnez une fiche agent active.",
    "Un ou plusieurs services sont inconnus ou désactivés.",
    "Aucune modification demandée.",
  ];
  if (conflits.includes(message)) return new ErreurRegime("conflit", message);
  if (invalides.includes(message)) return new ErreurRegime("requete_invalide", message);
  return null;
}

export async function routeComptes(ctx: Contexte, req: Requete, user: Utilisateur, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  const m = ctx.magasin;
  // Gestion des comptes : PostgreSQL en mode persistant, magasin local uniquement en mode démo.
  if (chemin === "/api/utilisateurs" && methode === "GET") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Gestion des comptes réservée à l'administrateur.");
    if (ctx.authentificationPersistante) {
      if (!ctx.authentificationPersistante.lister) return json(503, { erreur: "migration_metier_incomplete", message: "La liste des comptes n’est pas raccordée au stockage PostgreSQL." });
      const utilisateurs = (await ctx.authentificationPersistante.lister()).map((u) => ({ id: u.id, identifiant: u.identifiant, role: u.role, agentId: u.agentId, servicesGeres: u.servicesGeres, actif: u.actif, doitChangerMotDePasse: u.doitChangerMotDePasse === true, provisoireExpire: provisoireExpire(u, now) }));
      return json(200, { utilisateurs, mode: "postgresql", source: "postgresql", fictif: false });
    }
    const utilisateurs = [...m.utilisateurs.values()].map((u) => ({ id: u.id, identifiant: u.identifiant, role: u.role, agentId: u.agentId, servicesGeres: u.servicesGeres, actif: u.actif }));
    return json(200, { utilisateurs, mode: "demo-local", note: "Les mots de passe sont hachés en scrypt. Ce mode est réservé à la démonstration." });
  }
  if (chemin === "/api/utilisateurs" && methode === "POST") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut créer les comptes.");
    const c = objet(req.corps);
    const identifiant = typeof c.identifiant === "string" ? c.identifiant.trim().toLowerCase() : "";
    const motDePasse = typeof c.motDePasse === "string" ? c.motDePasse : "";
    const role = c.role;
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(identifiant)) throw new ErreurRegime("requete_invalide", "Identifiant : 3 à 80 caractères, lettres sans accent, chiffres, point, tiret ou souligné.");
    if (role !== "administrateur" && role !== "responsable" && role !== "brancardier") throw new ErreurRegime("requete_invalide", "Choisissez administrateur, responsable ou brancardier.");
    const erreurMdp = controlerMotDePasse(role, motDePasse, "provisoire");
    if (erreurMdp) throw new ErreurRegime("requete_invalide", erreurMdp);
    let agentId: string | null = null;
    let servicesGeres: string[] = [];
    if (role === "brancardier") {
      agentId = typeof c.agentId === "string" ? c.agentId : "";
      if (!agentId) throw new ErreurRegime("requete_invalide", "Sélectionnez une fiche agent active.");
      if (!ctx.authentificationPersistante) {
        const agent = m.infosAgents.find((a) => a.id === agentId && a.actif);
        if (!agent) throw new ErreurRegime("introuvable", "Sélectionnez un agent actif.");
        if ([...m.utilisateurs.values()].some((u) => u.actif && u.role === "brancardier" && u.agentId === agentId)) throw new ErreurRegime("conflit", "Cet agent possède déjà un compte actif.");
      }
    } else if (role === "responsable") {
      const demande = Array.isArray(c.servicesGeres) ? c.servicesGeres.filter((x): x is string => typeof x === "string") : [];
      servicesGeres = [...new Set(demande)];
      if (!servicesGeres.length) throw new ErreurRegime("requete_invalide", "Choisissez au moins un service valide pour ce responsable.");
      if (!ctx.authentificationPersistante && servicesGeres.some((id) => !m.services.some((s) => s.id === id))) throw new ErreurRegime("requete_invalide", "Choisissez des services valides pour ce responsable.");
    }

    if (ctx.authentificationPersistante) {
      if (!ctx.authentificationPersistante.creer) return json(503, { erreur: "migration_metier_incomplete", message: "La création des comptes n’est pas raccordée au stockage PostgreSQL." });
      try {
        const compte = await ctx.authentificationPersistante.creer({ identifiant, hash: await hashMotDePasseAsync(motDePasse), role, agentId, servicesGeres, doitChangerMotDePasse: role !== "administrateur" }, user.id, req.ip);
        return json(201, { succes: true, utilisateur: { id: compte.id, identifiant: compte.identifiant, role: compte.role, agentId: compte.agentId, servicesGeres: compte.servicesGeres, actif: compte.actif }, source: "postgresql", message: "Compte créé dans PostgreSQL. Communiquez le mot de passe initial par un canal privé et demandez son remplacement selon la procédure interne." });
      } catch (e) { const erreurSecurisee = erreurCompteDepuisDepot(e); if (erreurSecurisee) throw erreurSecurisee; throw e; }
    }

    if (m.utilisateurParIdentifiant(identifiant)) throw new ErreurRegime("conflit", "Cet identifiant existe déjà.");
    const compte = { id: randomUUID(), identifiant, hash: await hashMotDePasseAsync(motDePasse), role: role as Utilisateur["role"], agentId, servicesGeres, actif: true } as Utilisateur;
    try { await m.ajouterUtilisateurManuel(compte); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Création du compte impossible."); }
    await m.journaliser({ type: "compte_utilisateur_cree", agentId, at: now, detail: { auteurId: user.id, identifiant, role, servicesGeres } });
    return json(201, { succes: true, utilisateur: { id: compte.id, identifiant, role, agentId, servicesGeres, actif: true }, message: "Compte créé. Communiquez le mot de passe initial par un canal privé et demandez son remplacement selon la procédure interne." });
  }
  const matchUtilisateur = /^\/api\/utilisateurs\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
  if (matchUtilisateur && methode === "PATCH") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut réinitialiser un mot de passe ou réactiver un compte.");
    const c = objet(req.corps);
    const changements: { hash?: string; actif?: boolean; doitChanger?: boolean } = {};
    if (c.motDePasse !== undefined) {
      // La règle dépend du rôle du compte visé : 9 caractères minimum pour un administrateur.
      const cible = ctx.authentificationPersistante ? await ctx.authentificationPersistante.parId(matchUtilisateur[1]!) : m.utilisateurs.get(matchUtilisateur[1]!);
      if (!cible) throw new ErreurRegime("introuvable", "Compte utilisateur introuvable.");
      const erreurMdp = controlerMotDePasse(cible.role, c.motDePasse, "provisoire");
      if (erreurMdp) throw new ErreurRegime("requete_invalide", erreurMdp);
      changements.hash = await hashMotDePasseAsync(c.motDePasse as string);
      // Mot de passe connu de l'administrateur : provisoire, sauf pour son propre compte.
      changements.doitChanger = cible.id !== user.id;
    }
    if (c.actif !== undefined) {
      if (typeof c.actif !== "boolean") throw new ErreurRegime("requete_invalide", "Le champ actif doit être vrai ou faux.");
      if (!c.actif && matchUtilisateur[1] === user.id) throw new ErreurRegime("conflit", "Vous ne pouvez pas désactiver votre propre compte depuis cette session.");
      changements.actif = c.actif;
    }
    if (changements.hash === undefined && changements.actif === undefined) throw new ErreurRegime("requete_invalide", "Aucune modification demandée.");
    if (ctx.authentificationPersistante) {
      if (!ctx.authentificationPersistante.modifierCompte) return json(503, { erreur: "migration_metier_incomplete", message: "La modification des comptes n’est pas raccordée au stockage PostgreSQL." });
      try {
        const compte = await ctx.authentificationPersistante.modifierCompte(matchUtilisateur[1], changements, user.id, req.ip);
        if (!compte) throw new ErreurRegime("introuvable", "Compte utilisateur introuvable.");
        return json(200, { succes: true, source: "postgresql", message: changements.hash ? "Mot de passe réinitialisé ; les sessions précédentes sont révoquées." : changements.actif ? "Compte réactivé." : "Compte mis à jour." });
      } catch (e) { const erreurSecurisee = erreurCompteDepuisDepot(e); if (erreurSecurisee) throw erreurSecurisee; throw e; }
    }
    try { await m.modifierUtilisateurManuel(matchUtilisateur[1], changements); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Modification du compte impossible."); }
    await m.journaliser({ type: changements.hash ? "mot_de_passe_reinitialise" : changements.actif ? "compte_utilisateur_reactive" : "compte_utilisateur_modifie", agentId: null, at: now, detail: { auteurId: user.id, compteId: matchUtilisateur[1], actif: changements.actif ?? null } });
    return json(200, { succes: true, message: changements.hash ? "Mot de passe réinitialisé. Communiquez-le par un canal privé." : changements.actif ? "Compte réactivé." : "Compte mis à jour." });
  }
  if (matchUtilisateur && methode === "DELETE") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut désactiver un compte.");
    if (matchUtilisateur[1] === user.id) throw new ErreurRegime("conflit", "Vous ne pouvez pas désactiver votre propre compte depuis cette session.");
    if (ctx.authentificationPersistante) {
      const depositaire = ctx.authentificationPersistante.modifierCompte;
      if (!depositaire) return json(503, { erreur: "migration_metier_incomplete", message: "La désactivation des comptes n’est pas raccordée au stockage PostgreSQL." });
      try {
        const compte = await depositaire.call(ctx.authentificationPersistante, matchUtilisateur[1], { actif: false }, user.id, req.ip);
        if (!compte) throw new ErreurRegime("introuvable", "Compte utilisateur introuvable.");
      } catch (e) { const erreurSecurisee = erreurCompteDepuisDepot(e); if (erreurSecurisee) throw erreurSecurisee; throw e; }
      return json(200, { succes: true, source: "postgresql", message: "Compte désactivé et sessions révoquées. Les nouvelles requêtes seront refusées." });
    }
    try { await m.desactiverUtilisateurManuel(matchUtilisateur[1]); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Désactivation impossible."); }
    await m.journaliser({ type: "compte_utilisateur_desactive", agentId: null, at: now, detail: { auteurId: user.id, compteId: matchUtilisateur[1] } });
    return json(200, { succes: true, message: "Compte désactivé. Les nouvelles requêtes de ce compte seront refusées." });
  }

  return undefined;
}
