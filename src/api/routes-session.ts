// Routes d'identité et de session : connexion (limitation des tentatives, mot de passe provisoire), déconnexion serveur, déblocage d'un compte
// par l'administrateur, profil (/api/moi) et changement du mot de passe par l'utilisateur.
// Extraites de routes.ts ; même logique et mêmes droits. Les contrôles d'accès communs (session valide, mot de passe provisoire,
// routes autorisées par mode) restent dans le routeur. Retournent `undefined` quand la requête ne concerne pas ces routes.
import { ErreurRegime } from "../shared/types.ts";
import { creerSession, verifierMotDePasseAsync, hashMotDePasseAsync } from "./auth.ts";
import type { Utilisateur } from "./magasin.ts";
import { controlerMotDePasse, motDePasseDepuisTelephone, provisoireExpire, variantesMotDePasseProvisoire } from "./mot-de-passe.ts";
import type { Contexte, EvenementConnexion, Reponse, Requete } from "./routes.ts";
import { json, objet } from "./reponses.ts";

/** Un agent en garde reste connecté tout son poste (24 h + marge) ; administrateurs et responsables : 8 h. */
const dureeSessionS = (role: string): number => (role === "brancardier" ? 26 : 8) * 3600;
/** Échecs de connexion tolérés par compte sur 15 minutes, toutes adresses IP confondues (en plus de 5 par IP + compte). */
const SEUIL_ECHECS_GLOBAL_COMPTE = 30;

async function journaliserConnexion(ctx: Contexte, e: EvenementConnexion): Promise<void> {
  if (!ctx.journaliserConnexion) return;
  try { await ctx.journaliserConnexion(e); } catch { console.error("Journal de connexion indisponible."); }
}

/** Connexion (route publique) : retourne `undefined` si le chemin n'est pas /api/connexion. */
export async function routeConnexion(ctx: Contexte, req: Requete, now: Date): Promise<Reponse | undefined> {
  const m = ctx.magasin;
  const { methode, chemin } = req;
  if (chemin === "/api/connexion") {
    if (methode !== "POST") return json(405, { erreur: "methode_non_autorisee" });
    const c = objet(req.corps);
    const identifiantBrut = typeof c.identifiant === "string" ? c.identifiant : "";
    const motDePasse = typeof c.motDePasse === "string" ? c.motDePasse : "";
    // Ne pas tronquer silencieusement les identifiants/mots de passe : cela rendrait
    // certaines connexions impossibles et pourrait accepter un identifiant préfixe inattendu.
    if (identifiantBrut.length > 80 || motDePasse.length > 200) return json(400, { erreur: "identifiants_invalides", message: "Identifiant ou mot de passe trop long." });
    const identifiant = identifiantBrut;
    // Clé normalisée : « Admin », « admin » et « admin » + espaces comptent pour le même compte.
    const cle = `compte:${req.ip}|${identifiant.trim().toLowerCase()}`;
    const cleIp = `ip:${req.ip}`;
    // Limite par compte + limite commune par IP pour empêcher l'attaque par rotation d'identifiants.
    // Plafond global par compte (toutes adresses confondues) : une attaque répartie sur de nombreuses IP ne peut pas deviner un mot de passe.
    const cleGlobale = `global:${identifiant.trim().toLowerCase()}`;
    if (ctx.limiteur.bloque(cle, now) || ctx.limiteur.bloque(cleIp, now, 30) || ctx.limiteur.bloque(cleGlobale, now, SEUIL_ECHECS_GLOBAL_COMPTE)) return json(429, { erreur: "trop_de_tentatives", message: "Trop de tentatives. Réessayez plus tard." });
    const u = ctx.authentificationPersistante
      ? await ctx.authentificationPersistante.parIdentifiant(identifiant)
      : m.utilisateurParIdentifiant(identifiant);
    const hashVerifie = u?.hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    // Compte agent au mot de passe provisoire (téléphone) : le numéro peut être saisi avec espaces, tirets ou indicatif.
    const essais = u?.doitChangerMotDePasse && u.role === "brancardier" ? variantesMotDePasseProvisoire(motDePasse) : [motDePasse];
    let motDePasseOk = false;
    for (const essai of essais) motDePasseOk = (await verifierMotDePasseAsync(essai, hashVerifie)) || motDePasseOk;
    const ok = motDePasseOk && !!u && u.actif;
    if (!ok || !u) {
      ctx.limiteur.echec(cle, now); ctx.limiteur.echec(cleIp, now, 30); ctx.limiteur.echec(cleGlobale, now, SEUIL_ECHECS_GLOBAL_COMPTE);
      // Seul un compte existant est référencé (par son id) ; l'identifiant saisi n'est jamais journalisé.
      await journaliserConnexion(ctx, { userId: u?.id ?? null, action: "connexion_echec", ip: req.ip });
      return json(401, { erreur: "identifiants_invalides", message: "Identifiants invalides." });
    }
    if (ctx.cataloguePersistant && !ctx.operationsPersistantes && u.role !== "administrateur") return json(403, { erreur: "non_autorise", message: "Cette interface de gestion du registre est réservée à l’administrateur." });
    if (provisoireExpire(u, now)) {
      // Le mot de passe est correct mais son délai de 7 jours est dépassé : aucune session n'est créée.
      await journaliserConnexion(ctx, { userId: u.id, action: "connexion_provisoire_expiree", ip: req.ip });
      return json(403, { erreur: "mot_de_passe_provisoire_expire", message: "Votre mot de passe provisoire a expiré. Demandez à l’administrateur de le réinitialiser." });
    }
    ctx.limiteur.succes(cle);
    await journaliserConnexion(ctx, { userId: u.id, action: u.doitChangerMotDePasse ? "connexion_provisoire_reussie" : "connexion_reussie", ip: req.ip });
    return json(200, { jeton: creerSession(u.id, m.secretSession, now, dureeSessionS(u.role), u.sessionVersion ?? 0), role: u.role, doitChangerMotDePasse: u.doitChangerMotDePasse === true });
  }

  return undefined;
}

