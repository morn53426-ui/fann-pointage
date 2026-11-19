export type Regime = "general" | "garde" | "urgences" | "mobil";
export type TypePoste = "service" | "garde" | "jour" | "nuit";

/** Un poste = identifiant + instants exacts (UTC). Jamais rattaché à une "journée civile". */
export interface Poste {
  posteId: string;
  regime: Regime;
  type: TypePoste;
  debut: Date;
  fin: Date;
}

export interface Periode { debut: Date; fin: Date }

export interface Conflit {
  code: "chevauchement" | "repos_insuffisant" | "sequence_invalide" | "reprise_vendredi" | "passage_equipe";
  gravite: "erreur" | "avertissement";
  message: string;
  posteIds: string[];
}

export class ErreurRegime extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ErreurRegime";
    this.code = code;
  }
}

export const posteId = (regime: Regime, type: TypePoste, debut: Date): string =>
  `${regime}:${type}:${debut.toISOString()}`;

export const MS_HEURE = 3_600_000;
export const MS_MINUTE = 60_000;
