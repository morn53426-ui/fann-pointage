// Routes du classement mensuel (/api/classement-mensuel et /api/classement-mensuel/generer) du mode démo : consultation JSON/CSV
// (un responsable ne reçoit que ses services) et calcul réservé à l'administrateur.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { randomUUID } from "node:crypto";
import { genererRapport } from "../rapports/rapport.ts";
import { ErreurRegime } from "../shared/types.ts";
import type { ActeurApp } from "../dashboard/donnees.ts";
import type { ClassementMensuel, EntreeClassement } from "../classement/types.ts";
import { exporterClassementMensuelCsv } from "../classement/export.ts";
import { convertirRapportEnMesures, validerMois, creerClassementMensuel } from "../classement/classement.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { json, objet } from "./reponses.ts";

/** Un responsable ne reçoit que le classement de ses services, y compris dans le Top 5 et l'audit. */
function classementVisiblePour(user: Utilisateur, source: ClassementMensuel, m: MagasinDemo): ClassementMensuel {
  if (user.role === "administrateur") return source;
  const agentsAutorises = new Set(m.infosAgents
    .filter((a) => user.servicesGeres.includes(a.serviceId))
    .map((a) => a.id));
  const classement = source.classement
    .filter((e) => agentsAutorises.has(e.agentId))
    .map((e, i) => ({ ...e, rang: i + 1 }));
  const idsVisibles = new Set(classement.map((e) => e.agentId));
  const top5 = classement.slice(0, 5);
  const scores = source.scores.filter((score) => idsVisibles.has(score.agentId));
  const top5Audit = top5.map((e: EntreeClassement) => ({ agentId: e.agentId, rang: e.rang, score: e.score }));
  const audit = source.audit.map((evenement) => ({
    ...evenement,
    detail: { ...evenement.detail, agentsClasses: classement.length, top5: top5Audit },
  }));
  return { ...source, scores, classement, top5, audit };
}
function peutVoirClassement(user: Utilisateur): boolean {
  return user.role === "administrateur" || user.role === "responsable";
}

export async function routeClassement(req: Requete, user: Utilisateur, acteur: ActeurApp, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  // Classement mensuel par points : aucun statut de prime, versement ou référence de paiement.
  if (chemin === "/api/classement-mensuel" && methode === "GET") {
    if (!peutVoirClassement(user)) throw new ErreurRegime("non_autorise", "Accès au classement mensuel réservé aux responsables et à l'administrateur.");
    const mois = validerMois(req.requete.mois ?? "");
    const classementSource = m.classementsMensuels.get(mois);
    const format = req.requete.format ?? "json";
    const generationPossible = mois < `${now.toISOString().slice(0, 7)}-01`;
    if (!classementSource) return json(200, { mois, classement: null, top5: [], generationPossible });
    const classement = classementVisiblePour(user, classementSource, m);
    if (format === "csv") {
      const out = exporterClassementMensuelCsv(classement);
      return { statut: 200, texte: out.csv, typeContenu: "text/csv; charset=utf-8", entetes: { "Content-Disposition": `attachment; filename="${out.nomFichier}"` } };
    }
    if (format !== "json") throw new ErreurRegime("requete_invalide", "Format attendu : json ou csv.");
    return json(200, { mois, classement, top5: classement.top5, generationPossible: false });
  }

  if (chemin === "/api/classement-mensuel/generer" && methode === "POST") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut calculer un classement mensuel.");
    const c = objet(req.corps);
    const mois = validerMois(typeof c.mois === "string" ? c.mois : "");
    const premierMoisCourant = `${now.toISOString().slice(0, 7)}-01`;
    if (mois >= premierMoisCourant) throw new ErreurRegime("requete_invalide", "Le classement ne peut être calculé qu'après la fin du mois concerné.");
    if (m.classementsMensuels.has(mois)) throw new ErreurRegime("conflit", "Un classement existe déjà pour ce mois.");
    const rapport = genererRapport(m.donnees(), acteur, "mois", mois, now);
    const debutMois = `${mois.slice(0, 7)}-01`;
    const finMois = new Date(`${mois.slice(0, 7)}-01T00:00:00Z`);
    finMois.setUTCMonth(finMois.getUTCMonth() + 1);
    const absencesMois = [...m.absences.values()].filter((a) => a.statut === "injustifiee" && a.fin >= debutMois && a.debut < finMois.toISOString().slice(0, 10));
    const mesures = convertirRapportEnMesures(m.infosAgents, m.services, rapport.lignes, absencesMois);
    const classement = creerClassementMensuel({ id: randomUUID(), mois, agents: mesures, regles: m.reglesScore, generePar: user.id, maintenant: now });
    try { await m.enregistrerClassementMensuel(mois, classement); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Impossible de conserver le classement."); }
    await m.journaliser({ type: "classement_mensuel_genere", agentId: null, at: now, detail: { mois, classementId: classement.id, auteur: user.id, nombreAgents: classement.classement.length, top5: classement.top5.map((a) => ({ agentId: a.agentId, rang: a.rang, score: a.score })) } });
    return json(201, { mois, classement, top5: classement.top5, generationPossible: false });
  }

  return undefined;
}