/** Déconnexion serveur et déblocage de compte (utilisateur déjà authentifié). */
export async function routeSessions(ctx: Contexte, req: Requete, user: Utilisateur, now: Date): Promise<Reponse | undefined> {
  const m = ctx.magasin;
  const { methode, chemin } = req;
  // Déconnexion : invalide le jeton côté serveur (version de session + 1). Les autres appareils du même compte devront se reconnecter.
  if (chemin === "/api/deconnexion") {
    if (methode !== "POST") return { statut: 405, corps: { erreur: "methode_non_autorisee" }, entetes: { Allow: "POST" } };
    if (ctx.authentificationPersistante) { if (!(await ctx.authentificationPersistante.revoquerSessions?.(user.id, user.id, req.ip))) return json(500, { erreur: "erreur_interne", message: "Déconnexion serveur impossible." }); }
    else user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    return json(200, { ok: true });
  }

  // Déblocage d'un compte verrouillé par le limiteur (5 échecs / 15 min) : réservé à l'administrateur, tracé dans le journal d'audit.
  if (chemin === "/api/connexions/debloquer") {
    if (methode !== "POST") return { statut: 405, corps: { erreur: "methode_non_autorisee" }, entetes: { Allow: "POST" } };
    if (user.role !== "administrateur") return json(403, { erreur: "non_autorise", message: "Déblocage réservé à l'administrateur." });
    const c = objet(req.corps);
    const identifiant = typeof c.identifiant === "string" ? c.identifiant.trim() : "";
    if (!identifiant || identifiant.length > 80) return json(400, { erreur: "requete_invalide", message: "Identifiant requis (80 caractères maximum)." });
    const cles = ctx.limiteur.reinitialiserCompte(identifiant);
    const cible = ctx.authentificationPersistante ? await ctx.authentificationPersistante.parIdentifiant(identifiant) : m.utilisateurParIdentifiant(identifiant);
    await journaliserConnexion(ctx, { userId: cible?.id ?? null, action: "connexion_debloquee", ip: req.ip });
    return json(200, { ok: true, debloque: cles > 0, message: cles > 0 ? "Compte débloqué : l'utilisateur peut se reconnecter." : "Aucun blocage en cours pour ce compte." });
  }

  return undefined;
}

