# Badge — nouveau design et filigrane (16 octobre 2026)

- **Filigrane** : logo officiel du CHNUF en encre verte monochrome (`web/icons/logo-chnuf-filigrane.png`, 720 px, fond transparent), centré derrière le contenu au recto (à droite) et au verso (au centre), opacité ~9 %. C'est une vraie image (pas un fond CSS) : elle s'imprime de façon fiable. Le logo d'entête (`web/icons/logo-chnuf.png`) est passé de 256 à 512 px, fond transparent.
- **Recto** : entête vert profond avec liseré or/rouge, logo dans un médaillon blanc, titre équilibré sur deux lignes, photo encadrée, nom en grand, prénom, **profession en pastille verte**, matricule, pied de page vert « AVEC SENDIMBEUL SARL » / « BADGE PERSONNEL ».
- **Verso** : liste étiquetée (NOM, PRÉNOM, ADRESSE, TÉL., MATR.) séparée par de fins filets, QR dans une tuile arrondie à droite, pied de page avec liseré tricolore.
- **Correctif d'impression** : la bannière « MODE DÉMONSTRATION » s'imprimait en haut de la feuille et décalait les badges sur une page blanche supplémentaire (3 pages au lieu de 2). Elle est maintenant masquée à l'impression ; un test vérifie qu'un lot sort en exactement 2 pages (recto puis verso).
- Le cache hors ligne passe en `v13` (le nouveau fichier de filigrane y est inclus).
- Remplacer le logo : écraser `web/icons/logo-chnuf.png` ; régénérer le filigrane à partir du même logo (encre = opposé de la luminance, couleur #0b5d2a).
