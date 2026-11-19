// Sélection explicite du mode, afin que la même image Docker puisse servir soit la démo,
// soit le catalogue PostgreSQL réel. Le mode par défaut est défini dans compose/.env.
const mode = (process.env.FANN_MODE ?? "demo").trim().toLowerCase();
if (mode === "demo") {
  await import("./main.ts");
} else if (mode === "postgres-auth") {
  await import("./main-postgres-auth.ts");
} else if (mode === "postgres-catalogue") {
  await import("./main-postgres-catalogue.ts");
} else {
  throw new Error("FANN_MODE inconnu. Valeurs acceptées : demo, postgres-auth, postgres-catalogue.");
}
