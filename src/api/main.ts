// Serveur de DÉMONSTRATION (données fictives, en mémoire). Lancement : npm run demo
// Variables : TRUST_PROXY (1 derrière un reverse proxy de confiance), HOST (127.0.0.1 par défaut), PORT, ZONE_LAT, ZONE_LNG, ZONE_RAYON, DEMO_MOT_DE_PASSE.
import { fileURLToPath } from "node:url";
import { LimiteurTentatives } from "./auth.ts";
import { lireConfigurationDemo } from "./configuration.ts";
import { creerDemo } from "./demo.ts";
import { creerServeur } from "./serveur.ts";

const mode = (process.env.FANN_MODE ?? "demo").trim().toLowerCase();
if (mode !== "demo") {
  console.error("Démarrage refusé : ce ZIP est une version de démonstration. Le mode de production reste indisponible tant que l'API n'utilise pas un dépôt PostgreSQL transactionnel et une authentification de production testés.");
  process.exit(1);
}
const configuration = lireConfigurationDemo(process.env);
const { port, host, zone } = configuration;
const { magasin, identifiants } = creerDemo(new Date(), { zone, motDePasse: process.env.DEMO_MOT_DE_PASSE?.trim() || undefined, donneesClassementDemo: true });
if (process.env.DATA_DIR?.trim()) {
  await magasin.activerPersistanceLocale(`${process.env.DATA_DIR.trim().replace(/[\\/]+$/, "")}/pointages-demo.json`);
  console.log("Persistance locale des pointages de démonstration activée (fichier hors du conteneur éphémère). Ce mécanisme ne remplace pas PostgreSQL en production.");
}
const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => { magasin.horloge = new Date(); return magasin.horloge; } };
const web = fileURLToPath(new URL("../../web", import.meta.url));

creerServeur(ctx, web, { trustProxy: process.env.TRUST_PROXY === "1" }).listen(port, host, () => {
  console.log(`FANN POINTAGE (démo, données fictives) : écoute sur ${host}:${port}`);
  console.log("Comptes de démonstration (mot de passe défini dans .env ; ne pas diffuser) :");
  console.log("Historique du mois précédent : pointages entièrement fictifs pour tester le classement mensuel par points.");
  for (const i of identifiants) console.log(`  ${i.identifiant.padEnd(12)} ${i.role}`);
  console.log("  Le mot de passe n’est volontairement pas affiché dans les journaux.");
  console.log(zone ? "Zone de pointage centrée sur les coordonnées fournies." : "Zone fictive par défaut : le pointage depuis un vrai téléphone sera refusé (hors zone) sauf si ZONE_LAT/ZONE_LNG sont définis.");
});
