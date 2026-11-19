// Routes du calendrier des jours fériés (/api/jours-feries). Extraites de routes.ts ; même logique et mêmes droits :
// lecture pour les responsables et l'administrateur, modification réservée à l'administrateur.
// Retourne `undefined` quand la requête ne concerne pas cette route (le routeur poursuit alors son parcours).
import { parseCle } from "../shared/civil.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";
import { json, objet } from "./reponses.ts";

export async function routeJoursFeries(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  if (chemin === "/api/jours-feries" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Accès au calendrier réservé aux responsables et à l'administrateur.");
    return json(200, { joursFeries: [...m.joursFeries.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  if (chemin === "/api/jours-feries" && methode === "POST") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut modifier le calendrier des jours fériés.");
    const c = objet(req.corps);
    const date = typeof c.date === "string" ? c.date : "";
    try { parseCle(date); } catch { throw new ErreurRegime("requete_invalide", "Date invalide : utilisez AAAA-MM-JJ."); }
    const nom = typeof c.nom === "string" ? c.nom.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const note = typeof c.note === "string" ? c.note.trim().slice(0, 300) : "";
    if (!nom) throw new ErreurRegime("requete_invalide", "Le nom du jour férié est obligatoire.");
    if (m.joursFeries.has(date)) throw new ErreurRegime("conflit", "Cette date est déjà enregistrée.");
    try { await m.ajouterJourFerie({ date, nom, note: note || null, creePar: user.id, creeLe: now.toISOString() }); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Impossible d'ajouter la date."); }
    let impact: { retires: number; aExaminer: string[] };
    try { impact = await m.appliquerJourFerie(date); }
    catch (e) {
      // Si l'ajustement des plannings échoue, ne pas laisser un calendrier partiellement appliqué.
      try { await m.supprimerJourFerie(date); } catch { /* la sauvegarde locale peut également être indisponible */ }
      throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Le jour férié n'a pas pu être appliqué aux plannings.");
    }
    await m.journaliser({ type: "jour_ferie_ajoute", agentId: null, at: now, detail: { auteurId: user.id, date, nom, postesGenerauxRetires: impact.retires, postesAvecPointageAExaminer: impact.aExaminer } });
    return json(201, { succes: true, jourFerie: m.joursFeries.get(date), impactPlanning: impact, message: impact.aExaminer.length ? `${impact.retires} poste(s) retiré(s) sans historique ; ${impact.aExaminer.length} poste(s) avec pointage doivent être examinés.` : `${impact.retires} poste(s) général(aux) non pointé(s) retiré(s) du jour férié.` });
  }
  const matchFerie = /^\/api\/jours-feries\/(\d{4}-\d{2}-\d{2})$/.exec(chemin);
  if (matchFerie && methode === "DELETE") {
    if (user.role !== "administrateur") throw new ErreurRegime("non_autorise", "Seul l'administrateur peut modifier le calendrier des jours fériés.");
    try { parseCle(matchFerie[1]); } catch { throw new ErreurRegime("requete_invalide", "Date invalide."); }
    try { await m.supprimerJourFerie(matchFerie[1]); }
    catch (e) { throw new ErreurRegime("introuvable", e instanceof Error ? e.message : "Jour férié introuvable."); }
    await m.journaliser({ type: "jour_ferie_supprime", agentId: null, at: now, detail: { auteurId: user.id, date: matchFerie[1] } });
    return json(200, { succes: true });
  }
  return undefined;
}
