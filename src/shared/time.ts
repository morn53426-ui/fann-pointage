// Fuseau officiel : Africa/Dakar. Tous les instants sont stockés en UTC (Date / ISO 8601 "Z").
// Dakar est en UTC+0 toute l'année, mais le code passe par le fuseau IANA pour rester correct
// si les règles changent. L'heure officielle d'un pointage vient TOUJOURS du serveur.

export const TIMEZONE = "Africa/Dakar";

export interface DakarParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  /** ISO : 1 = lundi ... 7 = dimanche */
  isoWeekday: number;
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE, hourCycle: "h23", weekday: "short",
  year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function dakarParts(instant: Date): DakarParts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) p[part.type] = part.value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
    isoWeekday: WEEKDAYS[p.weekday],
  };
}

/** Convertit une date/heure locale de Dakar en instant UTC. */
export function dakarDateTime(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const g = dakarParts(new Date(guess));
  const seen = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute, g.second);
  return new Date(guess - (seen - guess));
}
