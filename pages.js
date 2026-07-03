/* =======================================================================
   Registre central des tuiles du Portail Dune.

   AJOUTER UNE PAGE = AJOUTER UNE ENTRÉE ICI.
   Elle apparaît alors automatiquement :
     • dans le menu (menu.html) ;
     • dans la gestion des accès (account.html, section admin).

   Champs :
     key   : identifiant stable utilisé dans settings.json et page-guard.js
             (ne JAMAIS le renommer une fois en prod, sinon l'état d'accès
              enregistré est perdu).
     href  : lien de la carte (relatif à la racine du site).
     img   : image de la carte (fallback automatique vers intro.jpg).
     title : titre affiché.
     desc  : description affichée.
     icon  : contenu interne du <svg viewBox="0 0 24 24"> (les <path>).
     guard : nom du fichier de la page (avec data-page) — informatif.

   États d'accès possibles (gérés depuis Mon Compte > Gestion des pages) :
     open   : visible et cliquable pour tous (défaut si non défini).
     hidden : « pas active » — n'apparaît pas pour les joueurs.
     wip    : « en travaux » — apparaît grisée et non cliquable pour les joueurs.
   Les administrateurs voient et accèdent à TOUT, en permanence.
======================================================================= */
window.MENU_PAGES = [
  {
    key: "map",
    href: "map.html",
    img: "cartes.jpg",
    title: "Cartographie",
    desc: "Accès aux bases, ressources et stratégie territoriale.",
    icon: '<path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>'
  },
  {
    key: "skills",
    href: "skills.html",
    img: "metiers.jpg",
    title: "Métiers",
    desc: "Simulateur de talents, optimisations et commandes de craft.",
    icon: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.58 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>'
  },
  {
    key: "missions",
    href: "planner.html",
    img: "missions.jpg",
    title: "Missions",
    desc: "Planificateur de soirées Landsraad et gestion des groupes.",
    icon: '<path d="M6.92 5c.96 0 1.63.74 2.18 1.66l-2.4 2.4L4.85 7.21C5.23 5.92 6.09 5 6.92 5zM4.17 11.23l1.87-1.87 5.16 5.16L19.1 6.62c.4-.41.41-1.07 0-1.48l-1.3-1.31c-.41-.42-1.07-.42-1.48 0L9.43 10.72 7.11 8.4c.48-1.55 1.57-2.99 3.19-3.79 1.48-.73 3.69-.64 5.37 1.05l1.31 1.31c1.68 1.68 1.76 3.88 1.04 5.36-.81 1.64-2.26 2.74-3.82 3.22l-2.31-2.31-6.72 6.72c-.39.39-1.02.39-1.41 0l-2.83-2.83c-.39-.39-.39-1.02 0-1.41l3.24-4.49z"/>'
  },
  {
    key: "migration",
    href: "migration.html",
    img: "migration.png",
    title: "Migration",
    desc: "Coordinateur de déplacement de guilde vers Icarus — réservation et validation des sietchs.",
    icon: '<path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/>'
  },
  {
    key: "chroniques",
    href: "dune_chronologie.html",
    img: "menu_histoire.jpg",
    title: "Chroniques",
    desc: "Quinze mille ans d'histoire de l'univers de Dune (A. Odoardi).",
    icon: '<path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zM21 18.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/>'
  },
  {
    key: "analytics",
    href: "dune_analytics.html",
    img: "analytics.jpg",
    title: "Œil du Mentat",
    desc: "Télémétrie des mondes — population, sietches dominants et fluctuations temporelles.",
    icon: '<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>'
  },
  {
    key: "base_planner",
    href: "base_planner.html",
    img: "planner.jpg",
    title: "Constructeur de Base",
    desc: "Planifiez vos bases en 3D avant de bâtir in-game — pièces dataminées, claim multi-étages, partage de plans.",
    icon: '<path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3zm0 2.7l5 4.5V18h-2v-6H9v6H7v-7.8l5-4.5z"/>'
  },
  {
    key: "optimiseur",
    href: "optimiseur.html",
    img: "optimiseur.jpg",
    title: "Optimiseur de Stuff",
    desc: "Composez et comparez vos builds — armes, armures et augments avec DPS, résistances cumulées et recettes.",
    icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
  },
  {
    key: "debrief",
    href: "epice/debrief.html",
    img: "debrief.jpg",
    title: "Activité Guilde",
    desc: "Composition des équipes, débrief joueur, Tactique et synthèse des soirées épice.",
    icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3h2v2h-2V6zm0 4h2v8h-2v-8zm-4-4h2v2H8V6zm0 4h2v8H8v-8zm-1 8H6V6h1v12zm9 0V6h2v12h-2z"/>'
  },
  {
    key: "jeux",
    href: "jeux/hub.html",
    img: "jeux/hub_thumb.jpg",
    title: "Hub Jeux",
    desc: "Mini-jeux de guilde — records, classements et défis entre membres.",
    icon: '<path d="M21.58 16.09l-1.09-7.66A3.996 3.996 0 0016.53 5H7.47a3.996 3.996 0 00-3.96 3.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19c.68 0 1.32-.27 1.8-.75L9 16h6l2.25 2.25c.48.48 1.13.75 1.8.75 1.56 0 2.75-1.37 2.53-2.91zM11 11H9v2H8v-2H6v-1h2V8h1v2h2v1zm4 2c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm2-3c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>'
  }
];
