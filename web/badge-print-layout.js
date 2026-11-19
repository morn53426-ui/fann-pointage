/**
 * Placement des dos de badges pour une impression recto-verso A4 portrait,
 * retournée sur le bord long : les deux colonnes de chaque rangée s'inversent.
 * Un badge isolé en fin de rangée doit occuper la colonne droite au verso ;
 * le créneau gauche reste explicitement vide pour ne pas décaler la grille.
 */
export function ordonnerVersoBadges(lot) {
  const ordre = [];
  for (let i = 0; i < lot.length; i += 2) {
    if (i + 1 < lot.length) {
      ordre.push(lot[i + 1], lot[i]);
    } else {
      ordre.push(null, lot[i]);
    }
  }
  return ordre;
}

/**
 * Découpe les badges en feuilles de 8 emplacements (2 colonnes × 4 rangées).
 * 4 rangées = 222 mm de haut : tient dans la zone imprimable réelle des téléphones
 * (Safari/Chrome ajoutent leurs propres marges et en-têtes), contrairement à 5 rangées (278 mm).
 */
export function repartirLotsBadges(badges, taille = 8) {
  if (!Number.isInteger(taille) || taille < 1) {
    throw new RangeError("La taille d'un lot doit être un entier strictement positif.");
  }
  const lots = [];
  for (let i = 0; i < badges.length; i += taille) lots.push(badges.slice(i, i + taille));
  return lots;
}
