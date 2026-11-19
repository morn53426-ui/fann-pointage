// RÉGIME A : SERVICE GÉNÉRAL (08 h à 16 h). Indépendant des gardes et des urgences.
import { cle, isoWeekday } from "../../shared/civil.ts";
import type { CivilDate } from "../../shared/civil.ts";
import { evaluerPresence, PARAMS_PRESENCE_DEFAUT } from "../../shared/presence.ts";
import type { ParamsPresence } from "../../shared/presence.ts";
import { dakarDateTime } from "../../shared/time.ts";
import { ErreurRegime, posteId } from "../../shared/types.ts";
import type { Poste } from "../../shared/types.ts";

export const HEURE_DEBUT = 8;
export const HEURE_FIN = 16;
/** Heure de fin la plus précoce autorisable pour un service qui termine avant 16 h (décision de l'administrateur). */
export const HEURE_FIN_MIN = 10;

export interface ConfigGeneral {
  /** Jours ISO travaillés (1 = lundi ... 7 = dimanche). Par défaut, lundi–vendredi hors jours fériés. */
  joursTravailles: readonly number[];
  /** Jours fériés ("AAAA-MM-JJ") : repos. */
  joursFeries: ReadonlySet<string>;
  /** Fériés exceptionnellement travaillés (exception autorisée par un responsable). */
  exceptionsTravail: ReadonlySet<string>;
  /** Heure de fin du poste (10 à 16, heure de Dakar) pour un service qui termine avant 16 h ; 16 par défaut. */
  heureFin?: number;
}

export const CONFIG_GENERAL_DEFAUT: ConfigGeneral = {
  joursTravailles: [1, 2, 3, 4, 5],
  joursFeries: new Set(),
  exceptionsTravail: new Set(),
};

export function validerConfigGeneral(c: ConfigGeneral): void {
  if (c.heureFin !== undefined && (!Number.isInteger(c.heureFin) || c.heureFin < HEURE_FIN_MIN || c.heureFin > HEURE_FIN)) {
    throw new ErreurRegime("config_invalide", `L'heure de fin doit être un entier entre ${HEURE_FIN_MIN} et ${HEURE_FIN}.`);
  }
  for (const j of c.joursTravailles) {
    if (!Number.isInteger(j) || j < 1 || j > 7) throw new ErreurRegime("config_invalide", `Jour invalide : ${j}`);
  }
  if (new Set(c.joursTravailles).size !== c.joursTravailles.length) throw new ErreurRegime("config_invalide", "Jours en double");
}

export function estJourTravaille(date: CivilDate, c: ConfigGeneral = CONFIG_GENERAL_DEFAUT): boolean {
  const wd = isoWeekday(date);
  if (!c.joursTravailles.includes(wd)) return false;
  const k = cle(date);
  if (c.joursFeries.has(k) && !c.exceptionsTravail.has(k)) return false;
  return true;
}

export function posteDuJour(date: CivilDate, c: ConfigGeneral = CONFIG_GENERAL_DEFAUT): Poste | null {
  validerConfigGeneral(c);
  if (!estJourTravaille(date, c)) return null;
  const debut = dakarDateTime(date.year, date.month, date.day, HEURE_DEBUT);
  const fin = dakarDateTime(date.year, date.month, date.day, c.heureFin ?? HEURE_FIN);
  return { posteId: posteId("general", "service", debut), regime: "general", type: "service", debut, fin };
}

export const evaluerPresenceGeneral = (
  poste: Poste,
  pointages: { arrivee?: Date | null; depart?: Date | null },
  maintenant: Date,
  params: ParamsPresence = PARAMS_PRESENCE_DEFAUT,
) => {
  if (poste.regime !== "general") throw new ErreurRegime("regime_invalide", "Poste hors régime général");
  return evaluerPresence(poste, pointages, maintenant, params);
};
