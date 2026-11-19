export type NiveauOrigineQr = "production" | "interne" | "test" | "invalide";
export function evaluerOrigineQr(valeur: string): { niveau: NiveauOrigineQr; base: string; raisons: string[] };
