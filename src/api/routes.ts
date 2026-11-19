// Routes de l'API. Les droits sont TOUJOURS vérifiés ici (côté serveur) ; l'identité vient de la session, jamais du corps.
import { json } from "./reponses.ts";
import { routeJoursFeries } from "./routes-jours-feries.ts";
import { routeAbsences } from "./routes-absences.ts";
import { routeSuivi } from "./routes-suivi.ts";
import { routeBadges } from "./routes-badges.ts";
import { routePlannings } from "./routes-plannings.ts";
import { routeZonesQr } from "./routes-zones-qr.ts";
import { routeClassement } from "./routes-classement.ts";
import { routePointage } from "./routes-pointage.ts";
import { routeAgentsDemo } from "./routes-agents.ts";
import { routeComptes } from "./routes-comptes.ts";
import { routeCatalogue } from "./routes-catalogue.ts";
import { routeConnexion, routeSessions, routeMoi } from "./routes-session.ts";
import { randomUUID } from "node:crypto";
import { ErreurRegime } from "../shared/types.ts";
import type { ActeurApp } from "../dashboard/donnees.ts";
import { lireSessionAvecVersion, LimiteurTentatives, ErreurSurcharge } from "./auth.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { CataloguePersistant } from "./catalogue-postgres.ts";
import type { OperationsPostgres } from "./operations-postgres.ts";
import { provisoireExpire } from "./mot-de-passe.ts";

export interface AuthentificationPersistante {
  parIdentifiant(identifiant: string): Promise<Utilisateur | null>;
  parId(id: string): Promise<Utilisateur | null>;
  servicesVisibles(utilisateur: Utilisateur): Promise<{ id: string; nom: string }[]>;
  /** Méthodes de gestion des comptes disponibles dans le dépôt PostgreSQL complet. */
  lister?(): Promise<Utilisateur[]>;
  creer?(compte: { identifiant: string; hash: string; role: Utilisateur["role"]; agentId: string | null; servicesGeres?: string[]; doitChangerMotDePasse?: boolean }, acteurId?: string | null, ip?: string): Promise<Utilisateur>;
  modifierCompte?(id: string, changements: { hash?: string; actif?: boolean; doitChanger?: boolean }, acteurId?: string | null, ip?: string): Promise<Utilisateur | null>;
  /** Changement du mot de passe par l'utilisateur ; retourne la nouvelle version de session (null si le compte est introuvable ou inactif). */
  changerMotDePassePropre?(id: string, hash: string, ip?: string): Promise<number | null>;
  desactiver?(id: string, acteurId?: string | null, ip?: string): Promise<boolean>;
  /** Incrémente la version de session du compte (déconnexion serveur). */
  revoquerSessions?(id: string, acteurId?: string | null, ip?: string): Promise<boolean>;
}
export interface EvenementConnexion { userId: string | null; action: "connexion_reussie" | "connexion_echec" | "connexion_debloquee" | "connexion_provisoire_reussie" | "connexion_provisoire_expiree"; ip: string }
export interface Contexte {
  magasin: MagasinDemo;
  limiteur: LimiteurTentatives;
  maintenant(): Date;
  /** Option de transition réservée aux essais : les routes métier non migrées sont bloquées. */
  authentificationPersistante?: AuthentificationPersistante;
  /** Catalogue réel PostgreSQL (agents/services). */
  cataloguePersistant?: CataloguePersistant;
  /** Dépôt opérationnel PostgreSQL pour pointages, plannings, badges, QR et classements. */
  operationsPersistantes?: OperationsPostgres;
  modeApplication?: string;
  /** Journal d'audit des connexions (best-effort : une panne du journal ne bloque jamais la connexion). */
  journaliserConnexion?: (e: EvenementConnexion) => Promise<void>;
}

export interface Requete { methode: string; chemin: string; requete: Record<string, string>; corps: unknown; entetes: Record<string, string | undefined>; ip: string }
export interface Reponse { statut: number; corps?: unknown; texte?: string; typeContenu?: string; entetes?: Record<string, string> }

export const ENTETES_SECURITE: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), camera=(self)",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const STATUT_ERREUR: Record<string, number> = { non_autorise: 403, introuvable: 404, non_modifiable: 409, conflit: 409 };
const acteurDe = (u: Utilisateur): ActeurApp => ({ id: u.id, role: u.role, servicesGeres: u.servicesGeres, agentId: u.agentId ?? undefined });

