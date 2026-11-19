// Petits utilitaires communs aux routes de l'API (réponse JSON, lecture prudente d'un corps de requête).
import type { Reponse } from "./routes.ts";

export const json = (statut: number, corps: unknown): Reponse => ({ statut, corps });
export const objet = (x: unknown): Record<string, unknown> => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
