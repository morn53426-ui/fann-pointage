// RÉGIME C : Urgences, rotation en continu de deux équipes (jour 08 h-20 h, nuit 20 h-08 h le lendemain).
// Repos habituel : 36 h après un poste de jour, 60 h après un poste de nuit (débuts espacés de 48 h / 72 h).
// Règle du vendredi (jour) : après 08 h-20 h le vendredi, reprise le mardi à 08 h.
// Passage jour -> nuit : après un poste de jour le dimanche, poste de nuit le lundi à 20 h (repos exceptionnel de 24 h).
// Passage nuit -> jour : après une nuit commencée le vendredi à 20 h, poste de jour le dimanche à 08 h (repos exceptionnel de 24 h),
// puis 36 h de repos (reprise le mardi à 08 h) et poursuite de la rotation de jour.
// Les samedis, dimanches et jours fériés suivent la rotation normale (aucun jour férié ne supprime un poste).
import { evaluerPresence, PARAMS_PRESENCE_DEFAUT } from "../../shared/presence.ts";
import type { ParamsPresence } from "../../shared/presence.ts";
import { dakarDateTime, dakarParts } from "../../shared/time.ts";
import { ErreurRegime, MS_HEURE, posteId } from "../../shared/types.ts";
import type { Conflit, Periode, Poste } from "../../shared/types.ts";

export const DUREE_POSTE_H = 12;
export const REPOS_APRES_JOUR_H = 36;
export const REPOS_APRES_NUIT_H = 60;
export const CYCLE_NUIT_H = 72;
const VENDREDI = 5;
const DIMANCHE = 7;

export type EquipeUrgences = "jour" | "nuit";
/**
 * Suite du dimanche de jour issu du passage nuit -> jour : "jour" (défaut, règle validée) = 36 h de repos puis rotation de jour (mardi 08 h) ;
 * "nuit" = application aussi de la règle « dimanche de jour -> nuit du lundi 20 h » (boucle fermée de 21 jours).
 */
export type ApresPassageNuitJour = "nuit" | "jour";
export const APRES_PASSAGE_DEFAUT: ApresPassageNuitJour = "jour";

function exiger(p: Poste): void {
  if (p.regime !== "urgences" || (p.type !== "jour" && p.type !== "nuit")) {
    throw new ErreurRegime("regime_invalide", `Poste ${p.posteId} hors régime urgences`);
  }
}
function exigerHeure(d: Date, h: number, quoi: string): void {
  const p = dakarParts(d);
  if (p.hour !== h || p.minute !== 0 || p.second !== 0) throw new ErreurRegime("horaire_invalide", `${quoi} : début attendu à ${h} h 00`);
}

export function creerPosteJour(debut: Date): Poste {
  exigerHeure(debut, 8, "Poste de jour");
  return { posteId: posteId("urgences", "jour", debut), regime: "urgences", type: "jour", debut, fin: new Date(debut.getTime() + DUREE_POSTE_H * MS_HEURE) };
}

export function creerPosteNuit(debut: Date): Poste {
  exigerHeure(debut, 20, "Poste de nuit");
  return { posteId: posteId("urgences", "nuit", debut), regime: "urgences", type: "nuit", debut, fin: new Date(debut.getTime() + DUREE_POSTE_H * MS_HEURE) };
}

/** Repos habituel minimal après un poste : 36 h (jour) ou 60 h (nuit), à partir de la fin (réelle si fournie). */
export function periodeRepos(poste: Poste, finReelle?: Date): Periode {
  exiger(poste);
  const debut = finReelle ?? poste.fin;
  const heures = poste.type === "jour" ? REPOS_APRES_JOUR_H : REPOS_APRES_NUIT_H;
  return { debut, fin: new Date(debut.getTime() + heures * MS_HEURE) };
}

/** Vrai si le poste a commencé un vendredi (heure de Dakar). */
export const estPosteDuVendredi = (poste: Poste): boolean => dakarParts(poste.debut).isoWeekday === VENDREDI;
/** Vrai si le poste a commencé un dimanche (heure de Dakar). */
export const estPosteDuDimanche = (poste: Poste): boolean => dakarParts(poste.debut).isoWeekday === DIMANCHE;