/** Profil de l'utilisateur connecté (GET) et changement de son mot de passe (PATCH). */
export async function routeMoi(ctx: Contexte, req: Requete, user: Utilisateur, now: Date): Promise<Reponse | undefined> {
  const m = ctx.magasin;
  const { methode, chemin } = req;
  if (chemin === "/api/moi" && methode === "GET") {
    const services = ctx.authentificationPersistante
      ? await ctx.authentificationPersistante.servicesVisibles(user)
      : m.services.filter((s) => user.role === "administrateur" || user.servicesGeres.includes(s.id));
    return json(200, { id: user.id, identifiant: user.identifiant, role: user.role, agentId: user.agentId, doitChangerMotDePasse: user.doitChangerMotDePasse === true, services, mode: ctx.modeApplication ?? (ctx.cataloguePersistant ? "catalogue-postgres" : ctx.authentificationPersistante ? "postgres-auth" : "demo") });
  }

  // Changement de mot de passe par l'utilisateur lui-même (obligatoire tant que le mot de passe est provisoire).
  if (chemin === "/api/moi" && methode === "PATCH") {
    const c = objet(req.corps);
    const actuel = typeof c.motDePasseActuel === "string" ? c.motDePasseActuel : "";
    const nouveau = c.nouveauMotDePasse;
    if (!actuel || actuel.length > 200) throw new ErreurRegime("requete_invalide", "Saisissez votre mot de passe actuel.");
    const cleChangement = `changement-mdp:${user.id}`;
    if (ctx.limiteur.bloque(cleChangement, now)) return json(429, { erreur: "trop_de_tentatives", message: "Trop de tentatives. Réessayez plus tard." });
    const essais = user.doitChangerMotDePasse && user.role === "brancardier" ? variantesMotDePasseProvisoire(actuel) : [actuel];
    let actuelOk = false;
    for (const essai of essais) actuelOk = (await verifierMotDePasseAsync(essai, user.hash)) || actuelOk;
    if (!actuelOk) {
      ctx.limiteur.echec(cleChangement, now);
      return json(403, { erreur: "mot_de_passe_actuel_incorrect", message: "Le mot de passe actuel est incorrect." });
    }
    const erreurPolitique = controlerMotDePasse(user.role, nouveau, "personnel");
    if (erreurPolitique) throw new ErreurRegime("requete_invalide", erreurPolitique);
    const nouveauTexte = nouveau as string;
    const actuelNormalise = motDePasseDepuisTelephone(actuel), nouveauNormalise = motDePasseDepuisTelephone(nouveauTexte);
    if (essais.includes(nouveauTexte) || (actuelNormalise !== null && actuelNormalise === nouveauNormalise)) throw new ErreurRegime("requete_invalide", "Le nouveau mot de passe doit être différent de l’ancien (même écrit autrement, par exemple avec des espaces).");
    if (nouveauTexte.trim().toLowerCase() === user.identifiant.trim().toLowerCase()) throw new ErreurRegime("requete_invalide", "Le mot de passe ne peut pas être identique à votre identifiant.");
    let versionSession: number | null;
    if (ctx.authentificationPersistante) {
      if (!ctx.authentificationPersistante.changerMotDePassePropre) return json(503, { erreur: "migration_metier_incomplete", message: "Le changement de mot de passe n’est pas raccordé au stockage PostgreSQL." });
      versionSession = await ctx.authentificationPersistante.changerMotDePassePropre(user.id, await hashMotDePasseAsync(nouveauTexte), req.ip);
    } else {
      try { versionSession = (await m.modifierUtilisateurManuel(user.id, { hash: await hashMotDePasseAsync(nouveauTexte) })).sessionVersion ?? 0; }
      catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Changement du mot de passe impossible."); }
      const courant = m.utilisateurs.get(user.id); if (courant) courant.doitChangerMotDePasse = false;
      await m.journaliser({ type: "mot_de_passe_change_par_utilisateur", agentId: user.agentId, at: now, detail: { compteId: user.id } });
    }
    if (versionSession === null) throw new ErreurRegime("conflit", "Compte introuvable ou désactivé.");
    ctx.limiteur.succes(cleChangement);
    return json(200, { ok: true, jeton: creerSession(user.id, m.secretSession, now, dureeSessionS(user.role), versionSession), role: user.role, doitChangerMotDePasse: false, message: "Mot de passe modifié. Les autres appareils connectés à ce compte devront se reconnecter." });
  }

  return undefined;
}