/**
 * Journalise une erreur serveur (stdout/stderr du conteneur) avec une référence courte renvoyée au client.
 * Jamais de corps de requête, d'en-têtes, de paramètres d'URL ni de valeurs SQL : méthode, chemin, type d'erreur, code PostgreSQL, message tronqué et début de pile.
 */
export function journaliserErreurServeur(req: Pick<Requete, "methode" | "chemin" | "ip">, e: unknown): string {
  const reference = randomUUID().slice(0, 8);
  try {
    const err = e instanceof Error ? e : new Error(typeof e === "string" ? e : "Erreur non typée");
    const pg = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; constraint?: unknown; table?: unknown };
    const detail = [
      typeof pg.code === "string" ? `code=${pg.code}` : "",
      typeof pg.constraint === "string" ? `contrainte=${pg.constraint}` : "",
      typeof pg.table === "string" ? `table=${pg.table}` : "",
    ].filter(Boolean).join(" ");
    const message = err.message.replace(/\s+/g, " ").slice(0, 300);
    const pile = (err.stack ?? "").split("\n").slice(1, 5).map((l) => l.trim().replace(/^at\s+/, "")).join(" | ");
    console.error(`[ERREUR 500] ref=${reference} ${req.methode} ${req.chemin.slice(0, 120)} ip=${req.ip} ${err.name}${detail ? ` ${detail}` : ""} : ${message}${pile ? ` | ${pile}` : ""}`);
  } catch { console.error(`[ERREUR 500] ref=${reference} ${req.methode} (journalisation partielle)`); }
  return reference;
}

export async function gererRequete(ctx: Contexte, req: Requete): Promise<Reponse> {
  try {
    return await router(ctx, req);
  } catch (e) {
    if (e instanceof ErreurRegime) return json(STATUT_ERREUR[e.code] ?? 400, { erreur: e.code, message: e.message });
    // File de hachage pleine : le serveur reste disponible pour les pointages, la connexion est simplement refusée un instant.
    if (e instanceof ErreurSurcharge) return { statut: 503, corps: { erreur: "serveur_occupe", message: "Serveur momentanément occupé. Réessayez dans quelques secondes." }, entetes: { "Retry-After": "5" } };
    const reference = journaliserErreurServeur(req, e);
    return json(500, { erreur: "erreur_interne", message: "Erreur interne.", reference });  // aucun détail technique renvoyé au client
  }
}

