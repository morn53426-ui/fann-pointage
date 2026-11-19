# Correctifs v32b — QR badges et scan mobile

- Le QR imprimé conserve le même emplacement sur le badge 86 × 54 mm.
- Génération SVG vectorielle noir pur sur blanc pur, avec une zone de silence de quatre modules et un niveau de correction L pour limiter la densité des modules sans changer le jeton de badge.
- Le lecteur utilise la caméra arrière en HD (1280 × 720 en idéal), active l'autofocus continu lorsque l'appareil le permet et optimise les images JSQR jusqu'à 960 px sur le grand côté.
- La détection est relancée toutes les 90 ms avec BarcodeDetector ou 120 ms avec jsQR. Les images inversées ne sont pas recherchées car les badges sont imprimés noir sur blanc.
- Un cadre blanc aide l'utilisateur à centrer le code. Les deux parcours sont concernés : pointage personnel et poste partagé.
- Le cache PWA passe à `fann-pointage-v43` et précache les nouveaux modules `badge-qr.js` et `qr-camera.js`.
- Aucun changement n'est apporté à la valeur, au format ou à la sécurité des identifiants `FANN-BADGE` côté serveur.

Tests : les tests QR/caméra et les tests de badge ciblés sont exécutés. La suite complète dépend de la présence de `pg` dans `node_modules` pour deux tests d'intégration PostgreSQL.
