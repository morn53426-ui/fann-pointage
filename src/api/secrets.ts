// Contrôles de cohérence des secrets au démarrage. Retourne des avertissements (jamais les valeurs elles-mêmes).
export function avertissementsSecrets(secretSession: string, secretBadge: string): string[] {
  const avertissements: string[] = [];
  if (secretSession === secretBadge) {
    avertissements.push(
      "SESSION_SECRET et BADGE_SECRET sont identiques. Ce n'est pas exploitable directement (la clé des badges est dérivée avec un libellé distinct), "
      + "mais la rotation de l'un touche l'autre. Avant d'émettre de vrais badges, donnez à BADGE_SECRET une valeur indépendante (npm run setup:env pour une nouvelle installation) ; "
      + "après émission, la changer oblige à réémettre les badges.",
    );
  }
  return avertissements;
}