export interface SuiteRotation { type: EquipeUrgences; debut: Date; passage: boolean }

const debutLe = (debut: Date, jours: number, heure: number): Date => {
  const p = dakarParts(debut);
  return dakarDateTime(p.year, p.month, p.day + jours, heure);
};

/**
 * Poste suivant dans la rotation, calculé depuis le début du poste courant.
 * - jour : +48 h ; vendredi -> mardi 08 h ; dimanche -> nuit du lundi 20 h (passage), sauf dimanche issu du passage nuit -> jour (36 h puis jour, variante par défaut) ;
 * - nuit : +72 h (60 h de repos) ; vendredi -> jour du dimanche 08 h (passage).
 * `issuDePassage` : le poste courant a été atteint par un passage d'équipe (utile pour la variante « jour »).
 */
export function suiteRotation(type: EquipeUrgences, debut: Date, issuDePassage = false, variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): SuiteRotation {
  const jour = dakarParts(debut).isoWeekday;
  if (type === "jour") {
    if (jour === DIMANCHE) {
      if (issuDePassage && variante === "jour") return { type: "jour", debut: debutLe(debut, 2, 8), passage: false };
      return { type: "nuit", debut: debutLe(debut, 1, 20), passage: true };
    }
    return { type: "jour", debut: debutLe(debut, jour === VENDREDI ? 4 : 2, 8), passage: false };
  }
  if (jour === VENDREDI) return { type: "jour", debut: debutLe(debut, 2, 8), passage: true };
  return { type: "nuit", debut: debutLe(debut, 3, 20), passage: false };
}

/** Reprise prévue : début du poste suivant de la rotation (jamais avant la fin du repos habituel, sauf passage d'équipe). */
export function prochainPosteDebut(poste: Poste, finReelle?: Date, issuDePassage = false, variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): Date {
  exiger(poste);
  const s = suiteRotation(poste.type as EquipeUrgences, poste.debut, issuDePassage, variante);
  if (s.passage) return s.debut;
  const reposFin = periodeRepos(poste, finReelle).fin;
  return s.debut > reposFin ? s.debut : reposFin;
}

/** Période de repos effective, de la fin du poste à la reprise prévue (84 h après un vendredi de jour, 24 h lors d'un passage). */
export const periodeReposPrevue = (poste: Poste, finReelle?: Date, issuDePassage = false, variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): Periode => ({ debut: finReelle ?? poste.fin, fin: prochainPosteDebut(poste, finReelle, issuDePassage, variante) });

export interface CycleUrgences { postes: Poste[]; repos: Periode[] }

/** Génère `nombre` postes consécutifs de la rotation à partir de `premierDebut`, passages d'équipe compris. */
export function genererRotationUrgences(type: EquipeUrgences, premierDebut: Date, nombre: number, variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): CycleUrgences {
  exigerHeure(premierDebut, type === "jour" ? 8 : 20, type === "jour" ? "Premier poste de jour" : "Premier poste de nuit");
  if (!Number.isInteger(nombre) || nombre < 0 || nombre > 10_000) throw new ErreurRegime("requete_invalide", "Le nombre de postes doit être un entier compris entre 0 et 10000.");
  const postes: Poste[] = [], repos: Periode[] = [];
  let t = type, debut = premierDebut, issu = false;
  for (let i = 0; i < nombre; i++) {
    const p = t === "jour" ? creerPosteJour(debut) : creerPosteNuit(debut);
    const s = suiteRotation(t, debut, issu, variante);
    postes.push(p); repos.push({ debut: p.fin, fin: s.debut });
    t = s.type; debut = s.debut; issu = s.passage;
  }
  return { postes, repos };
}

/** Rotation commençant par un poste de jour (08 h-20 h). */
export const genererCycleJourUrgences = (premierDebut: Date, nombre: number, variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): CycleUrgences => genererRotationUrgences("jour", premierDebut, nombre, variante);
/** Rotation commençant par un poste de nuit (20 h-08 h). */
export const genererCycleNuitUrgences = (premierDebut: Date, nombre: number, variante: ApresPassageNuitJour = APRES_PASSAGE_DEFAUT): CycleUrgences => genererRotationUrgences("nuit", premierDebut, nombre, variante);

