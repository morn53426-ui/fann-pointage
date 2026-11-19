// Catalogue persistant pour la gestion réelle des services et des agents.
// Les suppressions sont des désactivations afin de conserver les historiques et les pointages.
import { randomUUID } from "node:crypto";
import { ErreurRegime } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";
import type { ClientPg, PoolPg } from "../pointage/postgres.ts";
import { photoJpegValide } from "./photo.ts";
import { creerCompteAgentDansTransaction } from "./auth-postgres.ts";
import type { ResultatCompteAgent } from "./auth-postgres.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGIMES = new Set<Regime>(["general", "garde", "urgences", "mobil"]);
type Ligne = Record<string, unknown>;

export interface ServiceCatalogue { id: string; nom: string; regimeDefaut: Regime; actif: boolean }
export interface AgentCatalogue {
  id: string; prenom: string; nom: string; matricule: string | null;
  serviceId: string | null; service: string; regime: Regime; actif: boolean; photoDataUrl?: string | null;
  /** Informations imprimées sur le badge : profession (recto), adresse et téléphone (verso). */
  profession: string | null; adresse: string | null; telephone: string | null;
}
export interface SaisieAgent {
  prenom: string; nom: string; matricule: string | null; serviceId: string; regime: Regime; photoDataUrl?: string | null; serviceNom?: string | null;
  profession?: string | null; adresse?: string | null; telephone?: string | null;
}
export interface ModifAgent extends Partial<SaisieAgent> { actif?: boolean; photoDataUrl?: string | null }
export interface SaisieService { nom: string; regimeDefaut: Regime }
export interface ModifService extends Partial<SaisieService> { actif?: boolean }
/** Agent renvoyé après création/modification, avec le sort du compte de connexion associé (sans aucun mot de passe). */
export type AgentAvecCompte = AgentCatalogue & { compteAgent?: ResultatCompteAgent };
export interface BilanComptesAgents {
  crees: number;
  ignores: { agentId: string; prenom: string; nom: string; raison: string }[];
  /** Mode « aleatoire » uniquement : codes provisoires à remettre aux agents, montrés une seule fois à l'administrateur. */
  codes?: { prenom: string; nom: string; identifiant: string; motDePasseProvisoire: string }[];
}
export interface CataloguePersistant {
  listerAgents(): Promise<AgentCatalogue[]>;
  listerServices(): Promise<ServiceCatalogue[]>;
  creerAgent(saisie: SaisieAgent, acteurId: string, ip: string): Promise<AgentAvecCompte>;
  modifierAgent(id: string, changements: ModifAgent, acteurId: string, ip: string): Promise<AgentAvecCompte>;
  /** Crée les comptes de connexion manquants des agents actifs ayant un matricule et un téléphone. */
  creerComptesAgentsManquants?(acteurId: string, ip: string): Promise<BilanComptesAgents>;
  creerService(saisie: SaisieService, acteurId: string, ip: string): Promise<ServiceCatalogue>;
  modifierService(id: string, changements: ModifService, acteurId: string, ip: string): Promise<ServiceCatalogue>;
}

