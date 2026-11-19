// Magasin en mémoire pour le serveur de développement et les tests (données FICTIVES).
import { DepotMemoire } from "../pointage/memoire.ts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { cle, civilDeInstant } from "../shared/civil.ts";
import type { DonneesPeriode, InfoAgent, InfoService } from "../dashboard/donnees.ts";
import type { Regime } from "../shared/types.ts";
import { REGLES_SCORE_DEFAUT } from "../classement/regles.ts";
import type { ClassementMensuel, ReglesScore } from "../classement/types.ts";
import type { EvenementSecurite, NouveauPointage, PointageEnregistre, PostePlanifie } from "../pointage/service.ts";
import { photoJpegValide } from "./photo.ts";

export interface JourFerie { date: string; nom: string; note: string | null; creePar: string; creeLe: string }
export type StatutAbsence = "a_confirmer" | "justifiee" | "injustifiee" | "refusee";
export interface AbsenceEnregistree {
  id: string; agentId: string; debut: string; fin: string; categorie: string; note: string | null;
  statut: StatutAbsence; creePar: string; creeLe: string; validePar: string | null;
  valideLe: string | null; motifValidation: string | null;
}

export interface Utilisateur {
  id: string; identifiant: string; hash: string; role: "administrateur" | "responsable" | "brancardier";
  agentId: string | null; servicesGeres: string[]; actif: boolean; sessionVersion?: number;
  /** Mot de passe provisoire : tant que vrai, l'API n'autorise que /api/moi (dont le changement de mot de passe) et la déconnexion. */
  doitChangerMotDePasse?: boolean;
  /** Date de pose du mot de passe provisoire (PostgreSQL) ; au-delà de DUREE_MOT_DE_PASSE_PROVISOIRE_JOURS, il n'est plus accepté. */
  provisoireDepuis?: Date | null;
}

export class MagasinDemo extends DepotMemoire {
  private cheminPersistance: string | null = null;
  private chaineEcriture: Promise<void> = Promise.resolve();
  utilisateurs = new Map<string, Utilisateur>();
  services: InfoService[] = [];
  infosAgents: InfoAgent[] = [];
  /** Agents ajoutés depuis l’écran de création de badges (persistés en mode démo local). */
  private agentsAjoutesManuellement = new Map<string, InfoAgent>();
  private utilisateursAjoutesManuellement = new Map<string, Utilisateur>();
  /** Photos JPEG recadrées pour l’impression des badges ; chaîne data URL persistée localement. */
  readonly photosAgents = new Map<string, string>();
  private servicesAjoutesManuellement = new Map<string, InfoService>();
  secretSession = "secret-session-de-test-0123456789-0123456789";
  /** Paramètres de calcul en lecture seule pour cette démo ; aucun champ financier. */
  reglesScore: ReglesScore = {
    ...REGLES_SCORE_DEFAUT,
    criteres: { ...REGLES_SCORE_DEFAUT.criteres },
    departage: [...REGLES_SCORE_DEFAUT.departage],
  };
  /** Calendrier civil saisi par l’administrateur; sauvegardé en mode démo local. */
  joursFeries = new Map<string, JourFerie>();
  /** Postes ajoutés depuis l’écran de planning; les postes de démonstration sont régénérés au démarrage. */
  private planningsManuels = new Map<string, { agentId: string; poste: PostePlanifie }>();
  /** Les classements publiés sont conservés avec le fichier de persistance de démonstration. */
  classementsMensuels = new Map<string, ClassementMensuel>();
  /** Registre de suivi des absences : tout statut définitif est attribué par un responsable habilité. */
  absences = new Map<string, AbsenceEnregistree>();
  /** Jetons de badge non devinables ; seul le jeton actif permet de pointer pour les fiches gérées. */
  readonly jetonsBadges = new Map<string, string>();

  utilisateurParIdentifiant(identifiant: string): Utilisateur | null {
    for (const u of this.utilisateurs.values()) if (u.identifiant === identifiant) return u;
    return null;
  }
  postesAgents() { return this.entrees.map((e) => ({ ...e.poste, agentId: e.agentId, serviceId: this.agents.get(e.agentId)!.serviceId })); }
  donnees(): DonneesPeriode {
    return { services: this.services, agents: this.infosAgents, postes: this.postesAgents(), pointages: this.pointages };
  }

