// Tableau de rotation des Urgences : une ligne par poste, avec repos, reprise et repères week-end / jour férié.
import { dakarDateTime, dakarParts } from "../../shared/time.ts";
import { versCsv } from "../../rapports/csv.ts";
import type { Colonne } from "../../rapports/csv.ts";
import { ErreurRegime } from "../../shared/types.ts";
import { estPosteDuDimanche, estPosteDuVendredi, genererRotationUrgences } from "./index.ts";
import { APRES_PASSAGE_DEFAUT } from "./index.ts";
import type { ApresPassageNuitJour } from "./index.ts";

export interface AgentRotation { nom: string; equipe: "jour" | "nuit"; premierJour: string } // premierJour : AAAA-MM-JJ
export interface LigneRotation {
  agent: string; equipe: "Jour" | "Nuit"; jourTravail: string; priseService: string; finService: string;
  reposDebut: string; reposFin: string; dureeReposH: number; reprise: string; equipeReprise: "Jour" | "Nuit"; regle: string; weekend: string; ferie: string;
}

const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const p2 = (n: number) => String(n).padStart(2, "0");
const date = (d: Date) => { const p = dakarParts(d); return `${JOURS[p.isoWeekday]} ${p2(p.day)}/${p2(p.month)}/${p.year}`; };
const heure = (d: Date) => { const p = dakarParts(d); return `${p2(p.hour)} h ${p2(p.minute)}`; };
const dateHeure = (d: Date) => `${date(d)} à ${heure(d)}`;
const cle = (d: Date) => { const p = dakarParts(d); return `${p.year}-${p2(p.month)}-${p2(p.day)}`; };

function civil(s: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new ErreurRegime("requete_invalide", `Date invalide : « ${s} » (format AAAA-MM-JJ).`);
  const [a, mo, j] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(a, mo - 1, j));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== j) throw new ErreurRegime("requete_invalide", `Date inexistante : ${s}.`);
  return [a, mo, j];
}

/** Construit les lignes du tableau pour tous les agents sur la période [du ; au] (dates AAAA-MM-JJ, heure de Dakar). */
export function construireTableauRotation(agents: readonly AgentRotation[], du: string, au: string, joursFeries: ReadonlySet<string> = new Set(), variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): LigneRotation[] {
  civil(du); civil(au);
  if (au < du) throw new ErreurRegime("requete_invalide", "La date de fin précède la date de début.");
  const lignes: LigneRotation[] = [];
  for (const a of agents) {
    const [y, m, d] = civil(a.premierJour);
    const premier = dakarDateTime(y, m, d, a.equipe === "jour" ? 8 : 20);
    const cycle = genererRotationUrgences(a.equipe, premier, 400, variante);
    for (const [i, p] of cycle.postes.entries()) {
      const jourDebut = cle(p.debut);
      if (jourDebut < du) continue;
      if (jourDebut > au) break;
      const nuit = p.type === "nuit";
      const r = cycle.repos[i];
      const suivant = cycle.postes[i + 1];
      const precedent = cycle.postes[i - 1];
      const apresNuitVendredi = !!precedent && precedent.type === "nuit" && estPosteDuVendredi(precedent);
      const iso = dakarParts(p.debut).isoWeekday;
      const feries = [jourDebut, ...(nuit ? [cle(p.fin)] : [])].filter((j) => joursFeries.has(j));
      let regle = "";
      if (estPosteDuVendredi(p)) regle = nuit ? "Vendredi : passage à l'équipe de jour, reprise le dimanche à 08 h" : "Vendredi : reprise le mardi à 08 h";
      else if (estPosteDuDimanche(p) && !nuit) regle = apresNuitVendredi && suivant?.type === "jour" ? "Dimanche après la nuit du vendredi : 36 h de repos, reprise de la rotation de jour le mardi à 08 h" : "Dimanche : passage à l'équipe de nuit, reprise le lundi à 20 h";
      lignes.push({
        agent: a.nom, equipe: nuit ? "Nuit" : "Jour",
        jourTravail: date(p.debut), priseService: heure(p.debut), finService: nuit ? `${heure(p.fin)} (lendemain)` : heure(p.fin),
        reposDebut: dateHeure(r.debut), reposFin: dateHeure(r.fin), dureeReposH: (r.fin.getTime() - r.debut.getTime()) / 3_600_000,
        reprise: dateHeure(r.fin), equipeReprise: suivant?.type === "nuit" ? "Nuit" : "Jour", regle,
        weekend: nuit ? (iso === 5 ? "Nuit du vendredi au samedi" : iso === 6 ? "Nuit du samedi au dimanche" : iso === 7 ? "Nuit du dimanche au lundi" : "") : (iso === 6 ? "Samedi travaillé" : iso === 7 ? "Dimanche travaillé" : ""),
        ferie: feries.length ? `Jour férié travaillé (${feries.join(", ")})` : "",
      });
    }
  }
  return lignes;
}

const COLONNES: Colonne[] = [
  { cle: "agent", titre: "Agent" }, { cle: "equipe", titre: "Équipe" }, { cle: "jourTravail", titre: "Jour de travail" },
  { cle: "priseService", titre: "Prise de service" }, { cle: "finService", titre: "Fin de service" },
  { cle: "reposDebut", titre: "Début du repos" }, { cle: "reposFin", titre: "Fin du repos" }, { cle: "dureeReposH", titre: "Durée du repos (h)" },
  { cle: "reprise", titre: "Reprise de service" }, { cle: "equipeReprise", titre: "Équipe à la reprise" }, { cle: "regle", titre: "Règle du vendredi / passage d'équipe" }, { cle: "weekend", titre: "Week-end" }, { cle: "ferie", titre: "Jour férié" },
];
export const tableauRotationCsv = (lignes: readonly LigneRotation[]): string => versCsv(COLONNES, lignes as unknown as Record<string, unknown>[]);

/** Nombre d'agents qui commencent un poste chaque jour (heure de Dakar), par équipe, pour repérer les jours sans couverture. */
export function couvertureParJour(lignes: readonly LigneRotation[], du: string, au: string): Array<{ date: string; jour: number; nuit: number }> {
  const [a, m, j] = civil(du); civil(au);
  const out: Array<{ date: string; jour: number; nuit: number }> = [];
  for (let i = 0; i < 400; i++) {
    const d = dakarDateTime(a, m, j + i, 12);
    const k = cle(d);
    if (k > au) break;
    const etiquette = date(d);
    out.push({ date: etiquette, jour: lignes.filter((l) => l.equipe === "Jour" && l.jourTravail === etiquette).length, nuit: lignes.filter((l) => l.equipe === "Nuit" && l.jourTravail === etiquette).length });
  }
  return out;
}
