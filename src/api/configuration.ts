/** Configuration du serveur de démonstration. Les valeurs dangereuses ou ambiguës font échouer le démarrage. */
export interface ConfigurationDemo {
  port: number;
  host: string;
  zone?: { latitude: number; longitude: number; rayonM: number };
}

export function lireConfigurationDemo(env: Record<string, string | undefined>): ConfigurationDemo {
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT doit être un entier compris entre 1 et 65535.");
  }

  const host = (env.HOST ?? "127.0.0.1").trim();
  if (!host || /[\s/\\]/.test(host)) throw new Error("HOST doit être un nom d'hôte ou une adresse IP valide.");

  const latitudeDefinie = env.ZONE_LAT !== undefined && env.ZONE_LAT.trim() !== "";
  const longitudeDefinie = env.ZONE_LNG !== undefined && env.ZONE_LNG.trim() !== "";
  if (latitudeDefinie !== longitudeDefinie) {
    throw new Error("ZONE_LAT et ZONE_LNG doivent être renseignées ensemble.");
  }
  // ZONE_RAYON peut être présent dans .env même si le géorepérage est désactivé.
  // Sans coordonnées, le rayon n'a aucun effet : le serveur démarre sans zone GPS.
  if (!latitudeDefinie) return { port, host };

  const latitude = Number(env.ZONE_LAT);
  const longitude = Number(env.ZONE_LNG);
  const rayonM = env.ZONE_RAYON === undefined ? 150 : Number(env.ZONE_RAYON);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("ZONE_LAT doit être une latitude comprise entre -90 et 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("ZONE_LNG doit être une longitude comprise entre -180 et 180.");
  }
  // 100 km reste volontairement très large pour une zone de pointage, sans accepter une géofence mondiale par erreur.
  if (!Number.isFinite(rayonM) || rayonM <= 0 || rayonM > 100_000) {
    throw new Error("ZONE_RAYON doit être supérieur à 0 et inférieur ou égal à 100000 mètres.");
  }
  return { port, host, zone: { latitude, longitude, rayonM } };
}
