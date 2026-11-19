// Routes du registre d'absences (/api/absences) : seules les décisions motivées d'un responsable autorisé deviennent définitives.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas cette route.
import { randomUUID } from "node:crypto";
import { versCsv } from "../rapports/csv.ts";
import { parseCle } from "../shared/civil.ts";
import type { AbsenceEnregistree, StatutAbsence } from "./magasin.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";
import { json, objet } from "./reponses.ts";

export async function routeAbsences(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  if (chemin === "/api/absences" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Accès au registre réservé aux responsables et à l’administrateur.");
    const agentsVisibles = new Map(m.infosAgents.filter((a) => user.role === "administrateur" || user.servicesGeres.includes(a.serviceId)).map((a) => [a.id, a] as const));
    const absences = [...m.absences.values()].filter((a) => agentsVisibles.has(a.agentId)).map((a) => {
      const agent = agentsVisibles.get(a.agentId)!;
      return { ...a, agent: `${agent.prenom} ${agent.nom}`, serviceId: agent.serviceId, service: m.services.find((s) => s.id === agent.serviceId)?.nom ?? agent.serviceId };
    }).sort((a, b) => b.debut.localeCompare(a.debut));
    const format = req.requete.format ?? "json";
    if (format === "csv") {
      const colonnes = [
        { cle: "agent", titre: "Agent" }, { cle: "service", titre: "Service" },
        { cle: "debut", titre: "Début" }, { cle: "fin", titre: "Fin" },
        { cle: "categorie", titre: "Catégorie" }, { cle: "statut", titre: "Statut" },
        { cle: "note", titre: "Note administrative" }, { cle: "creeLe", titre: "Enregistrée le" },
        { cle: "valideLe", titre: "Décidée le" }, { cle: "motifValidation", titre: "Motif de décision" },
      ];
      const csv = versCsv(colonnes, absences as unknown as Record<string, unknown>[]);
      return { statut: 200, texte: csv, typeContenu: "text/csv; charset=utf-8", entetes: { "Content-Disposition": `attachment; filename="absences-${now.toISOString().slice(0, 10)}.csv"` } };
    }
    if (format !== "json") throw new ErreurRegime("requete_invalide", "Format attendu : json ou csv.");
    return json(200, { absences, categories: ["absence", "congé", "autorisation", "autre"], note: "Évitez d’inscrire un diagnostic médical dans les notes." });
  }
  if (chemin === "/api/absences" && methode === "POST") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Seuls les responsables peuvent enregistrer une absence.");
    const c = objet(req.corps);
    const agentId = typeof c.agentId === "string" ? c.agentId : "";
    const debut = typeof c.debut === "string" ? c.debut : "";
    const fin = typeof c.fin === "string" ? c.fin : "";
    try { parseCle(debut); parseCle(fin); } catch { throw new ErreurRegime("requete_invalide", "Les dates doivent être des dates réelles au format AAAA-MM-JJ."); }
    if (fin < debut) throw new ErreurRegime("requete_invalide", "La fin de l’absence précède son début.");
    const agent = m.infosAgents.find((a) => a.id === agentId && a.actif);
    if (!agent) throw new ErreurRegime("introuvable", "Agent actif introuvable.");
    if (user.role === "responsable" && !user.servicesGeres.includes(agent.serviceId)) throw new ErreurRegime("non_autorise", "Agent hors de votre périmètre de service.");
    const categories = new Set(["absence", "congé", "autorisation", "autre"]);
    const categorie = typeof c.categorie === "string" ? c.categorie : "";
    if (!categories.has(categorie)) throw new ErreurRegime("requete_invalide", "Choisissez une catégorie valide.");
    const note = typeof c.note === "string" ? c.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
    const absence: AbsenceEnregistree = { id: randomUUID(), agentId, debut, fin, categorie, note: note || null, statut: "a_confirmer", creePar: user.id, creeLe: now.toISOString(), validePar: null, valideLe: null, motifValidation: null };
    try { await m.creerAbsence(absence); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Impossible d’enregistrer l’absence."); }
    await m.journaliser({ type: "absence_enregistree_a_confirmer", agentId, at: now, detail: { absenceId: absence.id, auteurId: user.id, debut, fin, categorie } });
    return json(201, { succes: true, absence, message: "Absence enregistrée à confirmer. Elle n’impacte pas encore le classement." });
  }
  const matchAbsence = /^\/api\/absences\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
  if (matchAbsence && methode === "PATCH") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Décision réservée aux responsables et à l’administrateur.");
    const absence = m.absences.get(matchAbsence[1]);
    if (!absence) throw new ErreurRegime("introuvable", "Absence introuvable.");
    const agent = m.infosAgents.find((a) => a.id === absence.agentId);
    if (!agent || (user.role === "responsable" && !user.servicesGeres.includes(agent.serviceId))) throw new ErreurRegime("non_autorise", "Absence hors de votre périmètre.");
    const c = objet(req.corps);
    const statut = c.statut;
    if (statut !== "justifiee" && statut !== "injustifiee" && statut !== "refusee") throw new ErreurRegime("requete_invalide", "Décision attendue : justifiee, injustifiee ou refusee.");
    const motif = typeof c.motif === "string" ? c.motif.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
    if (motif.length < 4) throw new ErreurRegime("requete_invalide", "Un motif d’au moins 4 caractères est obligatoire.");
    try { await m.deciderAbsence(absence.id, statut as Exclude<StatutAbsence, "a_confirmer">, user.id, motif, now); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Décision impossible."); }
    await m.journaliser({ type: "absence_decidee", agentId: absence.agentId, at: now, detail: { absenceId: absence.id, auteurId: user.id, statut, motif } });
    return json(200, { succes: true, message: `Absence marquée « ${statut} ».`, absence: m.absences.get(absence.id) });
  }
  return undefined;
}