const txt = (v: unknown): string => String(v ?? "");
function propre(v: unknown, max: number, champ: string, obligatoire = true): string | null {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!s && !obligatoire) return null;
  if (!s || s.length > max) throw new ErreurRegime("requete_invalide", `${champ} est obligatoire et limité à ${max} caractères.`);
  return s;
}
/** Téléphone imprimé sur le badge : chiffres, +, espaces, parenthèses, points, tirets ou barres obliques ; 3 à 30 caractères. */
function telephonePropre(v: unknown): string | null {
  const s = propre(v, 30, "Téléphone", false);
  if (s === null) return null;
  if (s.length < 3 || !/^[0-9+()./ -]+$/.test(s)) throw new ErreurRegime("requete_invalide", "Le téléphone ne peut contenir que des chiffres, +, espaces, parenthèses, points et tirets (3 à 30 caractères).");
  return s;
}
function validerRegime(v: unknown): Regime {
  if (typeof v !== "string" || !REGIMES.has(v as Regime)) throw new ErreurRegime("requete_invalide", "Choisissez un régime valide : general, garde, urgences ou mobil.");
  return v as Regime;
}
function validerUuid(v: string, quoi: string): string {
  if (!UUID.test(v)) throw new ErreurRegime("requete_invalide", `${quoi} invalide.`);
  return v;
}
function convertirService(l: Ligne): ServiceCatalogue {
  return { id: txt(l.id), nom: txt(l.nom), regimeDefaut: validerRegime(l.regimeDefaut), actif: l.actif === true };
}
function convertirAgent(l: Ligne): AgentCatalogue {
  return {
    id: txt(l.id), prenom: txt(l.prenom), nom: txt(l.nom), matricule: l.matricule == null ? null : txt(l.matricule),
    serviceId: l.serviceId == null ? null : txt(l.serviceId), service: txt(l.service) || "Affectation à configurer",
    regime: validerRegime(l.regime ?? "general"), actif: l.actif === true, photoDataUrl: l.photoDataUrl == null ? null : txt(l.photoDataUrl),
    profession: l.profession == null ? null : txt(l.profession), adresse: l.adresse == null ? null : txt(l.adresse), telephone: l.telephone == null ? null : txt(l.telephone),
  };
}
function tradErreur(e: unknown, cible: "service" | "agent"): never {
  const x = (typeof e === "object" && e !== null) ? e as { code?: unknown; constraint?: unknown } : {};
  if (x.code === "23505") {
    if (String(x.constraint ?? "").includes("matricule")) throw new ErreurRegime("conflit", "Ce matricule est déjà utilisé.");
    if (String(x.constraint ?? "").includes("services_nom")) throw new ErreurRegime("conflit", "Un service porte déjà ce nom.");
    throw new ErreurRegime("conflit", cible === "agent" ? "Une fiche agent avec ces données existe déjà." : "Ce service existe déjà.");
  }
  if (x.code === "23P01") throw new ErreurRegime("conflit", "Cette affectation chevauche une autre affectation de l'agent. Vérifiez son historique avant de réessayer.");
  if (x.code === "23503") throw new ErreurRegime("conflit", "Cette fiche est encore liée à un historique ou à un compte.");
  throw e;
}

const SQL_AGENT = `
  SELECT a.id::text AS id, a.prenom, a.nom, a.matricule, a.actif, a.photo_data_url AS "photoDataUrl",
         a.profession, a.adresse, a.telephone,
         aa.service_id::text AS "serviceId", COALESCE(s.nom, 'Affectation à configurer') AS service,
         COALESCE(aa.regime::text, s.regime_defaut::text, 'general') AS regime
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT aa1.service_id, aa1.regime
    FROM agent_affectations aa1
    WHERE aa1.agent_id = a.id
    ORDER BY ((aa1.date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date)
      AND (aa1.date_fin IS NULL OR aa1.date_fin > (now() AT TIME ZONE 'Africa/Dakar')::date)) DESC,
      aa1.date_debut DESC, aa1.created_at DESC
    LIMIT 1
  ) aa ON true
  LEFT JOIN services s ON s.id = aa.service_id`;

/** Le journal d'audit ne conserve jamais l'image base64 de la photo (jusqu'à 110 Ko par ligne) : seulement sa présence. */
function pourAudit(agent: AgentCatalogue | null): Record<string, unknown> | null {
  if (!agent) return null;
  const { photoDataUrl, ...reste } = agent;
  return { ...reste, photo: !!photoDataUrl };
}

async function audit(client: Pick<ClientPg, "query">, acteurId: string, action: string, table: string, id: string, avant: unknown, apres: unknown, ip: string): Promise<void> {
  await client.query(`
    INSERT INTO journal_audit (user_id, action, objet_table, objet_id, ancienne_valeur, nouvelle_valeur, ip)
    VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`, [
    acteurId, action, table, id, avant === null ? null : JSON.stringify(avant), apres === null ? null : JSON.stringify(apres), ip.slice(0, 45),
  ]);
}

export class DepotCataloguePostgres implements CataloguePersistant {
  private readonly pool: PoolPg;
  constructor(pool: PoolPg) { this.pool = pool; }

  async listerServices(): Promise<ServiceCatalogue[]> {
    const r = await this.pool.query(`SELECT id::text AS id, nom, regime_defaut::text AS "regimeDefaut", actif FROM services ORDER BY actif DESC, nom ASC`);
    return r.rows.map(convertirService);
  }

  async listerAgents(): Promise<AgentCatalogue[]> {
    const r = await this.pool.query(`${SQL_AGENT} ORDER BY a.actif DESC, a.nom, a.prenom`);
    return r.rows.map(convertirAgent);
  }