  /** Persistance locale de développement : utile aux postes partagés, mais ne remplace pas PostgreSQL en production. */
  async activerPersistanceLocale(chemin: string): Promise<void> {
    this.cheminPersistance = chemin;
    await mkdir(dirname(chemin), { recursive: true });
    let brut: string;
    try { brut = await readFile(chemin, "utf8"); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    let data: { version?: number; pointages?: unknown[]; journal?: unknown[]; agents?: unknown[]; services?: unknown[]; photos?: Record<string, unknown>; plannings?: unknown[]; joursFeries?: unknown[]; utilisateurs?: unknown[]; classements?: unknown[]; absences?: unknown[]; jetonsBadges?: Record<string, unknown> };
    try { data = JSON.parse(brut) as typeof data; }
    catch { throw new Error("Le fichier de persistance FANN POINTAGE est illisible; ne pas l'écraser automatiquement."); }
    if (![1, 2, 3, 4].includes(data.version ?? 0) || !Array.isArray(data.pointages) || !Array.isArray(data.journal) || (data.agents !== undefined && !Array.isArray(data.agents)) || (data.services !== undefined && !Array.isArray(data.services)) || (data.plannings !== undefined && !Array.isArray(data.plannings)) || (data.joursFeries !== undefined && !Array.isArray(data.joursFeries)) || (data.utilisateurs !== undefined && !Array.isArray(data.utilisateurs)) || (data.classements !== undefined && !Array.isArray(data.classements)) || (data.absences !== undefined && !Array.isArray(data.absences))) {
      throw new Error("Version ou format du fichier de persistance FANN POINTAGE non reconnu.");
    }
    // Restaure les services personnalisés avant les agents qui peuvent y être affectés.
    for (const brutService of data.services ?? []) {
      if (!brutService || typeof brutService !== "object") continue;
      const s = brutService as Record<string, unknown>;
      if (typeof s.id !== "string" || typeof s.nom !== "string" || !s.nom.trim() || s.nom.length > 100) continue;
      const nomService = s.nom.trim();
      if (this.services.some((existing) => existing.id === s.id || existing.nom.toLocaleLowerCase("fr") === nomService.toLocaleLowerCase("fr"))) continue;
      const service: InfoService = { id: s.id, nom: nomService };
      this.services.push(service);
      this.servicesAjoutesManuellement.set(service.id, service);
    }
    // Restaure uniquement les fiches créées explicitement depuis l'écran de badges.
    for (const brutAgent of data.agents ?? []) {
      if (!brutAgent || typeof brutAgent !== "object") continue;
      const a = brutAgent as Record<string, unknown>;
      if (typeof a.id !== "string" || typeof a.nom !== "string" || typeof a.prenom !== "string" ||
          !(a.matricule === null || typeof a.matricule === "string") || typeof a.serviceId !== "string" ||
          !["general", "garde", "urgences", "mobil"].includes(String(a.regime)) || typeof a.actif !== "boolean") continue;
      if (!this.services.some((service) => service.id === a.serviceId)) continue;
      const agent: InfoAgent = {
        id: a.id, nom: a.nom, prenom: a.prenom, matricule: a.matricule as string | null,
        serviceId: a.serviceId, regime: a.regime as Regime, actif: a.actif,
        profession: typeof a.profession === "string" ? a.profession.slice(0, 60) : null,
        adresse: typeof a.adresse === "string" ? a.adresse.slice(0, 160) : null,
        telephone: typeof a.telephone === "string" && /^[0-9+()./ -]{3,30}$/.test(a.telephone) ? a.telephone : null,
      };
      if (!this.infosAgents.some((existing) => existing.id === agent.id)) this.infosAgents.push(agent);
      this.agents.set(agent.id, { id: agent.id, actif: agent.actif, serviceId: agent.serviceId, regime: agent.regime });
      this.agentsAjoutesManuellement.set(agent.id, agent);
    }
    for (const [agentId, photo] of Object.entries(data.photos ?? {})) {
      // N'accepte que des JPEG base64 bornés, liés à une fiche sauvegardée.
      if (this.agentsAjoutesManuellement.has(agentId) && typeof photo === "string" && photo.length <= 110_000 &&
          photoJpegValide(photo)) this.photosAgents.set(agentId, photo);
    }
    // Restaure le calendrier des jours fériés avec validation stricte des champs.
    for (const brutFerie of data.joursFeries ?? []) {
      if (!brutFerie || typeof brutFerie !== "object") continue;
      const f = brutFerie as Record<string, unknown>;
      if (typeof f.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.date) || typeof f.nom !== "string" || !f.nom.trim() || f.nom.length > 120) continue;
      const date = new Date(`${f.date}T12:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== f.date) continue;
      this.joursFeries.set(f.date, { date: f.date, nom: f.nom.trim(), note: typeof f.note === "string" ? f.note.slice(0, 300) : null, creePar: typeof f.creePar === "string" ? f.creePar : "restauration", creeLe: typeof f.creeLe === "string" ? f.creeLe : new Date().toISOString() });
    }
    // Restaure les comptes ajoutés par l'administrateur; les comptes démo de base sont régénérés au démarrage.
    for (const brutUtilisateur of data.utilisateurs ?? []) {
      if (!brutUtilisateur || typeof brutUtilisateur !== "object") continue;
      const u = brutUtilisateur as Record<string, unknown>;
      if (typeof u.id !== "string" || typeof u.identifiant !== "string" || !/^[A-Za-z0-9._-]{3,80}$/.test(u.identifiant) || typeof u.hash !== "string" || !u.hash.startsWith("scrypt$") || !["administrateur", "responsable", "brancardier"].includes(String(u.role)) || !(u.agentId === null || typeof u.agentId === "string") || !Array.isArray(u.servicesGeres) || !u.servicesGeres.every((x) => typeof x === "string") || typeof u.actif !== "boolean") continue;
      const compte: Utilisateur = { id: u.id, identifiant: u.identifiant, hash: u.hash, role: u.role as Utilisateur["role"], agentId: u.agentId as string | null, servicesGeres: [...u.servicesGeres] as string[], actif: u.actif, sessionVersion: Number.isInteger(u.sessionVersion) && (u.sessionVersion as number) >= 0 ? u.sessionVersion as number : 0 };
      if (compte.role === "brancardier" && (!compte.agentId || !this.agents.has(compte.agentId))) continue;
      this.utilisateurs.set(compte.id, compte);
      this.utilisateursAjoutesManuellement.set(compte.id, compte);
    }
    // Restaure uniquement les plannings explicitement créés par un responsable/administrateur.
    for (const brutPlanning of data.plannings ?? []) {
      if (!brutPlanning || typeof brutPlanning !== "object") continue;
      const pp = brutPlanning as Record<string, unknown>;
      const brutPoste = pp.poste && typeof pp.poste === "object" ? pp.poste as Record<string, unknown> : null;
      if (typeof pp.agentId !== "string" || !this.agents.has(pp.agentId) || !brutPoste || typeof brutPoste.planningId !== "string" || !brutPoste.planningId.startsWith("manual-") || typeof brutPoste.posteId !== "string" || !["general", "garde", "urgences", "mobil"].includes(String(brutPoste.regime)) || !["service", "garde", "jour", "nuit"].includes(String(brutPoste.type)) || typeof brutPoste.debut !== "string" || typeof brutPoste.fin !== "string") continue;
      const debut = new Date(brutPoste.debut), fin = new Date(brutPoste.fin);
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut) continue;
      const poste = { ...brutPoste, debut, fin } as unknown as PostePlanifie;
      if (!this.entrees.some((e) => e.agentId === pp.agentId && e.poste.planningId === poste.planningId)) super.ajouterPoste(pp.agentId, poste);
      this.planningsManuels.set(poste.planningId, { agentId: pp.agentId, poste });
    }
    for (const brutPointage of data.pointages) {
      if (!brutPointage || typeof brutPointage !== "object") continue;
      const p = brutPointage as Record<string, unknown>;
      if (typeof p.id !== "string" || typeof p.agentId !== "string" || typeof p.serverTs !== "string" || typeof p.idempotencyKey !== "string") continue;
      const captureBrute = typeof p.capturedTs === "string" ? new Date(p.capturedTs) : null;
      const pointage = {
        ...p,
        serverTs: new Date(p.serverTs),
        capturedTs: captureBrute && !Number.isNaN(captureBrute.getTime()) ? captureBrute : null,
        positionCollecteeLe: typeof p.positionCollecteeLe === "string" ? new Date(p.positionCollecteeLe) : null,
      } as unknown as PointageEnregistre;
      if (Number.isNaN(pointage.serverTs.getTime())) continue;
      // Les données historiques de démonstration sont régénérées par le serveur; on restaure les vrais essais/stations seulement.
      if (pointage.source === "demo_historique_fictif") continue;
      this.pointages.push(pointage);
      const n = /^p(\d+)$/.exec(pointage.id);
      if (n) this.seq = Math.max(this.seq, Number(n[1]));
      if (pointage.tokenHash) this.usages.add(`${pointage.tokenHash}|${pointage.agentId}`);
    }
    for (const event of data.journal) {
      if (!event || typeof event !== "object") continue;
      const e = event as Record<string, unknown>;
      if (typeof e.type === "string" && typeof e.at === "string") this.journal.push({ ...e, at: new Date(e.at) } as unknown as EvenementSecurite);
    }
    for (const [agentId, token] of Object.entries(data.jetonsBadges ?? {})) {
      if (this.agentsAjoutesManuellement.has(agentId) && typeof token === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(token)) this.jetonsBadges.set(agentId, token);
    }
    for (const raw of data.absences ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as Record<string, unknown>;
      if (typeof a.id !== "string" || typeof a.agentId !== "string" || !this.agents.has(a.agentId) ||
          typeof a.debut !== "string" || typeof a.fin !== "string" || a.fin < a.debut ||
          typeof a.categorie !== "string" || !["a_confirmer", "justifiee", "injustifiee", "refusee"].includes(String(a.statut)) ||
          typeof a.creePar !== "string" || typeof a.creeLe !== "string") continue;
      this.absences.set(a.id, {
        id: a.id, agentId: a.agentId, debut: a.debut, fin: a.fin, categorie: a.categorie,
        note: typeof a.note === "string" ? a.note.slice(0, 500) : null,
        statut: a.statut as StatutAbsence, creePar: a.creePar, creeLe: a.creeLe,
        validePar: typeof a.validePar === "string" ? a.validePar : null,
        valideLe: typeof a.valideLe === "string" ? a.valideLe : null,
        motifValidation: typeof a.motifValidation === "string" ? a.motifValidation.slice(0, 500) : null,
      });
    }
    for (const raw of data.classements ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      if (typeof c.mois !== "string" || !/^\d{4}-\d{2}-01$/.test(c.mois) || typeof c.id !== "string" ||
          !Array.isArray(c.classement) || !Array.isArray(c.top5) || !Array.isArray(c.scores) || !Array.isArray(c.audit)) continue;
      this.classementsMensuels.set(c.mois, c as unknown as ClassementMensuel);
    }
  }

  private async sauvegarderPersistanceLocale(): Promise<void> {
    if (!this.cheminPersistance) return;
    const chemin = this.cheminPersistance;
    const pointages = this.pointages.filter((p) => p.source !== "demo_historique_fictif");
    const donnees = JSON.stringify({ version: 4, pointages, journal: this.journal.slice(-50_000), agents: [...this.agentsAjoutesManuellement.values()], services: [...this.servicesAjoutesManuellement.values()], photos: Object.fromEntries(this.photosAgents), plannings: [...this.planningsManuels.values()], joursFeries: [...this.joursFeries.values()], utilisateurs: [...this.utilisateursAjoutesManuellement.values()], classements: [...this.classementsMensuels.values()], absences: [...this.absences.values()], jetonsBadges: Object.fromEntries(this.jetonsBadges) });
    this.chaineEcriture = this.chaineEcriture.catch(() => {}).then(async () => {
      await mkdir(dirname(chemin), { recursive: true });
      const temporaire = `${chemin}.tmp`;
      await writeFile(temporaire, donnees, { encoding: "utf8", mode: 0o600 });
      await rename(temporaire, chemin);
    });
    await this.chaineEcriture;
  }

  /** Enregistre un service créé depuis l'écran de badges en mode démonstration local. */
  async ajouterServiceManuellement(service: InfoService): Promise<void> {
    if (this.services.some((existing) => existing.id === service.id || existing.nom.toLocaleLowerCase("fr") === service.nom.toLocaleLowerCase("fr"))) {
      throw new Error("Ce service existe déjà.");
    }
    this.services.push(service);
    this.servicesAjoutesManuellement.set(service.id, service);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.services = this.services.filter((s) => s.id !== service.id); this.servicesAjoutesManuellement.delete(service.id); throw e; }
  }

  /** Enregistre la photo du badge. Seules les photos JPEG compactes et liées à une fiche créée ici sont persistées. */
  async enregistrerPhotoAgent(agentId: string, photoDataUrl: string): Promise<void> {
    if (!this.agentsAjoutesManuellement.has(agentId)) throw new Error("Photo liée à une fiche agent inconnue.");
    if (photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl)) {
      throw new Error("Photo invalide ou trop volumineuse.");
    }
    const ancienne = this.photosAgents.get(agentId);
    this.photosAgents.set(agentId, photoDataUrl);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { if (ancienne === undefined) this.photosAgents.delete(agentId); else this.photosAgents.set(agentId, ancienne); throw e; }
  }

  /** Enregistre la fiche et sa photo en une seule écriture locale pour éviter les agents sans photo en cas d'échec. */
  async ajouterAgentManuellement(agent: InfoAgent, photoDataUrl?: string): Promise<void> {
    if (this.infosAgents.some((existing) => existing.id === agent.id)) throw new Error("Cet identifiant d’agent existe déjà.");
    if (!this.services.some((s) => s.id === agent.serviceId)) throw new Error("Le service de l’agent n’existe pas.");
    if (photoDataUrl !== undefined && (photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl))) throw new Error("Photo JPEG invalide ou trop volumineuse.");
    this.infosAgents.push(agent);
    this.agents.set(agent.id, { id: agent.id, actif: agent.actif, serviceId: agent.serviceId, regime: agent.regime });
    this.agentsAjoutesManuellement.set(agent.id, agent);
    if (photoDataUrl !== undefined) this.photosAgents.set(agent.id, photoDataUrl);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) {
      this.infosAgents = this.infosAgents.filter((a) => a.id !== agent.id);
      this.agents.delete(agent.id);
      this.agentsAjoutesManuellement.delete(agent.id);
      this.photosAgents.delete(agent.id);
      throw e;
    }
  }

  async ajouterJourFerie(jour: JourFerie): Promise<void> {
    if (this.joursFeries.has(jour.date)) throw new Error("Cette date est déjà enregistrée comme jour férié.");
    this.joursFeries.set(jour.date, jour);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.joursFeries.delete(jour.date); throw e; }
  }

  async supprimerJourFerie(date: string): Promise<void> {
    const avant = this.joursFeries.get(date);
    if (!avant) throw new Error("Jour férié introuvable.");
    this.joursFeries.delete(date);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.joursFeries.set(date, avant); throw e; }
  }

  async ajouterPlanningsManuels(agentId: string, postes: PostePlanifie[]): Promise<void> {
    if (!this.agents.has(agentId) || !this.agents.get(agentId)?.actif) throw new Error("Agent inconnu ou inactif.");
    const ids = new Set<string>();
    for (const poste of postes) {
      if (!poste.planningId.startsWith("manual-")) throw new Error("Identifiant de planning manuel invalide.");
      if (ids.has(poste.posteId) || this.entrees.some((e) => e.agentId === agentId && e.poste.posteId === poste.posteId)) throw new Error("Un poste identique existe déjà pour cet agent.");
      ids.add(poste.posteId);
    }
    const avantEntrees = this.entrees.length;
    for (const poste of postes) { super.ajouterPoste(agentId, poste); this.planningsManuels.set(poste.planningId, { agentId, poste }); }
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) {
      this.entrees.length = avantEntrees;
      for (const poste of postes) this.planningsManuels.delete(poste.planningId);
      throw e;
    }
  }

  async ajouterPlanningManuel(agentId: string, poste: PostePlanifie): Promise<void> { await this.ajouterPlanningsManuels(agentId, [poste]); }

  async ajouterUtilisateurManuel(utilisateur: Utilisateur): Promise<void> {
    if (this.utilisateurParIdentifiant(utilisateur.identifiant)) throw new Error("Cet identifiant de connexion existe déjà.");
    this.utilisateurs.set(utilisateur.id, utilisateur);
    this.utilisateursAjoutesManuellement.set(utilisateur.id, utilisateur);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.utilisateurs.delete(utilisateur.id); this.utilisateursAjoutesManuellement.delete(utilisateur.id); throw e; }
  }

  async modifierUtilisateurManuel(id: string, changements: { hash?: string; actif?: boolean }): Promise<Utilisateur> {
    const utilisateur = this.utilisateurs.get(id);
    if (!utilisateur) throw new Error("Compte utilisateur introuvable.");
    if (changements.hash !== undefined && !changements.hash.startsWith("scrypt$")) throw new Error("Format de mot de passe haché invalide.");
    if (changements.actif === false && utilisateur.actif && utilisateur.role === "administrateur" && [...this.utilisateurs.values()].filter((u) => u.role === "administrateur" && u.actif).length <= 1) {
      throw new Error("Impossible de désactiver le dernier compte administrateur actif.");
    }
    if (changements.actif === true && utilisateur.role === "brancardier") {
      const agent = utilisateur.agentId ? this.agents.get(utilisateur.agentId) : undefined;
      if (!agent?.actif) throw new Error("Impossible de réactiver ce compte : la fiche de l’agent est absente ou désactivée.");
    }
    const modifie: Utilisateur = {
      ...utilisateur,
      ...(changements.hash !== undefined ? { hash: changements.hash } : {}),
      ...(changements.actif !== undefined ? { actif: changements.actif } : {}),
      // Invalide les jetons déjà émis lors d'une réinitialisation, désactivation ou réactivation.
      sessionVersion: (utilisateur.sessionVersion ?? 0) + 1,
    };
    this.utilisateurs.set(id, modifie);
    this.utilisateursAjoutesManuellement.set(id, modifie);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.utilisateurs.set(id, utilisateur); this.utilisateursAjoutesManuellement.set(id, utilisateur); throw e; }
    return modifie;
  }

  async desactiverUtilisateurManuel(id: string): Promise<void> {
    await this.modifierUtilisateurManuel(id, { actif: false });
  }

  async supprimerPlanningManuel(planningId: string): Promise<{ agentId: string; poste: PostePlanifie }> {
    const cible = this.planningsManuels.get(planningId);
    if (!cible) throw new Error("Planning manuel introuvable ou non modifiable.");
    if (this.pointages.some((p) => p.agentId === cible.agentId && p.posteId === cible.poste.posteId)) {
      throw new Error("Ce poste possède déjà des pointages : il ne peut pas être supprimé. Conservez-le pour l'historique.");
    }
    const entreesAvant = this.entrees;
    this.planningsManuels.delete(planningId);
    this.entrees = this.entrees.filter((e) => !(e.agentId === cible.agentId && e.poste.planningId === planningId));
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.planningsManuels.set(planningId, cible); this.entrees = entreesAvant; throw e; }
    return cible;
  }

  async modifierIdentiteAgent(agentId: string, valeurs: { prenom: string; nom: string; matricule: string | null; profession?: string | null; adresse?: string | null; telephone?: string | null }, photoDataUrl?: string): Promise<InfoAgent> {
    const agent = this.infosAgents.find((a) => a.id === agentId);
    if (!agent || !this.agentsAjoutesManuellement.has(agentId)) throw new Error("Seules les fiches créées dans cette application peuvent être modifiées ici.");
    if (valeurs.matricule && this.infosAgents.some((a) => a.id !== agentId && a.matricule?.toLocaleLowerCase("fr") === valeurs.matricule?.toLocaleLowerCase("fr"))) throw new Error("Ce matricule est déjà utilisé.");
    if (photoDataUrl !== undefined && (photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl))) throw new Error("Photo JPEG invalide ou trop volumineuse.");
    const modifie: InfoAgent = {
      ...agent, prenom: valeurs.prenom, nom: valeurs.nom, matricule: valeurs.matricule,
      profession: valeurs.profession === undefined ? agent.profession ?? null : valeurs.profession,
      adresse: valeurs.adresse === undefined ? agent.adresse ?? null : valeurs.adresse,
      telephone: valeurs.telephone === undefined ? agent.telephone ?? null : valeurs.telephone,
    };
    const photosAvant = this.photosAgents.get(agentId);
    this.infosAgents = this.infosAgents.map((a) => a.id === agentId ? modifie : a);
    this.agentsAjoutesManuellement.set(agentId, modifie);
    if (photoDataUrl !== undefined) this.photosAgents.set(agentId, photoDataUrl);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) {
      this.infosAgents = this.infosAgents.map((a) => a.id === agentId ? agent : a);
      this.agentsAjoutesManuellement.set(agentId, agent);
      if (photoDataUrl !== undefined) { if (photosAvant === undefined) this.photosAgents.delete(agentId); else this.photosAgents.set(agentId, photosAvant); }
      throw e;
    }
    return modifie;
  }

  async desactiverAgentManuellement(agentId: string): Promise<void> {
    const agent = this.infosAgents.find((a) => a.id === agentId);
    if (!agent || !this.agentsAjoutesManuellement.has(agentId)) throw new Error("Seules les fiches créées dans cette application peuvent être désactivées ici.");
    const entreeAvant = this.agents.get(agentId);
    const modifie: InfoAgent = { ...agent, actif: false };
    this.infosAgents = this.infosAgents.map((a) => a.id === agentId ? modifie : a);
    if (entreeAvant) this.agents.set(agentId, { ...entreeAvant, actif: false });
    this.agentsAjoutesManuellement.set(agentId, modifie);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) {
      this.infosAgents = this.infosAgents.map((a) => a.id === agentId ? agent : a);
      if (entreeAvant) this.agents.set(agentId, entreeAvant);
      this.agentsAjoutesManuellement.set(agentId, agent);
      throw e;
    }
  }

  estAgentManuel(agentId: string): boolean { return this.agentsAjoutesManuellement.has(agentId); }

  async obtenirCodeBadge(agentId: string): Promise<string> {
    if (!this.agents.has(agentId) || !this.agents.get(agentId)?.actif) throw new Error("Agent actif introuvable.");
    // Compatibilité des seuls profils fictifs historiques ; tout nouvel agent possède un jeton secret révocable.
    if (!this.agentsAjoutesManuellement.has(agentId)) return `FANN-BADGE:${agentId}`;
    const existant = this.jetonsBadges.get(agentId);
    if (existant) return `FANN-BADGE:${agentId}:${existant}`;
    const nouveauJeton = randomBytes(32).toString("base64url");
    this.jetonsBadges.set(agentId, nouveauJeton);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.jetonsBadges.delete(agentId); throw e; }
    return `FANN-BADGE:${agentId}:${nouveauJeton}`;
  }

  async renouvelerCodeBadge(agentId: string): Promise<string> {
    if (!this.agentsAjoutesManuellement.has(agentId) || !this.agents.get(agentId)?.actif) throw new Error("Seul le badge d’un agent actif créé dans cette application peut être renouvelé.");
    const ancien = this.jetonsBadges.get(agentId);
    const token = randomBytes(32).toString("base64url");
    this.jetonsBadges.set(agentId, token);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { if (ancien) this.jetonsBadges.set(agentId, ancien); else this.jetonsBadges.delete(agentId); throw e; }
    return `FANN-BADGE:${agentId}:${token}`;
  }

  verifierJetonBadge(agentId: string, token: string): boolean {
    const attendu = this.jetonsBadges.get(agentId);
    if (!attendu || !token || token.length !== attendu.length) return false;
    // Comparaison constante dans le temps afin d’éviter une fuite triviale par timing.
    const a = Buffer.from(attendu); const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async enregistrerClassementMensuel(mois: string, classement: ClassementMensuel): Promise<void> {
    if (this.classementsMensuels.has(mois)) throw new Error("Un classement existe déjà pour ce mois.");
    this.classementsMensuels.set(mois, classement);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.classementsMensuels.delete(mois); throw e; }
  }

  async creerAbsence(absence: AbsenceEnregistree): Promise<void> {
    if (!this.agents.get(absence.agentId)?.actif) throw new Error("Agent inconnu ou inactif.");
    if (this.absences.has(absence.id)) throw new Error("Identifiant d’absence déjà utilisé.");
    const doublon = [...this.absences.values()].some((a) => a.agentId === absence.agentId && a.debut === absence.debut && a.fin === absence.fin && a.statut !== "refusee");
    if (doublon) throw new Error("Une absence de même période existe déjà pour cet agent.");
    this.absences.set(absence.id, absence);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.absences.delete(absence.id); throw e; }
  }

  async deciderAbsence(id: string, statut: Exclude<StatutAbsence, "a_confirmer">, validePar: string, motif: string, valideLe: Date): Promise<AbsenceEnregistree> {
    const absence = this.absences.get(id);
    if (!absence) throw new Error("Absence introuvable.");
    if (absence.statut !== "a_confirmer") throw new Error("Cette absence a déjà été traitée. Créez une nouvelle demande pour une nouvelle décision.");
    if (!motif.trim()) throw new Error("Un motif est obligatoire pour la décision.");
    const modifiee: AbsenceEnregistree = { ...absence, statut, validePar, valideLe: valideLe.toISOString(), motifValidation: motif.trim().slice(0, 500) };
    this.absences.set(id, modifiee);
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.absences.set(id, absence); throw e; }
    return modifiee;
  }

  async modifierPlanningManuel(planningId: string, poste: PostePlanifie): Promise<{ agentId: string; ancien: PostePlanifie; nouveau: PostePlanifie }> {
    const cible = this.planningsManuels.get(planningId);
    if (!cible) throw new Error("Seul un planning manuel peut être modifié.");
    if (this.pointages.some((p) => p.agentId === cible.agentId && p.posteId === cible.poste.posteId)) throw new Error("Ce poste possède des pointages : il doit être conservé pour l’historique.");
    if (poste.planningId !== planningId || poste.regime !== cible.poste.regime || poste.type !== cible.poste.type || poste.fin <= poste.debut) throw new Error("La modification ne respecte pas l’identité du poste ou les horaires.");
    const conflit = this.entrees.some((e) => e.agentId === cible.agentId && e.poste.planningId !== planningId && poste.debut < e.poste.fin && poste.fin > e.poste.debut);
    if (conflit) throw new Error("La modification créerait un chevauchement avec un autre poste.");
    const ancien = cible.poste;
    const entreeIndex = this.entrees.findIndex((e) => e.agentId === cible.agentId && e.poste.planningId === planningId);
    if (entreeIndex < 0) throw new Error("Poste introuvable dans le planning.");
    this.entrees[entreeIndex] = { agentId: cible.agentId, poste };
    this.planningsManuels.set(planningId, { agentId: cible.agentId, poste });
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) { this.entrees[entreeIndex] = { agentId: cible.agentId, poste: ancien }; this.planningsManuels.set(planningId, { agentId: cible.agentId, poste: ancien }); throw e; }
    return { agentId: cible.agentId, ancien, nouveau: poste };
  }

  /** Retire les postes général futurs non pointés lorsqu'un jour férié est ajouté.
   * Les postes avec historique sont conservés et retournés comme conflits à examiner. */
  async appliquerJourFerie(date: string): Promise<{ retires: number; aExaminer: string[] }> {
    const aExaminer: string[] = [];
    const aRetirer = [...this.planningsManuels.entries()].filter(([id, x]) => {
      const agent = this.infosAgents.find((a) => a.id === x.agentId);
      const jourLocal = cle(civilDeInstant(x.poste.debut));
      if (!agent || agent.regime !== "general" || jourLocal !== date || x.poste.debut <= this.horloge) return false;
      if (this.pointages.some((p) => p.agentId === x.agentId && p.posteId === x.poste.posteId)) { aExaminer.push(id); return false; }
      return true;
    });
    for (const [id, x] of aRetirer) {
      this.planningsManuels.delete(id);
      this.entrees = this.entrees.filter((e) => !(e.agentId === x.agentId && e.poste.planningId === id));
    }
    try { await this.sauvegarderPersistanceLocale(); }
    catch (e) {
      for (const [id, x] of aRetirer) { this.planningsManuels.set(id, x); this.entrees.push({ agentId: x.agentId, poste: x.poste }); }
      throw e;
    }
    return { retires: aRetirer.length, aExaminer };
  }

  override async enregistrer(p: NouveauPointage): Promise<PointageEnregistre> {
    const r = await super.enregistrer(p);
    await this.sauvegarderPersistanceLocale();
    return r;
  }

  override async journaliser(e: EvenementSecurite): Promise<void> {
    await super.journaliser(e);
    await this.sauvegarderPersistanceLocale();
  }

  override async marquerValideManuellement(id: string, acteurId: string, motif: string, at: Date): Promise<PointageEnregistre> {
    const r = await super.marquerValideManuellement(id, acteurId, motif, at);
    await this.sauvegarderPersistanceLocale();
    return r;
  }
}
