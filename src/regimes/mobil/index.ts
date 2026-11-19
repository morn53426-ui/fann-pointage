// RÉGIME MOBIL :
// - équipe de jour : 08 h–16 h, du lundi au vendredi (week-ends exclus ; les jours fériés
//   restent exclus par défaut, sauf exception expressément autorisée) ;
// - équipe de garde : 16 h–08 h les jours ouvrés non fériés ; 08 h–08 h (24 h) le samedi,
//   le dimanche ou un jour férié ;
// - repos obligatoire d'au moins 56 h après la fin de chaque garde.
import { evaluerPresence, PARAMS_PRESENCE_DEFAUT } from "../../shared/presence.ts";
import type { ParamsPresence } from "../../shared/presence.ts";
import { addDays, cle, civilDeInstant, isoWeekday, jours, type CivilDate } from "../../shared/civil.ts";
import { dakarDateTime, dakarParts } from "../../shared/time.ts";
import { ErreurRegime, MS_HEURE, posteId } from "../../shared/types.ts";
import type { Conflit, Periode, Poste } from "../../shared/types.ts";

export const DUREE_JOUR_H = 8;
export const DUREE_NUIT_H = 16;
export const DUREE_GARDE_24H_H = 24;
export const REPOS_APRES_NUIT_H = 56;

export interface OptionsJoursMobil {
  /** Exceptions explicites, à demander par un responsable/administrateur dans l'API. */
  inclureWeekEnds?: boolean;
  inclureJoursFeries?: boolean;
}

function exigerMobil(p: Poste): void {
  if (p.regime !== "mobil" || (p.type !== "jour" && p.type !== "nuit")) {
    throw new ErreurRegime("regime_invalide", `Poste ${p.posteId} hors régime Mobil`);
  }
}
function exigerHeure(d: Date, heure: number, quoi: string): void {
  const p = dakarParts(d);
  if (p.hour !== heure || p.minute !== 0 || p.second !== 0 || d.getUTCMilliseconds() !== 0) {
    throw new ErreurRegime("horaire_invalide", `${quoi} doit commencer à ${String(heure).padStart(2, "0")} h 00, heure de Dakar`);
  }
}

/** Une garde Mobil fait 24 h si sa date de début est un week-end ou un jour férié. */
export function estGarde24hMobil(date: Date | CivilDate, joursFeries: ReadonlySet<string> = new Set()): boolean {
  const civil = date instanceof Date ? civilDeInstant(date) : date;
  return isoWeekday(civil) >= 6 || joursFeries.has(cle(civil));
}

/** Heure de prise de service de la garde Mobil selon le calendrier de Dakar. */
export function heureDebutNuitMobil(date: Date | CivilDate, joursFeries: ReadonlySet<string> = new Set()): 8 | 16 {
  return estGarde24hMobil(date, joursFeries) ? 8 : 16;
}

/** Durée attendue d'une garde Mobil selon la date de début. */
export function dureeNuitMobil(date: Date | CivilDate, joursFeries: ReadonlySet<string> = new Set()): 16 | 24 {
  return estGarde24hMobil(date, joursFeries) ? 24 : 16;
}

export function creerPosteJourMobil(debut: Date): Poste {
  exigerHeure(debut, 8, "Le poste de jour Mobil");
  return { posteId: posteId("mobil", "jour", debut), regime: "mobil", type: "jour", debut, fin: new Date(debut.getTime() + DUREE_JOUR_H * MS_HEURE) };
}

/** Crée une garde Mobil : 16 h les jours ouvrés, 24 h les week-ends/jours fériés. */
export function creerPosteNuitMobil(debut: Date, joursFeries: ReadonlySet<string> = new Set()): Poste {
  const heure = heureDebutNuitMobil(debut, joursFeries);
  exigerHeure(debut, heure, "La garde Mobil");
  const duree = dureeNuitMobil(debut, joursFeries);
  return { posteId: posteId("mobil", "nuit", debut), regime: "mobil", type: "nuit", debut, fin: new Date(debut.getTime() + duree * MS_HEURE) };
}

/** Jour 08 h–16 h : lundi–vendredi, sauf jours fériés par défaut, sauf exception explicite. */
export function genererJoursMobil(debut: CivilDate, fin: CivilDate, joursFeries: ReadonlySet<string> = new Set(), options: OptionsJoursMobil = {}): Poste[] {
  return jours(debut, fin)
    .filter((j) => (options.inclureWeekEnds === true || isoWeekday(j) <= 5)
      && (options.inclureJoursFeries === true || !joursFeries.has(cle(j))))
    .map((j) => creerPosteJourMobil(dakarDateTime(j.year, j.month, j.day, 8)));
}