  async creerService(saisie: SaisieService, acteurId: string, ip: string): Promise<ServiceCatalogue> {
    const nom = propre(saisie.nom, 100, "Nom du service")!;
    const regimeDefaut = validerRegime(saisie.regimeDefaut);
    const id = randomUUID();
    const client = await this.pool.connect(); let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      const ins = await client.query(`INSERT INTO services (id, nom, regime_defaut, actif) VALUES ($1::uuid, $2, $3::regime_code, true) RETURNING id::text AS id, nom, regime_defaut::text AS "regimeDefaut", actif`, [id, nom, regimeDefaut]);
      const service = convertirService(ins.rows[0]!);
      await audit(client, acteurId, "service_cree", "services", id, null, service, ip);
      await client.query("COMMIT"); ouverte = false; return service;
    } catch (e) { if (ouverte) await client.query("ROLLBACK").catch(() => {}); tradErreur(e, "service"); }
    finally { client.release(); }
  }

  async modifierService(idBrut: string, changements: ModifService, acteurId: string, ip: string): Promise<ServiceCatalogue> {
    const id = validerUuid(idBrut, "Identifiant du service");
    if (changements.nom === undefined && changements.regimeDefaut === undefined && changements.actif === undefined) throw new ErreurRegime("requete_invalide", "Aucune modification de service demandée.");
    if (changements.actif !== undefined && typeof changements.actif !== "boolean") throw new ErreurRegime("requete_invalide", "Le champ actif doit être vrai ou faux.");
    const client = await this.pool.connect(); let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      const ancienResultat = await client.query(`SELECT id::text AS id, nom, regime_defaut::text AS "regimeDefaut", actif FROM services WHERE id=$1::uuid FOR UPDATE`, [id]);
      if (!ancienResultat.rows[0]) throw new ErreurRegime("introuvable", "Service introuvable.");
      const ancien = convertirService(ancienResultat.rows[0]);
      const nom = changements.nom === undefined ? ancien.nom : propre(changements.nom, 100, "Nom du service")!;
      const regime = changements.regimeDefaut === undefined ? ancien.regimeDefaut : validerRegime(changements.regimeDefaut);
      const actif = changements.actif === undefined ? ancien.actif : changements.actif;
      if (ancien.actif && !actif) {
        const n = await client.query(`SELECT count(*)::int AS total FROM agents a JOIN agent_affectations aa ON aa.agent_id=a.id WHERE a.actif AND aa.service_id=$1::uuid AND aa.date_fin IS NULL`, [id]);
        if (Number(n.rows[0]?.total ?? 0) > 0) throw new ErreurRegime("conflit", "Ce service possède encore des agents actifs. Réaffectez-les ou désactivez-les avant d'archiver le service.");
      }
      const modifie = await client.query(`UPDATE services SET nom=$2, regime_defaut=$3::regime_code, actif=$4 WHERE id=$1::uuid RETURNING id::text AS id, nom, regime_defaut::text AS "regimeDefaut", actif`, [id, nom, regime, actif]);
      const service = convertirService(modifie.rows[0]!);
      await audit(client, acteurId, "service_modifie", "services", id, ancien, service, ip);
      await client.query("COMMIT"); ouverte = false; return service;
    } catch (e) { if (ouverte) await client.query("ROLLBACK").catch(() => {}); if (e instanceof ErreurRegime) throw e; tradErreur(e, "service"); }
    finally { client.release(); }
  }

  async creerAgent(saisie: SaisieAgent, acteurId: string, ip: string): Promise<AgentAvecCompte> {
    const prenom = propre(saisie.prenom, 80, "Prénom")!;
    const nom = propre(saisie.nom, 80, "Nom")!;
    const matricule = propre(saisie.matricule, 40, "Matricule", false);
    const nouveauService = saisie.serviceId === "__nouveau__";
    const serviceIdSaisi = nouveauService ? null : validerUuid(saisie.serviceId, "Identifiant de service");
    const regime = validerRegime(saisie.regime);
    const serviceNom = nouveauService ? propre(saisie.serviceNom, 100, "Nom du nouveau service")! : null;
    const photoDataUrl = saisie.photoDataUrl ?? null;
    if (photoDataUrl !== null && (typeof photoDataUrl !== "string" || photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl))) {
      throw new ErreurRegime("requete_invalide", "La photo doit être un JPEG compressé au format attendu et ne pas dépasser 110 Ko.");
    }
    const profession = propre(saisie.profession, 60, "Profession", false);
    const adresse = propre(saisie.adresse, 160, "Adresse", false);
    const telephone = telephonePropre(saisie.telephone);
    const id = randomUUID();
    const client = await this.pool.connect(); let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      let serviceId = serviceIdSaisi;
      if (nouveauService) {
        const srv = await client.query(`INSERT INTO services(nom,regime_defaut,actif) VALUES($1,$2::regime_code,true) RETURNING id::text AS id`, [serviceNom, regime]);
        serviceId = txt(srv.rows[0]?.id);
      } else {
        const srv = await client.query(`SELECT id::text AS id FROM services WHERE id=$1::uuid AND actif FOR SHARE`, [serviceId]);
        if (!srv.rows[0]) throw new ErreurRegime("introuvable", "Service actif introuvable.");
      }
      await client.query(`INSERT INTO agents (id, prenom, nom, matricule, actif, photo_data_url, profession, adresse, telephone) VALUES ($1::uuid,$2,$3,$4,true,$5,$6,$7,$8) RETURNING id::text AS id`, [id, prenom, nom, matricule, photoDataUrl, profession, adresse, telephone]);
      const date = await client.query(`SELECT (now() AT TIME ZONE 'Africa/Dakar')::date::text AS today`);
      await client.query(`INSERT INTO agent_affectations (agent_id,service_id,regime,date_debut,motif) VALUES ($1::uuid,$2::uuid,$3::regime_code,$4::date,'Affectation initiale créée par l’administration')`, [id, serviceId, regime, date.rows[0]?.today]);
      const lu = await client.query(`${SQL_AGENT} WHERE a.id=$1::uuid`, [id]);
      const agent = convertirAgent(lu.rows[0]!);
      await audit(client, acteurId, "agent_cree", "agents", id, null, pourAudit(agent), ip);
      // Compte de connexion automatique : identifiant = matricule, mot de passe provisoire = téléphone (changement obligatoire).
      const compteAgent = await creerCompteAgentDansTransaction(client, { id, matricule: agent.matricule, telephone: agent.telephone, actif: true }, acteurId, ip);
      await client.query("COMMIT"); ouverte = false; return { ...agent, compteAgent };
    } catch (e) { if (ouverte) await client.query("ROLLBACK").catch(() => {}); if (e instanceof ErreurRegime) throw e; tradErreur(e, "agent"); }
    finally { client.release(); }
  }

  /** Rattrapage : crée les comptes manquants des agents déjà présents au registre. Une transaction par agent : un échec n'en bloque aucun autre. */
  async creerComptesAgentsManquants(acteurId: string, ip: string): Promise<BilanComptesAgents> {
    const candidats = await this.pool.query(`
      SELECT a.id::text AS id, a.prenom, a.nom, a.matricule, a.telephone
      FROM agents a WHERE a.actif AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.agent_id = a.id)
      ORDER BY a.nom, a.prenom`);
    const bilan: BilanComptesAgents = { crees: 0, ignores: [] };
    for (const l of candidats.rows) {
      const client = await this.pool.connect(); let ouverte = false;
      try {
        await client.query("BEGIN"); ouverte = true;
        const r = await creerCompteAgentDansTransaction(client, { id: txt(l.id), matricule: l.matricule == null ? null : txt(l.matricule), telephone: l.telephone == null ? null : txt(l.telephone), actif: true }, acteurId, ip);
        await client.query("COMMIT"); ouverte = false;
        if (r.cree) {
          bilan.crees++;
          if (r.motDePasseProvisoire) (bilan.codes ??= []).push({ prenom: txt(l.prenom), nom: txt(l.nom), identifiant: r.identifiant, motDePasseProvisoire: r.motDePasseProvisoire });
        } else bilan.ignores.push({ agentId: txt(l.id), prenom: txt(l.prenom), nom: txt(l.nom), raison: r.raison });
      } catch (e) {
        if (ouverte) await client.query("ROLLBACK").catch(() => {});
        console.error(`Création de compte agent impossible (${txt((e as { code?: unknown }).code) || "erreur"}).`);
        bilan.ignores.push({ agentId: txt(l.id), prenom: txt(l.prenom), nom: txt(l.nom), raison: "erreur_technique" });
      } finally { client.release(); }
    }
    if (bilan.crees > 0 || bilan.ignores.length > 0) {
      await audit(this.pool, acteurId, "comptes_agents_rattrapage", "identifiants_application", acteurId, null, { crees: bilan.crees, ignores: bilan.ignores.length }, ip);
    }
    return bilan;
  }

  async modifierAgent(idBrut: string, changements: ModifAgent, acteurId: string, ip: string): Promise<AgentAvecCompte> {
    const id = validerUuid(idBrut, "Identifiant de l'agent");
    if (!["prenom", "nom", "matricule", "serviceId", "regime", "actif", "photoDataUrl", "profession", "adresse", "telephone"].some((k) => (changements as Record<string, unknown>)[k] !== undefined)) throw new ErreurRegime("requete_invalide", "Aucune modification d'agent demandée.");
    if (changements.actif !== undefined && typeof changements.actif !== "boolean") throw new ErreurRegime("requete_invalide", "Le champ actif doit être vrai ou faux.");
    const client = await this.pool.connect(); let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      const cur = await client.query(`${SQL_AGENT} WHERE a.id=$1::uuid FOR UPDATE OF a`, [id]);
      if (!cur.rows[0]) throw new ErreurRegime("introuvable", "Agent introuvable.");
      const ancien = convertirAgent(cur.rows[0]);
      const prenom = changements.prenom === undefined ? ancien.prenom : propre(changements.prenom, 80, "Prénom")!;
      const nom = changements.nom === undefined ? ancien.nom : propre(changements.nom, 80, "Nom")!;
      const matricule = changements.matricule === undefined ? ancien.matricule : propre(changements.matricule, 40, "Matricule", false);
      const serviceId = changements.serviceId === undefined ? ancien.serviceId : validerUuid(changements.serviceId, "Identifiant de service");
      if (!serviceId) throw new ErreurRegime("conflit", "Cet agent n'a pas d'affectation. Choisissez un service.");
      const regime = changements.regime === undefined ? ancien.regime : validerRegime(changements.regime);
      const actif = changements.actif === undefined ? ancien.actif : changements.actif;
      const photoDataUrl = changements.photoDataUrl === undefined ? ancien.photoDataUrl ?? null : changements.photoDataUrl;
      if (photoDataUrl !== null && (typeof photoDataUrl !== "string" || photoDataUrl.length > 110_000 || !photoJpegValide(photoDataUrl))) {
        throw new ErreurRegime("requete_invalide", "La photo doit être un JPEG compressé au format attendu et ne pas dépasser 110 Ko.");
      }
      const profession = changements.profession === undefined ? ancien.profession : propre(changements.profession, 60, "Profession", false);
      const adresse = changements.adresse === undefined ? ancien.adresse : propre(changements.adresse, 160, "Adresse", false);
      const telephone = changements.telephone === undefined ? ancien.telephone : telephonePropre(changements.telephone);
      // Un agent ne doit jamais être réactivé dans un service archivé.
      if (!ancien.actif && actif) {
        const srv = await client.query(`SELECT 1 FROM services WHERE id=$1::uuid AND actif FOR SHARE`, [serviceId]);
        if (!srv.rows[0]) throw new ErreurRegime("conflit", "Impossible de réactiver cet agent : réactivez d’abord son service ou choisissez un service actif.");
      }
      if (serviceId !== ancien.serviceId || regime !== ancien.regime) {
        const srv = await client.query(`SELECT 1 FROM services WHERE id=$1::uuid AND actif FOR SHARE`, [serviceId]);
        if (!srv.rows[0]) throw new ErreurRegime("introuvable", "Choisissez un service actif.");
        const plan = await client.query(`SELECT 1 FROM plannings WHERE agent_id=$1::uuid AND statut <> 'annule' AND ends_at > now() LIMIT 1`, [id]);
        if (plan.rows[0]) throw new ErreurRegime("conflit", "Cet agent possède des postes futurs. Modifiez ou annulez son planning avant son changement de service/régime.");
      }
      const upd = await client.query(`UPDATE agents SET prenom=$2, nom=$3, matricule=$4, actif=$5, photo_data_url=$6, profession=$7, adresse=$8, telephone=$9 WHERE id=$1::uuid`, [id, prenom, nom, matricule, actif, photoDataUrl, profession, adresse, telephone]);
      if (!upd.rowCount) throw new ErreurRegime("introuvable", "Agent introuvable.");
      if (serviceId !== ancien.serviceId || regime !== ancien.regime) {
        const todayR = await client.query(`SELECT (now() AT TIME ZONE 'Africa/Dakar')::date::text AS today`);
        const today = txt(todayR.rows[0]?.today);
        const affect = await client.query(`SELECT id::text AS id, date_debut::text AS "dateDebut", date_fin::text AS "dateFin" FROM agent_affectations WHERE agent_id=$1::uuid AND date_fin IS NULL ORDER BY date_debut DESC LIMIT 1 FOR UPDATE`, [id]);
        const a = affect.rows[0];
        if (a && txt(a.dateDebut) < today) {
          await client.query(`UPDATE agent_affectations SET date_fin=$2::date, motif='Clôture lors d''un changement d''affectation' WHERE id=$1::uuid`, [a.id, today]);
          await client.query(`INSERT INTO agent_affectations (agent_id,service_id,regime,date_debut,motif) VALUES ($1::uuid,$2::uuid,$3::regime_code,$4::date,'Nouvelle affectation modifiée par l’administration')`, [id, serviceId, regime, today]);
        } else if (a) {
          await client.query(`UPDATE agent_affectations SET service_id=$2::uuid, regime=$3::regime_code, motif='Affectation ajustée le jour de début' WHERE id=$1::uuid`, [a.id, serviceId, regime]);
        } else {
          await client.query(`INSERT INTO agent_affectations (agent_id,service_id,regime,date_debut,motif) VALUES ($1::uuid,$2::uuid,$3::regime_code,$4::date,'Nouvelle affectation ajoutée par l’administration')`, [id, serviceId, regime, today]);
        }
      }
      if (ancien.actif !== actif) {
        await client.query(`UPDATE profiles SET actif=$2 WHERE agent_id=$1::uuid`, [id, actif]);
        await client.query(`UPDATE identifiants_application c SET session_version=session_version+1, updated_at=now() FROM profiles p WHERE p.user_id=c.user_id AND p.agent_id=$1::uuid`, [id]);
      }
      const lu = await client.query(`${SQL_AGENT} WHERE a.id=$1::uuid`, [id]);
      const agent = convertirAgent(lu.rows[0]!);
      await audit(client, acteurId, "agent_modifie", "agents", id, pourAudit(ancien), pourAudit(agent), ip);
      let compteAgent: ResultatCompteAgent | undefined;
      if (agent.actif && (changements.matricule !== undefined || changements.telephone !== undefined || changements.actif === true)) {
        compteAgent = await creerCompteAgentDansTransaction(client, { id, matricule: agent.matricule, telephone: agent.telephone, actif: agent.actif }, acteurId, ip);
        // Compte déjà existant et matricule corrigé : l'identifiant de connexion suit le matricule (sauf conflit, ignoré sans bloquer la modification).
        if (!compteAgent.cree && compteAgent.raison === "deja_existant" && changements.matricule !== undefined && agent.matricule && agent.matricule !== ancien.matricule) {
          const nouvelId = agent.matricule.trim().toLowerCase();
          if (nouvelId.length >= 3 && nouvelId.length <= 80) {
            await client.query("SAVEPOINT suivi_identifiant");
            try {
              const maj = await client.query(`UPDATE identifiants_application c SET identifiant=$2, updated_at=now() FROM profiles p WHERE p.user_id=c.user_id AND p.agent_id=$1::uuid AND p.role='brancardier'::role_code AND lower(c.identifiant) <> $2 RETURNING c.user_id::text AS id`, [id, nouvelId]);
              if (maj.rows[0]) await client.query(`INSERT INTO journal_audit (user_id, action, objet_table, objet_id, nouvelle_valeur, motif, ip) VALUES ($1::uuid,$2,$3,$4,$5::jsonb,$6,$7)`, [acteurId, "identifiant_agent_suit_matricule", "identifiants_application", txt(maj.rows[0].id), JSON.stringify({ identifiantModifie: true }), "Matricule corrigé : l’identifiant de connexion suit le matricule", ip.slice(0, 45)]);
              await client.query("RELEASE SAVEPOINT suivi_identifiant");
            } catch (e) {
              await client.query("ROLLBACK TO SAVEPOINT suivi_identifiant");
              if ((e as { code?: unknown }).code !== "23505") throw e;
            }
          }
        }
      }
      await client.query("COMMIT"); ouverte = false; return compteAgent ? { ...agent, compteAgent } : agent;
    } catch (e) { if (ouverte) await client.query("ROLLBACK").catch(() => {}); if (e instanceof ErreurRegime) throw e; tradErreur(e, "agent"); }
    finally { client.release(); }
  }
}