async function router(ctx: Contexte, req: Requete): Promise<Reponse> {
  const now = ctx.maintenant();
  const m = ctx.magasin;
  const { methode, chemin } = req;

  const repConnexion = await routeConnexion(ctx, req, now);
  if (repConnexion) return repConnexion;

  if (!chemin.startsWith("/api/")) return json(404, { erreur: "introuvable" });

  // Toutes les autres routes exigent une session valide ET un compte encore actif (révocation immédiate).
  const auth = req.entetes.authorization;
  const session = lireSessionAvecVersion(auth?.startsWith("Bearer ") ? auth.slice(7) : undefined, m.secretSession, now);
  const user = session
    ? (ctx.authentificationPersistante
      ? (await ctx.authentificationPersistante.parId(session.utilisateurId) ?? undefined)
      : m.utilisateurs.get(session.utilisateurId))
    : undefined;
  if (!user || !user.actif || (user.sessionVersion ?? 0) !== session?.versionCompte) return json(401, { erreur: "non_authentifie", message: "Connexion requise ou session révoquée." });
  const acteur = acteurDe(user);

  // Mot de passe provisoire expiré (session ouverte avant l'échéance) : plus rien n'est autorisé, y compris le changement ; seule la déconnexion reste possible.
  if (provisoireExpire(user, now) && chemin !== "/api/deconnexion") {
    return json(403, { erreur: "mot_de_passe_provisoire_expire", message: "Votre mot de passe provisoire a expiré. Demandez à l’administrateur de le réinitialiser." });
  }

  // Mot de passe provisoire : tant qu'il n'est pas remplacé, seuls /api/moi (lecture et changement) et la déconnexion sont accessibles.
  if (user.doitChangerMotDePasse && chemin !== "/api/moi" && chemin !== "/api/deconnexion") {
    return json(403, { erreur: "changement_mot_de_passe_requis", message: "Vous devez d’abord remplacer votre mot de passe provisoire.", doitChangerMotDePasse: true });
  }

  const repSessions = await routeSessions(ctx, req, user, now);
  if (repSessions) return repSessions;

  // Ne jamais rediriger un compte PostgreSQL vers le magasin de démonstration.
  const routeCatalogueAutorisee = chemin === "/api/agents" || /^\/api\/agents\/[A-Za-z0-9_-]{1,64}$/.test(chemin)
    || chemin === "/api/services" || /^\/api\/services\/[A-Za-z0-9_-]{1,64}$/.test(chemin)
    || chemin === "/api/comptes-agents";
  const routeOperationsAutorisee = chemin === "/api/pointage" || chemin === "/api/pointage-station"
    || chemin === "/api/tableau-de-bord" || chemin === "/api/plannings" || /^\/api\/plannings\/[A-Za-z0-9_-]{1,100}$/.test(chemin)
    || chemin === "/api/jours-feries" || /^\/api\/jours-feries\/\d{4}-\d{2}-\d{2}$/.test(chemin)
    || chemin === "/api/badges" || /^\/api\/badges\/[A-Za-z0-9_-]{1,64}\/(emettre|renouveler|revoquer)$/.test(chemin)
    || chemin === "/api/zones" || /^\/api\/zones\/[A-Za-z0-9_-]{1,64}$/.test(chemin) || chemin === "/api/qr"
    || /^\/api\/pointages\/[A-Za-z0-9_-]{1,64}\/validation$/.test(chemin)
    || chemin === "/api/classement-mensuel" || chemin === "/api/classement-mensuel/generer"
    || chemin === "/api/historique" || chemin === "/api/anomalies" || chemin === "/api/compteurs"
    || /^\/api\/anomalies\/[A-Za-z0-9_-]{1,64}\/statut$/.test(chemin)
    || chemin === "/api/absences" || /^\/api\/absences\/[A-Za-z0-9_-]{1,64}$/.test(chemin)
    || chemin === "/api/rapports" || chemin === "/api/emargement"
    || chemin === "/api/messages" || chemin === "/api/messages/destinataires" || /^\/api\/messages\/[A-Za-z0-9_-]{1,64}\/lu$/i.test(chemin)
    || /^\/api\/messages\/[A-Za-z0-9_-]{1,64}$/.test(chemin)
    || chemin === "/api/sauvegarde/export";
  const routeComptesAutorisee = (chemin === "/api/utilisateurs" || /^\/api\/utilisateurs\/[A-Za-z0-9_-]{1,64}$/.test(chemin))
    && !!ctx.authentificationPersistante?.lister
    && !!ctx.authentificationPersistante?.creer
    && !!ctx.authentificationPersistante?.modifierCompte;
  const routePersistanteAutorisee = routeCatalogueAutorisee && !!ctx.cataloguePersistant
    || routeOperationsAutorisee && !!ctx.operationsPersistantes
    || routeComptesAutorisee;
  if (ctx.authentificationPersistante && chemin !== "/api/moi" && !routePersistanteAutorisee) {
    // Une route qui n'existe pas du tout répond 404 (et non 503 « migration incomplète », qui déclenche de fausses alertes de supervision).
    const premierSegment = /^\/api\/(absences|agents|anomalies|badges|classement-mensuel|comptes-agents|compteurs|connexions|emargement|historique|jours-feries|messages|plannings|pointage|pointage-station|pointages|qr|rapports|sauvegarde|services|tableau-de-bord|utilisateurs|zones)(\/|$)/;
    if (!premierSegment.test(chemin)) return json(404, { erreur: "introuvable", message: "Route inconnue." });
    return json(503, {
      erreur: "migration_metier_incomplete",
      message: "Les données de cette fonction ne sont pas encore migrées vers PostgreSQL ; aucune donnée de démonstration ne sera utilisée.",
    });
  }

  // Une route connue appelée avec une méthode inattendue répond 405 (avec Allow), pas 404.
  // Le contrôle a lieu après authentification pour ne pas faciliter l'énumération des routes privées.
  const methodesAutorisees: Record<string, string[]> = {
    "/api/moi": ["GET", "PATCH"],
    "/api/comptes-agents": ["POST"],
    "/api/agents": ["GET", "POST"],
    "/api/services": ["GET", "POST"],
    "/api/plannings": ["GET", "POST"],
    "/api/jours-feries": ["GET", "POST"],
    "/api/utilisateurs": ["GET", "POST"],
    "/api/connexions/debloquer": ["POST"],
    "/api/classement-mensuel": ["GET"],
    "/api/classement-mensuel/generer": ["POST"],
    "/api/pointage": ["POST"],
    "/api/pointage-station": ["POST"],
    "/api/badges": ["GET"],
    "/api/historique": ["GET"],
    "/api/tableau-de-bord": ["GET"],
    "/api/anomalies": ["GET"],
    "/api/compteurs": ["GET"],
    "/api/absences": ["GET", "POST"],
    "/api/rapports": ["GET"],
    "/api/emargement": ["GET"],
    "/api/messages": ["GET", "POST"],
    "/api/messages/destinataires": ["GET"],
    "/api/sauvegarde/export": ["GET"],
    "/api/zones": ["GET", "POST"],
    "/api/qr": ["GET"],
  };
  const cheminValidation = /^\/api\/pointages\/[A-Za-z0-9_-]{1,64}\/validation$/.test(chemin);
  const cheminAgent = /^\/api\/agents\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminService = /^\/api\/services\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminPlanning = /^\/api\/plannings\/[A-Za-z0-9_-]{1,100}$/.test(chemin);
  const cheminFerie = /^\/api\/jours-feries\/\d{4}-\d{2}-\d{2}$/.test(chemin);
  const cheminUtilisateur = /^\/api\/utilisateurs\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminAbsence = /^\/api\/absences\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminZone = /^\/api\/zones\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminActionBadge = /^\/api\/badges\/[A-Za-z0-9_-]{1,64}\/(emettre|renouveler|revoquer)$/.test(chemin);
  const cheminLectureMessage = /^\/api\/messages\/[A-Za-z0-9_-]{1,64}\/lu$/i.test(chemin);
  const cheminMessage = /^\/api\/messages\/[A-Za-z0-9_-]{1,64}$/.test(chemin);
  const cheminStatutAnomalie = /^\/api\/anomalies\/[A-Za-z0-9_-]{1,64}\/statut$/.test(chemin);
  const allow = methodesAutorisees[chemin] ?? (cheminStatutAnomalie ? ["POST"] : cheminValidation ? ["POST"] : cheminLectureMessage ? ["POST"] : cheminMessage ? ["DELETE"] : cheminAgent ? ["PATCH", "DELETE"] : cheminService ? ["PATCH", "DELETE"] : cheminPlanning ? ["PATCH", "DELETE"] : cheminFerie ? ["DELETE"] : cheminUtilisateur ? ["PATCH", "DELETE"] : cheminAbsence ? ["PATCH"] : cheminActionBadge ? ["POST"] : cheminZone ? ["PATCH"] : undefined);
  if (allow && !allow.includes(methode.toUpperCase())) {
    return { statut: 405, corps: { erreur: "methode_non_autorisee" }, entetes: { Allow: allow.join(", ") } };
  }

  const repMoi = await routeMoi(ctx, req, user, now);
  if (repMoi) return repMoi;

  // Toutes les routes opérationnelles passent par PostgreSQL avant tout gestionnaire démo.
  if (ctx.operationsPersistantes) {
    const persistante = await ctx.operationsPersistantes.gerer(req, user, now);
    if (persistante) return persistante;
  }

  const repCatalogue = await routeCatalogue(ctx, req, user, routeCatalogueAutorisee);
  if (repCatalogue) return repCatalogue;

  const repClassement = await routeClassement(req, user, acteur, m, now);
  if (repClassement) return repClassement;

  const repPointage = await routePointage(req, user, m, now);
  if (repPointage) return repPointage;

  const repAgents = await routeAgentsDemo(req, user, m, now);
  if (repAgents) return repAgents;

  const repComptes = await routeComptes(ctx, req, user, now);
  if (repComptes) return repComptes;

  const repFeries = await routeJoursFeries(req, user, m, now);
  if (repFeries) return repFeries;

  const repPlannings = await routePlannings(req, user, m, now);
  if (repPlannings) return repPlannings;

  const repBadges = await routeBadges(req, user, m, now);
  if (repBadges) return repBadges;

  const repSuivi = await routeSuivi(req, user, acteur, m, now);
  if (repSuivi) return repSuivi;

  const repAbsences = await routeAbsences(req, user, m, now);
  if (repAbsences) return repAbsences;

  const repZonesQr = routeZonesQr(req, user, m, now);
  if (repZonesQr) return repZonesQr;

  return json(404, { erreur: "introuvable" });
}