/**
 * Génère les gardes successives d'un agent.
 * Le repos commence à la fin réelle/prévue du poste et dure au moins 56 h. La prochaine
 * prise est ensuite alignée sur le calendrier : 16 h en semaine, 08 h le week-end/jour férié.
 * Le premier argument identifie la date de première garde ; son heure est recalculée.
 */
export function genererCycleNuitsMobil(premiereDate: Date, nombre: number, joursFeries: ReadonlySet<string> = new Set()): Poste[] {
  if (!Number.isInteger(nombre) || nombre < 0 || nombre > 1000) throw new ErreurRegime("requete_invalide", "Nombre de gardes Mobil invalide.");
  let date = civilDeInstant(premiereDate);
  const postes: Poste[] = [];
  for (let i = 0; i < nombre; i++) {
    const heure = heureDebutNuitMobil(date, joursFeries);
    const debut = dakarDateTime(date.year, date.month, date.day, heure);
    const poste = creerPosteNuitMobil(debut, joursFeries);
    postes.push(poste);

    const repriseAuPlusTot = new Date(poste.fin.getTime() + REPOS_APRES_NUIT_H * MS_HEURE);
    let dateCandidate = civilDeInstant(repriseAuPlusTot);
    // Trouver le premier début autorisé qui ne viole pas le repos. Si 08 h est déjà passé
    // (ex. fin de repos samedi à 16 h), passer au prochain jour de garde possible.
    for (let essais = 0; essais < 370; essais++) {
      const heureCandidate = heureDebutNuitMobil(dateCandidate, joursFeries);
      const candidat = dakarDateTime(dateCandidate.year, dateCandidate.month, dateCandidate.day, heureCandidate);
      if (candidat.getTime() >= repriseAuPlusTot.getTime()) {
        date = dateCandidate;
        break;
      }
      dateCandidate = addDays(dateCandidate, 1);
      if (essais === 369) throw new ErreurRegime("config_invalide", "Impossible de trouver une prochaine garde Mobil compatible avec les 56 h de repos.");
    }
  }
  return postes;
}

/** Repos après une garde de nuit ou de 24 h, calculé depuis la vraie fin si elle est disponible. */
export function periodeReposNuitMobil(nuit: Poste, finReelle?: Date): Periode {
  exigerMobil(nuit);
  if (nuit.type !== "nuit") throw new ErreurRegime("type_invalide", "Les 56 heures de repos Mobil s'appliquent après une garde.");
  const debut = finReelle ?? nuit.fin;
  return { debut, fin: new Date(debut.getTime() + REPOS_APRES_NUIT_H * MS_HEURE) };
}

export function estEnReposMobil(instant: Date, postes: readonly Poste[], finsReelles: ReadonlyMap<string, Date> = new Map()): boolean {
  return postes.some((p) => p.regime === "mobil" && p.type === "nuit" && (() => {
    const r = periodeReposNuitMobil(p, finsReelles.get(p.posteId));
    return instant >= r.debut && instant < r.fin;
  })());
}

/** Contrôle les chevauchements et les 56 h de repos après chaque garde Mobil. */
export function verifierPlanningsMobil(postes: readonly Poste[], finsReelles: ReadonlyMap<string, Date> = new Map()): Conflit[] {
  const tri = [...postes].sort((a, b) => a.debut.getTime() - b.debut.getTime());
  const out: Conflit[] = [];
  for (const p of tri) if (p.regime === "mobil") exigerMobil(p);
  for (let i = 0; i + 1 < tri.length; i++) {
    const a = tri[i]!, b = tri[i + 1]!;
    if (b.debut < a.fin) out.push({ code: "chevauchement", gravite: "erreur", message: "Deux postes se chevauchent", posteIds: [a.posteId, b.posteId] });
  }
  for (const garde of tri.filter((p) => p.regime === "mobil" && p.type === "nuit")) {
    const repos = periodeReposNuitMobil(garde, finsReelles.get(garde.posteId));
    const suivante = tri.find((p) => p.posteId !== garde.posteId && p.debut >= garde.fin);
    if (suivante && suivante.debut < repos.fin) {
      out.push({ code: "repos_insuffisant", gravite: "erreur", message: `Repos de ${REPOS_APRES_NUIT_H} h non respecté après une garde Mobil`, posteIds: [garde.posteId, suivante.posteId] });
    }
  }
  return out;
}

export const evaluerPresenceMobil = (poste: Poste, pointages: { arrivee?: Date | null; depart?: Date | null }, maintenant: Date, params: ParamsPresence = PARAMS_PRESENCE_DEFAUT) => {
  exigerMobil(poste);
  return evaluerPresence(poste, pointages, maintenant, params);
};