export function estEnRepos(instant: Date, postes: readonly Poste[], finsReelles: ReadonlyMap<string, Date> = new Map()): boolean {
  return postes.some((p) => {
    if (p.regime !== "urgences") return false;
    const r = periodeReposPrevue(p, finsReelles.get(p.posteId));
    return instant >= r.debut && instant < r.fin;
  });
}

const MESSAGE_ECART: Record<string, string> = {
  "jour-vendredi": "Après un poste de jour le vendredi, la reprise est prévue le mardi à 08 h",
  "jour-dimanche": "Après un poste de jour le dimanche, passage à l'équipe de nuit : poste le lundi à 20 h",
  "nuit-vendredi": "Après une nuit commencée le vendredi, passage à l'équipe de jour : poste le dimanche à 08 h",
};

/** Vérifie les postes d'un agent : chevauchements, repos habituel (36 h jour / 60 h nuit) et respect de la rotation (vendredi, passages d'équipe). */
export function verifierPostesUrgences(postes: readonly Poste[], finsReelles: ReadonlyMap<string, Date> = new Map()): Conflit[] {
  postes.forEach(exiger);
  const tri = [...postes].sort((a, b) => a.debut.getTime() - b.debut.getTime());
  const out: Conflit[] = [];
  for (let i = 0; i + 1 < tri.length; i++) {
    const a = tri[i], b = tri[i + 1];
    const ids = [a.posteId, b.posteId];
    if (b.debut < a.fin) {
      out.push({ code: "chevauchement", gravite: "erreur", message: "Deux postes se chevauchent", posteIds: ids });
      continue;
    }
    // Suites conformes : la rotation normale, et (variante « jour ») la reprise de jour après le dimanche issu du passage nuit -> jour.
    const precedent = tri[i - 1];
    const aIssuDePassage = !!precedent && suiteRotation(precedent.type as EquipeUrgences, precedent.debut).passage && suiteRotation(precedent.type as EquipeUrgences, precedent.debut).debut.getTime() === a.debut.getTime();
    const prevues = [suiteRotation(a.type as EquipeUrgences, a.debut, aIssuDePassage, "nuit"), suiteRotation(a.type as EquipeUrgences, a.debut, aIssuDePassage, "jour")];
    const r = periodeRepos(a, finsReelles.get(a.posteId));
    const conforme = prevues.find((s) => s.type === b.type && s.debut.getTime() === b.debut.getTime());
    // Un passage d'équipe est une exception au repos habituel ; la rotation normale doit, elle, respecter le repos calculé depuis la fin réelle du poste.
    if (conforme && (conforme.passage || b.debut >= r.fin)) continue;
    if (b.debut < r.fin) {
      out.push({ code: "repos_insuffisant", gravite: "erreur", message: `Repos de ${a.type === "jour" ? REPOS_APRES_JOUR_H : REPOS_APRES_NUIT_H} h non respecté après le poste de ${a.type === "jour" ? "jour" : "nuit"}`, posteIds: ids });
      continue;
    }
    const prevue = prevues[0];
    const cle = a.type === "jour" ? (estPosteDuVendredi(a) ? "jour-vendredi" : estPosteDuDimanche(a) ? "jour-dimanche" : "") : (estPosteDuVendredi(a) ? "nuit-vendredi" : "");
    if (cle && (b.type !== prevue.type || b.debut < prevue.debut)) {
      out.push({ code: cle.endsWith("dimanche") ? "passage_equipe" : "reprise_vendredi", gravite: "avertissement", message: MESSAGE_ECART[cle], posteIds: ids });
    } else if (a.type !== b.type) {
      out.push({ code: "sequence_invalide", gravite: "avertissement", message: "Changement d'équipe hors des passages prévus par la rotation (dimanche de jour vers lundi de nuit, vendredi de nuit vers dimanche de jour)", posteIds: ids });
    }
  }
  return out;
}

export const evaluerPresenceUrgences = (
  poste: Poste,
  pointages: { arrivee?: Date | null; depart?: Date | null },
  maintenant: Date,
  params: ParamsPresence = PARAMS_PRESENCE_DEFAUT,
) => { exiger(poste); return evaluerPresence(poste, pointages, maintenant, params); };
