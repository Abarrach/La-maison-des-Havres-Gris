<?php
// ============================================================
//  ENDPOINT INTERACTIONS DISCORD — bot "Sorties" épice
//
//  URL à déclarer chez Discord (portail dev → General Information →
//  "Interactions Endpoint URL") :  https://.../epice/discord_sortie.php
//
//  Gère, en pur PHP (aucun démon) :
//   - PING (type 1)            → PONG : poignée de main de validation Discord
//   - SLASH /sortie creer (2)  → ouvre un FORMULAIRE (modal)
//   - SOUMISSION du modal (5)  → crée la sortie dans debriefs.json + poste
//                                l'encart avec l'inscription par poste
//   - SELECT / BOUTON (3)      → inscrit / désinscrit + rafraîchit le roster
//
//  Sécurité : chaque requête Discord est signée (Ed25519). On la VÉRIFIE
//  avant tout traitement (sinon 401). Clé publique dans la config.
// ============================================================

// ---- Config -------------------------------------------------
$CFG_PATH = __DIR__ . '/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { http_response_code(500); echo 'config absente'; exit; }
$CFG = require $CFG_PATH;

// ---- Journal d'erreurs (silencieux côté Discord) ------------
// Écrit dans epice/data/ (protégé de l'accès direct par nginx, et confirmé accessible en
// écriture pour www-data — contrairement à epice/ lui-même dont les droits sont incertains).
function dlog($msg) {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    @file_put_contents($dir . '/discord_sortie.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
}

// Filet de sécurité pour les erreurs FATALES non rattrapables par try/catch
// (ex: appel de fonction inexistante, épuisement mémoire). Sans ça, Discord
// affiche juste "Une erreur s'est produite. Réessaie." sans aucune trace côté serveur.
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        dlog('FATAL (shutdown) : ' . $err['message'] . ' @ ' . $err['file'] . ':' . $err['line']);
    }
});

// ---- Postes proposés à l'inscription ------------------------
//  Un jeu de postes PAR FAMILLE d'activité (cf. SORTIE_TYPES['postes']) :
//  les postes d'une récolte d'épice n'ont rien à voir avec ceux d'un
//  entraînement PvP. Les ids sont préfixés par famille pour rester distincts
//  entre jeux (un même id ne doit jamais désigner deux rôles différents,
//  sinon les inscriptions historiques changeraient de sens).
//
//  ÉPICE — mappé sur la structure d'assignation de l'outil Activité Guilde
//  (recolte / defense / distance).
//  'defenseur_cac' : rôle retiré (plus rentable de mettre un CAC dans le
//  transporteur) — gardé ici pour continuer à afficher/grouper correctement
//  les inscriptions déjà enregistrées, mais retiré du menu d'inscription
//  (cf POSTES_EPICE_SELECTABLE, seul utilisé pour construire le select Discord).
//  'orni_assaut' : Orni d'assaut de défense du transporteur — jamais
//  proposé sur Discord (distribué uniquement côté admin). Présent dans la
//  liste complète pour afficher les inscrits déjà placés dans ce rôle côté site.
const POSTES_EPICE = [
    'moissonneur'  => 'Moissonneur',
    'transporteur' => 'Transporteur',
    'defenseur_cac'=> 'Défenseur CaC',
    'orni_assaut'  => 'Orni Assaut Défense Transporteur',
    'orni_scout'   => 'Orni Scout (repérage)',
    'pilote_orni'  => 'Pilote Ornithoptère',
    'pilote_orni_cac' => 'Pilote Ornithoptère + CaC',
    'present'      => 'Présent (poste à définir)',
];
// Sélectionnables côté Discord (menu d'inscription). L'Orni Assaut est
// volontairement absent : c'est un rôle de confiance distribué à la main par
// l'organisateur dans le builder admin, jamais choisi librement à l'inscription.
const POSTES_EPICE_SELECTABLE = [
    'moissonneur'  => 'Moissonneur',
    'transporteur' => 'Transporteur',
    'orni_scout'   => 'Orni Scout (repérage)',
    'pilote_orni'  => 'Pilote Ornithoptère',
    'pilote_orni_cac' => 'Pilote Ornithoptère + CaC',
    'present'      => 'Présent (poste à définir)',
];

//  PVP — entraînement air/sol : rôles de combat, tous librement choisis
//  (aucun rôle de confiance ici, contrairement à l'épice) → la liste complète
//  sert aussi de liste sélectionnable.
const POSTES_PVP = [
    'pvp_tank_cac'      => 'Tank CaC',
    'pvp_dps_moyenne'   => 'DPS moyenne portée',
    'pvp_polyvalent'    => 'Polyvalent CaC/DPS',
    'pvp_support_dist'  => 'Support DISTANCE',
    'pvp_orni_assaut'   => 'Orni Assaut',
    'pvp_orni_scout'    => 'Orni Éclaireur',
    // « Présent » tout court, contrairement à l'épice : ici les rôles sont annoncés
    // optionnels, donc venir sans rôle n'est pas un poste restant à attribuer.
    'present'           => 'Présent',
];

const POSTE_ICON = [
    'moissonneur'  => '⛏️',
    'transporteur' => '🚚',
    'defenseur_cac'=> '⚔️',
    'orni_assaut'  => '🛡️',
    'orni_scout'   => '👁️',
    'pilote_orni'  => '🦅',
    'pilote_orni_cac' => '⚔️',
    'present'      => '✅',
    'pvp_tank_cac'     => '🛡️',
    'pvp_dps_moyenne'  => '⚔️',
    'pvp_polyvalent'   => '🛠️',
    'pvp_support_dist' => '🪄',
    'pvp_orni_assaut'  => '🦅',
    'pvp_orni_scout'   => '👁️',
];

// Jeu de postes d'un type de sortie (liste complète = affichage de l'encart,
// liste sélectionnable = options du menu d'inscription Discord).
function postes_all($stype): array {
    return (sortie_type($stype)['postes'] === 'pvp') ? POSTES_PVP : POSTES_EPICE;
}
function postes_selectable($stype): array {
    return (sortie_type($stype)['postes'] === 'pvp') ? POSTES_PVP : POSTES_EPICE_SELECTABLE;
}

// ---- Familles d'activité (niveau 1) --------------------------
//  Regroupement d'AFFICHAGE uniquement : aucune incidence sur le stockage, les
//  inscriptions ou le site. L'ordre de déclaration est l'ordre des boutons.
//  ⚠ 5 boutons par ligne, 5 lignes par message : au-delà de 5 familles,
//  build_cat_picker() ouvre une seconde ligne.
const SORTIE_CATEGORIES = [
    'ludique' => ['label' => 'Ludique', 'icon' => '🎲', 'desc' => 'Courses, défis, énigmes, concours'],
    'pvp'     => ['label' => 'PvP',     'icon' => '⚔️', 'desc' => 'Entraînements, chasses, embuscades'],
    'farm'    => ['label' => 'Farm',    'icon' => '🔁', 'desc' => 'Épice, donjons, ressources, collection'],
    'guilde'  => ['label' => 'Guilde',  'icon' => '🏛️', 'desc' => 'Construction, Landsraad, progression'],
    // Le fourre-tout est une famille de PLEIN DROIT, et non une sous-catégorie enfouie :
    // c'est l'échappatoire quand rien ne colle, elle doit se voir dès le premier écran.
    'autre'   => ['label' => 'Autre',   'icon' => '🛡️', 'desc' => 'Ce qui n\'entre dans aucune autre famille'],
];

// ---- Sous-catégories (niveau 2) ------------------------------
//  'cat' rattache la sous-catégorie à sa famille. Même remarque sur les boutons :
//  5 par ligne — aucune famille n'en compte plus de 5 aujourd'hui.
//  L'ancienne famille « Divers » est devenue « Guilde » : elle décrit ce qu'elle
//  contient au lieu de nommer le reste.
const SORTIE_SOUS_CATEGORIES = [
    // Ludique
    'l_course'   => ['cat' => 'ludique', 'label' => 'Courses & pilotage',    'icon' => '🏁', 'desc' => 'Vitesse, véhicules, destruction'],
    'l_adresse'  => ['cat' => 'ludique', 'label' => 'Adresse & précision',   'icon' => '🎯', 'desc' => 'Viser, larguer, grimper'],
    'l_cache'    => ['cat' => 'ludique', 'label' => 'Cache-cache',           'icon' => '🕵️', 'desc' => 'Se planquer, traquer, survivre'],
    'l_enigme'   => ['cat' => 'ludique', 'label' => 'Énigmes & culture',     'icon' => '🧠', 'desc' => 'Réfléchir, chercher, deviner'],
    'l_concours' => ['cat' => 'ludique', 'label' => 'Concours chronométrés', 'icon' => '⏱️', 'desc' => 'Le plus rapide gagne'],
    // PvP
    'p_train'    => ['cat' => 'pvp',    'label' => 'Entraînement',        'icon' => '🥋', 'desc' => 'S\'exercer entre nous'],
    'p_chasse'   => ['cat' => 'pvp',    'label' => 'Chasse & embuscade',  'icon' => '🎯', 'desc' => 'Traquer, piéger, piller'],
    // Farm
    'f_epice'    => ['cat' => 'farm',   'label' => 'Épice',            'icon' => '🏜️', 'desc' => 'La récolte, et rien d\'autre'],
    'f_donjon'   => ['cat' => 'farm',   'label' => 'Donjons & labos',  'icon' => '🧪', 'desc' => 'Explorer, apprendre'],
    'f_ressource'=> ['cat' => 'farm',   'label' => 'Ressources',       'icon' => '⛏️', 'desc' => 'Matériaux, scories, épaves'],
    'f_collection'=>['cat' => 'farm',   'label' => 'Collection',       'icon' => '💎', 'desc' => 'Objets rares et routes de farm'],
    // Guilde
    'g_build'    => ['cat' => 'guilde', 'label' => 'Construction',  'icon' => '🏗️', 'desc' => 'Chantiers et savoir-faire'],
    'g_landsraad'=> ['cat' => 'guilde', 'label' => 'Landsraad',     'icon' => '🏛️', 'desc' => 'Objectifs de la semaine'],
    'g_progress' => ['cat' => 'guilde', 'label' => 'Progression',   'icon' => '⭐', 'desc' => 'Avancer ensemble'],
    // Autre
    'a_autre'    => ['cat' => 'autre',  'label' => 'Autre',         'icon' => '🛡️', 'desc' => 'Le fourre-tout assumé'],
];

// ---- Activités (niveau 3) ------------------------------------
//  'site'   => true  : intégré à l'Activité Guilde (soirée active, assignation, historique).
//            => false : vit uniquement côté Discord (jauge d'intérêt), stockage séparé.
//  'postes' => 'epice'/'pvp' : inscription par poste (menu déroulant), avec le
//            jeu de postes de cette famille (cf. postes_all / postes_selectable).
//            => false : RSVP Présent/Peut-être/Absent.
//  'sub'    => clé de SORTIE_SOUS_CATEGORIES. La famille s'en déduit (sortie_cat).
//  'desc'   => sous-titre affiché sous le libellé (100 caractères max).
//
//  ⚠ La clé (ex: 'epice') est STOCKÉE dans chaque sortie et relue par le site
//  (account.html) : ne JAMAIS la renommer, seulement ajouter. Les 9 premières
//  existaient avant le classement à trois niveaux et gardent leur identifiant.
const SORTIE_TYPES = [

    // --- Ludique › Courses & pilotage
    'course_dd'  => ['label' => 'Course à mort Deep Desert', 'icon' => '🏁', 'site' => false, 'postes' => false,
                     'sub' => 'l_course', 'desc' => 'Le plus loin gagne, et tout le monde meurt'],
    'death_run'  => ['label' => 'Death Run', 'icon' => '💀', 'site' => false, 'postes' => false,
                     'sub' => 'l_course', 'desc' => 'Véhicules armés, roquettes, soutien aérien'],
    'need_speed' => ['label' => 'Need for Speed', 'icon' => '🏎️', 'site' => false, 'postes' => false,
                     'sub' => 'l_course', 'desc' => 'Circuits et portes de passage, tout véhicule'],
    'derby'      => ['label' => 'Destruction Derby', 'icon' => '💥', 'site' => false, 'postes' => false,
                     'sub' => 'l_course', 'desc' => 'Buggys à roquettes sur îlot PvP, il n\'en restera qu\'un'],
    'long_jump'  => ['label' => 'Long Jump', 'icon' => '🛫', 'site' => false, 'postes' => false,
                     'sub' => 'l_course', 'desc' => 'Un tremplin, un véhicule, la distance'],

    // --- Ludique › Adresse & précision
    'drop_cont'  => ['label' => 'Drop the Conteneur', 'icon' => '📦', 'site' => false, 'postes' => false,
                     'sub' => 'l_adresse', 'desc' => 'Largage sur cible, entre pétanque et curling aérien'],
    'drop_trans' => ['label' => 'Drop the Transporteur', 'icon' => '🦅', 'site' => false, 'postes' => false,
                     'sub' => 'l_adresse', 'desc' => 'Faire tomber les conteneurs d\'une structure'],
    'grimpe'     => ['label' => 'Défi de grimpe', 'icon' => '🧗', 'site' => false, 'postes' => false,
                     'sub' => 'l_adresse', 'desc' => 'En distille, sans ceinture ni grappin'],

    // --- Ludique › Cache-cache
    'hide_seek'  => ['label' => 'Hide and Seek', 'icon' => '🙈', 'site' => false, 'postes' => false,
                     'sub' => 'l_cache', 'desc' => 'Dans Hagga, avec exclusion possible de certains lieux'],
    'chat_arme'  => ['label' => 'Chat-Pistolet / Chat-GRDA', 'icon' => '🐈', 'site' => false, 'postes' => false,
                     'sub' => 'l_cache', 'desc' => 'Épave du DD rang A, un chat armé, des souris à poil'],
    'chasse_homme'=>['label' => 'Chasse à l\'homme', 'icon' => '🩸', 'site' => false, 'postes' => false,
                     'sub' => 'l_cache', 'desc' => 'Mini-scénario RP, traque dans le Deep Desert'],

    // --- Ludique › Énigmes & culture
    'quizz'      => ['label' => 'Quizz', 'icon' => '❓', 'site' => false, 'postes' => false,
                     'sub' => 'l_enigme', 'desc' => 'Dune Awakening, univers de Dune, ou tout autre univers'],
    'geoguessr'  => ['label' => 'GeoGuessr', 'icon' => '🗺️', 'site' => false, 'postes' => false,
                     'sub' => 'l_enigme', 'desc' => 'Retrouver la localisation d\'une capture d\'écran'],
    'labyrinthe' => ['label' => 'Escape the Labyrinth', 'icon' => '🌀', 'site' => false, 'postes' => false,
                     'sub' => 'l_enigme', 'desc' => 'Labyrinthe construit. Variante Escape Room avec énigmes'],
    'tresors'    => ['label' => 'Chasse aux trésors', 'icon' => '🧭', 'site' => false, 'postes' => false,
                     'sub' => 'l_enigme', 'desc' => 'Dans Hagga'],
    'havrien'    => ['label' => 'Énigme du Havrien', 'icon' => '🎁', 'site' => false, 'postes' => false,
                     'sub' => 'l_enigme', 'desc' => 'Retrouver un membre caché et le lot qu\'il porte'],

    // --- Ludique › Concours chronométrés
    'speed_farm' => ['label' => 'Hippo-Gloutons', 'icon' => '🦛', 'site' => false, 'postes' => false,
                     'sub' => 'l_concours', 'desc' => 'Speed farm, groupes équilibrés au niveau de Récolteur'],
    'speed_build'=> ['label' => 'Base Builders', 'icon' => '🧱', 'site' => false, 'postes' => false,
                     'sub' => 'l_concours', 'desc' => 'Speed build sur thème imposé, en temps limité'],
    'speed_donj' => ['label' => 'Donjon Crushers', 'icon' => '⚡', 'site' => false, 'postes' => false,
                     'sub' => 'l_concours', 'desc' => 'Speed farm des donjons de la map monde'],

    // --- PvP › Entraînement
    'pvp_train'  => ['label' => 'Entraînement PvP air/sol', 'icon' => '⚔️', 'site' => false, 'postes' => 'pvp',
                     'sub' => 'p_train', 'desc' => 'Inscription par rôle de combat'],

    // --- PvP › Chasse & embuscade
    'pvp_hunt'   => ['label' => 'Chasse PvP', 'icon' => '🎯', 'site' => false, 'postes' => false,
                     'sub' => 'p_chasse', 'desc' => 'Traque et pillage dans le Deep Desert'],
    'embuscade'  => ['label' => 'Embuscade', 'icon' => '🪤', 'site' => false, 'postes' => false,
                     'sub' => 'p_chasse', 'desc' => 'Vieux transporteur ou moisso laissés en appât'],

    // --- Farm › Épice
    'epice'      => ['label' => 'Épice', 'icon' => '🏜️', 'site' => true, 'postes' => 'epice',
                     'sub' => 'f_epice', 'desc' => 'Récolte — liée au site (assignation, débrief)'],

    // --- Farm › Donjons & labos
    'labo'       => ['label' => 'Labos-Donjons', 'icon' => '🧪', 'site' => false, 'postes' => false,
                     'sub' => 'f_donjon', 'desc' => 'Exploration de labos et de donjons'],
    'labo_decouv'=> ['label' => 'Donjons découverte', 'icon' => '🔰', 'site' => false, 'postes' => false,
                     'sub' => 'f_donjon', 'desc' => 'Pour les nouveaux, et les anciens qui ont loupé le coche'],

    // --- Farm › Ressources
    'farm'       => ['label' => 'Farm divers', 'icon' => '🔁', 'site' => false, 'postes' => false,
                     'sub' => 'f_ressource', 'desc' => 'Matériaux, composants, plans violets'],
    'farm_hagga' => ['label' => 'Farm Hagga', 'icon' => '🏘️', 'site' => false, 'postes' => false,
                     'sub' => 'f_ressource', 'desc' => 'Sentinelleville, Mysa Tarril, O\'odham'],
    'farm_scorie'=> ['label' => 'Farm scories', 'icon' => '🪨', 'site' => false, 'postes' => false,
                     'sub' => 'f_ressource', 'desc' => 'Sorties dédiées'],

    // --- Farm › Collection
    'collection' => ['label' => 'Attrapez-les tous', 'icon' => '💜', 'site' => false, 'postes' => false,
                     'sub' => 'f_collection', 'desc' => 'Objets épiques violets, routes T1 à T5'],

    // --- Guilde › Construction
    'base_dd'    => ['label' => 'Construction Base Guilde DD', 'icon' => '🏗️', 'site' => false, 'postes' => false,
                     'sub' => 'g_build', 'desc' => 'Chantier collectif de la base de guilde'],
    'atelier_build'=>['label' => 'Atelier construction', 'icon' => '📐', 'site' => false, 'postes' => false,
                     'sub' => 'g_build', 'desc' => 'Par où commencer, les sets, les règles, avec de la pratique'],

    // --- Guilde › Landsraad
    'landsraad'  => ['label' => 'Landsraad', 'icon' => '🏛️', 'site' => false, 'postes' => false,
                     'sub' => 'g_landsraad', 'desc' => 'Objectifs et force de vote de la semaine'],

    // --- Guilde › Progression
    'hauts_faits'=> ['label' => 'Soirée Hauts Faits', 'icon' => '⭐', 'site' => false, 'postes' => false,
                     'sub' => 'g_progress', 'desc' => 'Les compléter en groupe'],

    // --- Autre
    'guilde'     => ['label' => 'Activité Guilde', 'icon' => '🛡️', 'site' => false, 'postes' => false,
                     'sub' => 'a_autre', 'desc' => 'Tout ce qui n\'entre pas dans les autres cases'],
];
function sortie_type($stype): array { return SORTIE_TYPES[$stype] ?? SORTIE_TYPES['epice']; }

// ---- Constantes du FORMULAIRE -------------------------------
//  ⚠ Déclarées ICI, et pas à côté de sortie_modal() qui les consomme, parce que
//  PHP ne hisse QUE les fonctions : un `const` de premier niveau s'exécute quand
//  le flux l'atteint. Placées après le bloc de routage (qui se termine par exit),
//  elles n'existaient jamais au moment de construire le formulaire — PHP 8 lève
//  « Undefined constant », que le catch(Throwable) affiche en « Erreur interne ».
//  C'est arrivé : le sélecteur fonctionnait, le bouton « Choisir » échouait.

// Durées proposées. Les VALEURS gardent le format historique ('2', '1h30') :
// duree_to_hours() du script de purge et fmt_duree() les lisent déjà toutes.
// ⚠ Un radio group accepte 2 à 10 options — on en a 6.
const DUREE_OPTIONS = [
    '1'    => '1 h',
    '1h30' => '1 h 30',
    '2'    => '2 h',
    '2h30' => '2 h 30',
    '3'    => '3 h',
    '4'    => 'Soirée entière (4 h)',
];

// Activité dont la bannière sert d'illustration par défaut aux autres.
// « Activité Guilde » (id historique 'guilde') est le fourre-tout du catalogue :
// son image convient à n'importe quelle sortie, ce qui en fait le meilleur repli.
const BANNIERE_DEFAUT_TYPE = 'guilde';

// Repli de DERNIER recours, connu du code et non de la config : sans lui, « la
// bannière d'Activité Guilde » n'existait que si on l'avait déclarée dans `banners`,
// et une config vierge ne donnait aucune image. Chemin relatif au site, résolu avec
// `site_url` (comme dune_site_base_url() dans discord_helper.php, non inclus ici).
const BANNIERE_DEFAUT_FICHIER = '/epice/img/sortieactdivers.jpg';

const JOURS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS_FR  = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
                  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Sous-catégorie d'une activité, puis famille déduite de la sous-catégorie.
// Repli sur la première déclarée si la clé est absente ou inconnue : une activité
// mal rangée reste atteignable dans le sélecteur au lieu d'en disparaître.
//
// ⚠ array_key_exists et non isset() : PHP refuse isset() sur le résultat d'une
// expression, et une constante tableau en est une (« Cannot use isset() on the
// result of an expression ») — erreur FATALE, pas un avertissement.
// ⚠ array_keys()[0] plutôt que array_key_first() : cette dernière demande PHP 7.3
// et la version du serveur n'est pas vérifiable d'ici.
function sortie_sub($stype): string {
    $s = SORTIE_TYPES[$stype]['sub'] ?? '';
    return array_key_exists($s, SORTIE_SOUS_CATEGORIES) ? $s : array_keys(SORTIE_SOUS_CATEGORIES)[0];
}
function sortie_cat($stype): string {
    $c = SORTIE_SOUS_CATEGORIES[sortie_sub($stype)]['cat'] ?? '';
    return array_key_exists($c, SORTIE_CATEGORIES) ? $c : array_keys(SORTIE_CATEGORIES)[0];
}
// ---- Compat texte -------------------------------------------
// Ce serveur n'a PAS mbstring (piège connu, cf. discord_plan.php et epice/data-api.php).
//
// Coupe à $n CARACTÈRES sans mbstring : substr() couperait au milieu d'un caractère
// accentué ou d'un emoji et produirait du JSON invalide, que Discord rejette en bloc.
function sn_cut($s, $n) {
    $s = (string)$s;
    return preg_match('/^.{0,' . (int)$n . '}/us', $s, $m) ? $m[0] : $s;
}

// ============================================================
//  1) VÉRIFICATION DE LA SIGNATURE
//     — sautée si on est appelé via le dispatcher racine
//       (discord_interactions.php a déjà vérifié une fois).
//     — appliquée normalement si ce fichier est atteint en direct
//       (rétrocompat : ancienne URL Discord toujours fonctionnelle
//       tant qu'elle n'a pas été repointée).
// ============================================================
$raw = file_get_contents('php://input');

if (!defined('DUNE_INTERACTIONS_DISPATCHED')) {
    $signature = $_SERVER['HTTP_X_SIGNATURE_ED25519']   ?? '';
    $timestamp = $_SERVER['HTTP_X_SIGNATURE_TIMESTAMP'] ?? '';

    // Trace inconditionnelle de toute requête reçue — sert à savoir si on arrive bien jusqu'ici
    // (utile pour diagnostiquer un échec qui ne produit aucune autre entrée de log).
    dlog('requête reçue : méthode=' . ($_SERVER['REQUEST_METHOD'] ?? '?') . ' longueur_body=' . strlen($raw) . ' sig=' . ($signature !== '' ? 'présente' : 'absente'));

    if (!function_exists('sodium_crypto_sign_verify_detached')) {
        dlog('FATAL: extension sodium absente — signature non vérifiable');
        http_response_code(500); echo 'sodium manquant'; exit;
    }
    if ($signature === '' || $timestamp === '') {
        dlog('signature manquante (en-têtes X-Signature-Ed25519 / X-Signature-Timestamp absents)');
        http_response_code(401); echo 'signature manquante'; exit;
    }

    $ok = false;
    try {
        $ok = sodium_crypto_sign_verify_detached(
            sodium_hex2bin($signature),
            $timestamp . $raw,
            sodium_hex2bin($CFG['public_key'])
        );
    } catch (Throwable $e) {
        dlog('Erreur vérif signature: ' . $e->getMessage());
    }
    if (!$ok) {
        dlog('signature invalide (public_key configurée ? longueur=' . strlen((string)($CFG['public_key'] ?? '')) . ')');
        http_response_code(401); echo 'signature invalide'; exit;
    }
}
// ============================================================
//  2) ROUTAGE DE L'INTERACTION
// ============================================================
header('Content-Type: application/json; charset=utf-8');
$body = json_decode($raw, true) ?? [];
$type = $body['type'] ?? 0;
dlog('signature valide, type=' . $type . ($type === 5 ? ' custom_id=' . ($body['data']['custom_id'] ?? '?') : ''));

// -- PING : poignée de main de Discord ------------------------
if ($type === 1) { echo json_encode(['type' => 1]); exit; }

// À partir d'ici, toute exception/erreur Throwable (TypeError, etc.) est rattrapée pour
// logger le détail dans discord_sortie.log au lieu de laisser Discord afficher un message
// générique sans aucune trace exploitable côté serveur.
try {

// -- SLASH COMMAND --------------------------------------------
if ($type === 2) {
    $name = $body['data']['name'] ?? '';
    $sub  = $body['data']['options'][0]['name'] ?? '';
    if ($name === 'sortie' && $sub === 'creer') {
        // La commande n'a plus d'option : le sélecteur fait tout le travail.
        // On lit quand même un éventuel « type » par TOLÉRANCE — une mise à jour de
        // définition de commande met du temps à se propager, un client peut donc
        // encore envoyer l'ancienne option pendant la transition. Valeur connue →
        // formulaire direct ; tout le reste (vide, catégorie, texte libre) → sélecteur.
        $stype = '';
        foreach ($body['data']['options'][0]['options'] ?? [] as $o) {
            if (($o['name'] ?? '') === 'type') $stype = trim((string)($o['value'] ?? ''));
        }
        if (array_key_exists($stype, SORTIE_TYPES)) respond_modal($stype);
        respond_type_picker();
    }
    if ($name === 'sortie' && $sub === 'panneau') {
        handle_panneau($body);
    }
    respond_message("Commande inconnue.", true);
}

// -- SOUMISSION DU MODAL --------------------------------------
if ($type === 5) {
    $cid = $body['data']['custom_id'] ?? '';
    if (strpos($cid, 'sortie_edit_modal:') === 0) {
        handle_edit_save($body, substr($cid, strlen('sortie_edit_modal:')));
    }
    if (strpos($cid, 'sortie_create_modal') === 0) {
        // Le type est encodé dans le custom_id : "sortie_create_modal:<type>".
        $stype = (strpos($cid, ':') !== false) ? substr($cid, strpos($cid, ':') + 1) : 'epice';
        if (!array_key_exists($stype, SORTIE_TYPES)) $stype = 'epice';
        handle_create($body, $stype);
    }
    respond_message("Formulaire inconnu.", true);
}

// -- COMPOSANT (select d'inscription / boutons présent / peut-être / absent / désinscription) -
if ($type === 3) {
    $cid = $body['data']['custom_id'] ?? '';
    // Sélecteur de création : famille → sous-catégorie → activité → formulaire.
    // ⚠ 'newbackcat:' AVANT 'newback' : le second est un préfixe du premier, et
    // l'ordre inverse enverrait tous les retours d'écran 3 vers l'écran 1.
    if (strpos($cid, 'newcat:') === 0)     { handle_new_cat($body, substr($cid, 7)); }
    if (strpos($cid, 'newsub:') === 0)     { handle_new_sub(substr($cid, 7)); }
    if (strpos($cid, 'newpick:') === 0)    { handle_new_pick(substr($cid, 8)); }
    if (strpos($cid, 'newtype') === 0)     { handle_new_type($body); }
    if (strpos($cid, 'newbackcat:') === 0) { handle_new_back_cat(substr($cid, 11)); }
    if (strpos($cid, 'newback') === 0)     { handle_new_back(); }
    if (strpos($cid, 'signup:') === 0)   { handle_signup($body, substr($cid, 7)); }
    if (strpos($cid, 'present:') === 0)  { handle_status($body, substr($cid, 8), 'present'); }
    if (strpos($cid, 'maybe:') === 0)    { handle_status($body, substr($cid, 6), 'maybe'); }
    if (strpos($cid, 'absent:') === 0)   { handle_status($body, substr($cid, 7), 'absent'); }
    if (strpos($cid, 'unsignup:') === 0) { handle_unsignup($body, substr($cid, 9)); }
    if (strpos($cid, 'chef:') === 0)     { handle_toggle_chef($body, substr($cid, 5)); }
    if (strpos($cid, 'edit:') === 0)     { handle_edit_open($body, substr($cid, 5)); }
    if (strpos($cid, 'delok:') === 0)    { handle_delete_confirm($body, substr($cid, 6)); }
    if (strpos($cid, 'del:') === 0)      { handle_delete($body, substr($cid, 4)); }
    respond_message("Action inconnue.", true);
}

http_response_code(400); echo 'type non géré'; exit;

} catch (Throwable $e) {
    dlog('FATAL (exception) : ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString());
    respond_message("Erreur interne. Réessaie, et préviens un admin si ça persiste.", true);
}


// ============================================================
//  HANDLERS
// ============================================================

// ---- Formulaire : listes proposées ---------------------------
//  Le jour, l'heure et la durée sont CHOISIS, plus saisis. Motif : le champ libre
//  « 25-06-2026 21:00 » laissait passer une date sans heure, et une sortie sans
//  heure exploitable n'est JAMAIS purgée par discord_sortie_cleanup.php (elle est
//  ignorée pour toujours). Une liste supprime la classe d'erreur entière.
//
//  ⚠ Le formulaire n'a plus de champ ZONE : un modal accepte 5 composants de
//  premier niveau MAXIMUM, et jour + heure séparés en consomment un de plus que
//  l'ancien champ combiné. La zone reste dans les données (les sorties existantes
//  la portent, le site l'affiche) — voir la garde dans handle_edit_save.

// (Les constantes du formulaire — DUREE_OPTIONS, JOURS_FR, MOIS_FR — sont déclarées
//  en HAUT du fichier, avec SORTIE_TYPES : voir l'avertissement qui les accompagne.)

// « mar. 12 août ». On n'utilise NI strftime (supprimé en PHP 8.1) NI IntlDateFormatter
// (extension intl non garantie sur ce serveur, comme mbstring).
function date_fr_court(DateTime $d): string {
    return JOURS_FR[(int)$d->format('w')] . ' ' . (int)$d->format('j') . ' ' . MOIS_FR[(int)$d->format('n')];
}

// Les 21 prochains jours (plafond Discord : 25 options par liste).
// Fuseau Europe/Paris, le même que discord_sortie_cleanup.php : sinon « Aujourd'hui »
// désigne le mauvais jour dès que le serveur tourne en UTC après minuit.
function jour_options(string $courant = ''): array {
    $tz  = new DateTimeZone('Europe/Paris');
    $out = [];
    for ($i = 0; $i < 21; $i++) {
        $d   = new DateTime('now', $tz);
        $d->modify("+{$i} day");
        $lib = date_fr_court($d);
        if ($i === 0)      $lib = "Aujourd'hui — " . $lib;
        elseif ($i === 1)  $lib = "Demain — " . $lib;
        $out[$d->format('Y-m-d')] = $lib;
    }
    // Une sortie en cours de modification peut porter une date hors fenêtre (passée,
    // ou au-delà de 3 semaines). Sans cet ajout en tête, la liste ne contiendrait pas
    // sa valeur actuelle et la simple ouverture du formulaire la déplacerait.
    if ($courant !== '' && !isset($out[$courant])) {
        $out = [$courant => fmt_date_fr($courant) . ' (date actuelle)'] + $out;
    }
    return $out;
}

// Heures proposées : les 24 heures pleines, de 00:00 à 23:00.
//
// ⚠ Pas de demi-heures : une journée entière par pas de 30 min ferait 48 entrées, or
// une liste Discord en accepte 25 au MAXIMUM. Couvrir la journée complète et garder
// les :30 est donc impossible dans un seul menu — c'est la journée complète qui a été
// choisie. Une sortie à 21:30 n'est plus saisissable à la création.
// Une heure héritée hors liste (ancienne sortie à 21:30) est ajoutée en tête, sinon
// la simple ouverture du formulaire de modification la déplacerait.
function heure_options(string $courante = ''): array {
    $out = [];
    for ($h = 0; $h < 24; $h++) { $k = sprintf('%02d:00', $h); $out[$k] = $k; }
    if ($courante !== '' && !isset($out[$courante])) {
        $out = [$courante => $courante . ' (heure actuelle)'] + $out;   // 25 au total, la limite
    }
    return $out;
}

// Heure de début → « HH:MM » normalisé, ou '' si illisible.
// Toujours utile bien que l'heure vienne d'une liste : elle normalise la valeur reçue
// et couvre la voie de repli (ancien champ libre « quand » d'un formulaire ouvert avant
// déploiement), ainsi qu'une valeur héritée réinjectée en tête de liste.
// Accepte : 21:00 · 21h30 · 21h · 21 · 2130 · 7:05 · 7h5
function parse_heure($s): string {
    $s = trim((string)$s);
    if ($s === '') return '';
    // Forme collée à 4 chiffres traitée à part : « 2130 » serait sinon coupé en 21 + 30
    // par hasard, et « 0730 » en 07 + 30 — corrects tous les deux, mais « 730 » donnerait
    // 73 h. Autant être explicite.
    if (preg_match('/^(\d{2})(\d{2})$/', $s, $m)) { $h = (int)$m[1]; $min = (int)$m[2]; }
    elseif (preg_match('/^(\d{1,2})\s*[:hH.]?\s*(\d{1,2})?$/', $s, $m)) {
        $h   = (int)$m[1];
        $min = (isset($m[2]) && $m[2] !== '') ? (int)$m[2] : 0;
    } else return '';
    if ($h > 23 || $min > 59) return '';
    return sprintf('%02d:%02d', $h, $min);
}

// Construit un MODAL de sortie (création OU modification) pré-rempli avec $vals.
//
// Chaque champ est enveloppé dans un LABEL (type 18) : il porte le libellé ET un
// sous-titre explicatif, sans consommer de composant supplémentaire. C'est aussi
// la structure que Discord recommande désormais pour les champs texte.
function sortie_modal($customId, $title, $vals = []) {
    $val = function ($id) use ($vals) { return trim((string)($vals[$id] ?? '')); };

    $enveloppe = function (array $composant, $label, $desc) {
        $l = ['type' => 18, 'label' => sn_cut($label, 45), 'component' => $composant];
        if ($desc !== '') $l['description'] = sn_cut($desc, 100);
        return $l;
    };

    $texte = function ($id, $label, $desc, $style, $required, $ph = '', $max = 0) use ($val, $enveloppe) {
        // Pas de 'label' sur le champ lui-même : c'est le LABEL parent qui le porte.
        $c = ['type' => 4, 'custom_id' => $id, 'style' => $style, 'required' => $required];
        if ($val($id) !== '') $c['value'] = $val($id);
        if ($ph !== '')       $c['placeholder'] = $ph;
        if ($max > 0)         $c['max_length']  = $max;
        return $enveloppe($c, $label, $desc);
    };

    $options = function (array $liste, $courant) {
        $opts = [];
        foreach ($liste as $value => $libelle) {
            $o = ['label' => sn_cut($libelle, 100), 'value' => sn_cut((string)$value, 100)];
            if ((string)$value === (string)$courant) $o['default'] = true;   // pré-sélection
            $opts[] = $o;
        }
        return $opts;
    };

    return ['type' => 9, 'data' => [
        'custom_id'  => $customId,
        'title'      => $title,
        'components' => [

            $texte('titre', 'Titre de la sortie', 'Ce que verront les inscrits dans le canal',
                   1, true, 'Run épice Sud — gros déstockage', 100),

            $enveloppe(
                ['type' => 3, 'custom_id' => 'jour', 'required' => true,
                 'options' => $options(jour_options($val('jour')), $val('jour'))],
                'Jour', ''
            ),

            $enveloppe(
                ['type' => 3, 'custom_id' => 'heure', 'required' => true,
                 'options' => $options(heure_options($val('heure')), $val('heure'))],
                'Heure de début', 'Les 24 heures de la journée'
            ),

            $enveloppe(
                // Radio group (type 21) : toutes les durées visibles d'un coup, un seul clic.
                // Non obligatoire — une durée absente vaut 4 h pour la purge, et une sortie
                // héritée dont la durée ne correspond à aucune option ne doit pas bloquer
                // l'enregistrement d'une modification.
                ['type' => 21, 'custom_id' => 'duree', 'required' => false,
                 'options' => $options(DUREE_OPTIONS, $val('duree'))],
                'Durée prévue', 'Activité automatiquement supprimée 4 h après la fin'
            ),

            $texte('desc', 'Consignes', 'Packtage, point de rendez-vous, objectif',
                   2, false, 'Objectif, packtage requis…', 600),
        ],
    ]];
}

// Ouvre le formulaire de CRÉATION (réponse type 9 = MODAL). $stype = type de sortie.
function respond_modal($stype = 'epice') {
    $t = sortie_type($stype);
    // Titre de modal : 45 caractères MAX côté Discord, au-delà le modal est rejeté
    // en bloc (et Discord n'affiche qu'une erreur générique). Les libellés de type
    // s'allongeant au fil des activités, on coupe systématiquement.
    echo json_encode(sortie_modal('sortie_create_modal:' . $stype, sn_cut('Nouvelle sortie ' . $t['label'], 45)));
    exit;
}


// ============================================================
//  SÉLECTEUR DE CRÉATION PAR CATÉGORIES
//
//  Pourquoi un sélecteur AVANT le formulaire : un modal accepte 5 composants
//  de premier niveau MAXIMUM, et les 5 sont déjà pris (titre / date / zone /
//  durée / description). Le type ne peut donc pas être demandé dans le modal.
//
//  Rendu en Components V2 (flag 32768) : conteneur + texte markdown + séparateur.
//  ⚠ Avec ce flag, `content` et `embeds` sont IGNORÉS par Discord sur le même
//  message — absolument tout doit passer par `components`.
//
//  Parcours : bouton catégorie → menu déroulant des types → modal (type 9).
//  Une interaction de composant a le droit de répondre par un modal ; une
//  soumission de modal, non (cf. le commentaire dans handle_create).
// ============================================================

// Écran 1 — les catégories. $origin : 'e' = éphémère (on éditera en place),
// 'p' = panneau public permanent (on ne doit PAS l'éditer, cf. handle_new_cat).
function build_cat_picker(string $origin): array {
    $btns = [];
    foreach (SORTIE_CATEGORIES as $cid => $c) {
        // On coupe le libellé AVANT d'ajouter le décompte : tronquer après amputerait
        // le nombre, qui est justement l'information la plus courte et la plus utile.
        $btns[] = ['type' => 2, 'style' => 2,
                   'label' => sn_cut($c['label'], 70) . ' (' . nb_activites_cat($cid) . ')',
                   'emoji' => ['name' => $c['icon']], 'custom_id' => "newcat:{$cid}:{$origin}"];
    }
    $rows = bouton_lignes($btns);

    $texte = ($origin === 'p')
        ? "## 🏜️ Créer une activité\nUne sortie à proposer ? Choisis une famille, le reste se fait en deux clics."
        : "## 🏜️ Créer une activité\nChoisis une famille d'activités.";

    return ['components' => [[
        'type'       => 17,                                          // CONTAINER
        'components' => array_merge(
            [['type' => 10, 'content' => $texte], ['type' => 14]],   // TEXT_DISPLAY + SEPARATOR
            $rows
        ),
    ]]];
}

// Range des boutons par lignes de 5 (plafond Discord), 4 lignes au maximum
// pour garder de la marge sous la limite de 5 lignes par message.
function bouton_lignes(array $boutons): array {
    $rows = [];
    $paquet = [];
    foreach ($boutons as $b) {
        $paquet[] = $b;
        if (count($paquet) === 5) { $rows[] = ['type' => 1, 'components' => $paquet]; $paquet = []; }
    }
    if ($paquet) $rows[] = ['type' => 1, 'components' => $paquet];
    return array_slice($rows, 0, 4);
}

// L'écran 2 a-t-il un intérêt pour cette famille ? Avec une seule sous-catégorie il
// n'offrirait qu'un bouton — un clic pour rien. On le saute alors, dans les deux sens
// de la navigation. C'est le cas de la famille « Autre », volontairement minimale.
function ecran_2_utile(string $cat): bool {
    return count(subs_of_cat($cat)) > 1;
}

// Décompte des activités, affiché entre parenthèses sur les boutons de navigation :
// on sait avant de cliquer si une piste est fournie ou quasi vide.
function nb_activites_sub(string $sub): int {
    $n = 0;
    foreach (SORTIE_TYPES as $id => $t) { if (sortie_sub($id) === $sub) $n++; }
    return $n;
}
function nb_activites_cat(string $cat): int {
    $n = 0;
    foreach (SORTIE_TYPES as $id => $t) { if (sortie_cat($id) === $cat) $n++; }
    return $n;
}

// Sous-catégories d'une famille, dans l'ordre de déclaration.
function subs_of_cat(string $cat): array {
    $out = [];
    foreach (SORTIE_SOUS_CATEGORIES as $sid => $s) {
        if (($s['cat'] ?? '') === $cat) $out[$sid] = $s;
    }
    return $out;
}

// Écran 2 — les sous-catégories d'une famille, en boutons.
//  Boutons et non sections : cet écran est de la NAVIGATION, comme l'écran 1 dont
//  il reprend la forme. L'écran 3, lui, est la feuille de l'arbre et détaille.
function build_sub_picker(string $cat): array {
    $c = SORTIE_CATEGORIES[$cat];
    $boutons = [];
    foreach (subs_of_cat($cat) as $sid => $s) {
        $boutons[] = ['type' => 2, 'style' => 2,
                      'label' => sn_cut($s['label'], 70) . ' (' . nb_activites_sub($sid) . ')',
                      'emoji' => ['name' => $s['icon']], 'custom_id' => 'newsub:' . $sid];
    }
    $retour = ['type' => 1, 'components' => [
        ['type' => 2, 'style' => 2, 'label' => 'Retour', 'emoji' => ['name' => '↩️'], 'custom_id' => 'newback'],
    ]];

    if (!$boutons) {
        return ['components' => [['type' => 17, 'components' => [
            ['type' => 10, 'content' => "### {$c['icon']} {$c['label']}\nAucune sous-catégorie dans cette famille."],
            $retour,
        ]]]];
    }

    return ['components' => [['type' => 17, 'components' => array_merge(
        [['type' => 10, 'content' => "### {$c['icon']} {$c['label']}\n{$c['desc']}"], ['type' => 14]],
        bouton_lignes($boutons),
        [$retour]
    )]]];
}

// Écran 3 — les activités d'une sous-catégorie.
//
//  Affichées À PLAT (une SECTION par activité : nom, sous-titre, bouton « Choisir »)
//  plutôt qu'en menu déroulant. Motif : un menu déroulant demande un clic rien que
//  pour découvrir ce qu'il contient — or c'est précisément la lisibilité qu'on
//  cherchait en créant les catégories.
//
//  Repli en menu déroulant au-delà de 8 activités : au-delà, l'écran devient un mur
//  de texte et on approche du plafond de 40 composants par message (chaque section
//  en coûte 3). Le menu, lui, plafonne à 25 options. Aucune sous-catégorie n'atteint
//  ce seuil aujourd'hui — la plus fournie en compte 5.
function build_activity_picker(string $sub): array {
    $s   = SORTIE_SOUS_CATEGORIES[$sub];
    $cat = $s['cat'] ?? '';
    // Retour vers l'écran 2 de SA famille, et non vers l'écran 1 : remonter d'un cran
    // à la fois est le seul comportement qui ne surprenne pas.
    // Exception : une famille à sous-catégorie unique n'a pas d'écran 2 (cf. écran_2_utile),
    // le retour doit donc sauter directement à l'écran 1 — sinon il afficherait un écran
    // d'un seul bouton, et un second clic serait nécessaire pour revenir vraiment.
    $cible = ecran_2_utile($cat) ? ('newbackcat:' . $cat) : 'newback';
    $retour = ['type' => 1, 'components' => [
        ['type' => 2, 'style' => 2, 'label' => 'Retour', 'emoji' => ['name' => '↩️'], 'custom_id' => $cible],
    ]];
    $tete = ['type' => 10, 'content' => "### {$s['icon']} {$s['label']}\n{$s['desc']}"];

    $ids = [];
    foreach (SORTIE_TYPES as $id => $t) { if (sortie_sub($id) === $sub) $ids[] = $id; }

    if (!$ids) {
        return ['components' => [['type' => 17, 'components' => [
            ['type' => 10, 'content' => "### {$s['icon']} {$s['label']}\nAucune activité rangée ici."],
            $retour,
        ]]]];
    }

    if (count($ids) <= 8) {
        $blocs = [];
        foreach ($ids as $id) {
            $t = SORTIE_TYPES[$id];
            $ligne = $t['icon'] . ' **' . $t['label'] . '**';
            if (trim((string)($t['desc'] ?? '')) !== '') $ligne .= "\n" . $t['desc'];
            $blocs[] = [
                'type'       => 9,                                              // SECTION
                'components' => [['type' => 10, 'content' => sn_cut($ligne, 400)]],
                'accessory'  => ['type' => 2, 'style' => 2, 'label' => 'Choisir', 'custom_id' => 'newpick:' . $id],
            ];
        }
        return ['components' => [['type' => 17, 'components' => array_merge(
            [$tete, ['type' => 14]], $blocs, [$retour]
        )]]];
    }

    $opts = [];
    foreach ($ids as $id) {
        $t = SORTIE_TYPES[$id];
        $o = ['label' => sn_cut($t['label'], 100), 'value' => $id, 'emoji' => ['name' => $t['icon']]];
        if (trim((string)($t['desc'] ?? '')) !== '') $o['description'] = sn_cut($t['desc'], 100);
        $opts[] = $o;
        // Au-delà de 25, Discord rejette le menu entier : mieux vaut une liste tronquée
        // qu'un écran cassé. Si ça arrive, c'est le signal qu'il faut scinder la sous-catégorie.
        if (count($opts) >= 25) break;
    }
    return ['components' => [['type' => 17, 'components' => [
        $tete,
        ['type' => 14],
        ['type' => 1, 'components' => [[
            'type' => 3, 'custom_id' => 'newtype', 'placeholder' => 'Activité…', 'options' => $opts,
        ]]],
        $retour,
    ]]]];
}

// Réponse à `/sortie creer` : sélecteur éphémère.
function respond_type_picker() {
    $data = build_cat_picker('e');
    $data['flags'] = 32768 | 64;    // Components V2 + éphémère
    echo json_encode(['type' => 4, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

// Clic sur une famille (écran 1 → écran 2). $args = "<cat>:<origine>".
function handle_new_cat($body, $args) {
    $parts  = explode(':', $args);
    $cat    = $parts[0] ?? '';
    $origin = $parts[1] ?? 'e';
    if (!array_key_exists($cat, SORTIE_CATEGORIES)) respond_message("Famille inconnue.", true);

    // Famille à sous-catégorie unique : on saute l'écran 2 et on affiche ses activités.
    // Le test porte sur « exactement 1 » et non sur ecran_2_utile() : une famille VIDE
    // (0 sous-catégorie) doit aller vers build_sub_picker, qui sait afficher le message
    // d'absence — array_keys([])[0] lèverait une erreur.
    $subs = subs_of_cat($cat);
    $data = (count($subs) === 1) ? build_activity_picker(array_keys($subs)[0]) : build_sub_picker($cat);
    if ($origin === 'p') {
        // Depuis le PANNEAU public : répondre en type 7 modifierait le message commun
        // pour tout le serveur. On ouvre donc un éphémère personnel (type 4).
        $data['flags'] = 32768 | 64;
        echo json_encode(['type' => 4, 'data' => $data], JSON_UNESCAPED_UNICODE);
    } else {
        // Depuis un éphémère : on remplace l'écran précédent en place, pas d'empilement.
        // Pas de flag 64 ici — l'état éphémère est hérité et ne peut pas être changé.
        $data['flags'] = 32768;
        echo json_encode(['type' => 7, 'data' => $data], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

// Clic sur une sous-catégorie (écran 2 → écran 3). Toujours dans un éphémère ici :
// l'écran 2 n'existe jamais en public, seul l'écran 1 est épinglable.
function handle_new_sub($sub) {
    if (!array_key_exists($sub, SORTIE_SOUS_CATEGORIES)) respond_message("Sous-catégorie inconnue.", true);
    $data = build_activity_picker($sub);
    $data['flags'] = 32768;
    echo json_encode(['type' => 7, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

// Bouton « Retour » de l'écran 3 → écran 2 de la famille d'où l'on vient.
function handle_new_back_cat($cat) {
    if (!array_key_exists($cat, SORTIE_CATEGORIES)) respond_message("Famille inconnue.", true);
    $data = build_sub_picker($cat);
    $data['flags'] = 32768;
    echo json_encode(['type' => 7, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

// Bouton « Choisir » d'une activité (affichage à plat) → ouverture du formulaire.
function handle_new_pick(string $stype) {
    if (!array_key_exists($stype, SORTIE_TYPES)) respond_message("Type d'activité inconnu.", true);
    respond_modal($stype);
}

// Choix du type dans le menu déroulant (repli au-delà de 8 activités) → formulaire.
function handle_new_type($body) {
    $stype = (string)($body['data']['values'][0] ?? '');
    if (!array_key_exists($stype, SORTIE_TYPES)) respond_message("Type d'activité inconnu.", true);
    respond_modal($stype);
}

// Bouton « Retour » → on revient aux catégories (on est toujours dans un éphémère ici).
function handle_new_back() {
    $data = build_cat_picker('e');
    $data['flags'] = 32768;
    echo json_encode(['type' => 7, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

// `/sortie panneau` — poste le sélecteur en message PUBLIC permanent, à épingler
// dans le canal des sorties : plus besoin de taper la commande pour créer.
// Réservé au staff, puisque ça laisse un message durable dans le canal.
function handle_panneau($body) {
    if (!member_is_staff($body)) respond_message("✋ Réservé aux modérateurs et aux admins.", true);
    $data = build_cat_picker('p');
    $data['flags'] = 32768;    // Components V2, message public
    echo json_encode(['type' => 4, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

// Convertit une date stockée Y-m-d (format interne) en JJ-MM-AAAA pour l'affichage
// (repli : chaîne telle quelle si illisible).
function fmt_date_fr($isoDate) {
    $d = DateTime::createFromFormat('Y-m-d', trim((string)$isoDate));
    return ($d instanceof DateTime) ? $d->format('d-m-Y') : $isoDate;
}

// Reconstruit "JJ-MM-AAAA HH:MM" à partir des champs date (Y-m-d) + heure, pour pré-remplir le modal.
function fmt_when($sortie) {
    $heure = $sortie['heure'] ?? '';
    return trim(fmt_date_fr($sortie['date'] ?? '') . ' ' . $heure);
}

// Jour + heure soumis → [Y-m-d, H:i]. Les deux viennent de listes, il n'y a donc
// plus rien à interpréter. Repli sur l'ancien champ libre « quand » (et son analyse
// tolérante) pour un modal ouvert avant le déploiement du nouveau formulaire.
function modal_when(array $v): array {
    $date  = trim((string)($v['jour'] ?? ''));
    if ($date === '' && isset($v['quand'])) return parse_when($v['quand']);
    return [$date, parse_heure($v['heure'] ?? '')];
}

// Formate la durée pour l'affichage : "2" → "2h" ; "1h30"/"2h" → tels quels ; vide → "".
function fmt_duree($d) {
    $d = trim((string)$d);
    if ($d === '') return '';
    return ctype_digit($d) ? $d . 'h' : $d;
}

// Crée la sortie + poste l'encart (réponse type 4 = message public). $stype = type de sortie.
function handle_create($body, $stype = 'epice') {
    $v = modal_values($body);
    $user = interaction_user($body);

    $titre = trim($v['titre'] ?? '');
    if ($titre === '') respond_message("Le titre est obligatoire.", true);

    [$date, $heure] = modal_when($v);
    // Filet devenu théorique depuis que le jour et l'heure sont des listes obligatoires,
    // mais conservé : il couvre le modal ouvert AVANT le déploiement et soumis après.
    // Sans heure exploitable, la purge auto (discord_sortie_cleanup.php) ne peut jamais
    // calculer de fin et ignore la sortie pour toujours.
    // Discord INTERDIT de répondre à un MODAL_SUBMIT par un nouveau modal (rejeté silencieusement,
    // Discord affiche alors son propre bandeau générique) : on répond par un message avec
    // récapitulatif, pour permettre un copier-coller rapide dans un nouveau /sortie creer.
    if ($heure === '') respond_missing_heure($v);

    $sortie = [
        'id'          => 'sortie_' . time(),
        'type'        => $stype,
        'date'        => $date,
        'heure'       => $heure,
        'titre'       => $titre,
        'zone'        => trim($v['zone'] ?? ''),
        'duree'       => trim($v['duree'] ?? ''),
        'description' => trim($v['desc'] ?? ''),
        'statut'      => 'ouverte',
        'source'      => 'discord',
        'createur'    => $user['name'],
        'discord'     => [
            'user_id'    => $user['id'],
            'channel_id' => $body['channel_id']        ?? ($body['channel']['id'] ?? ''),
            'guild_id'   => $body['guild_id']          ?? '',
        ],
        'signups'     => [],
        'debriefs'    => [],
    ];

    if (sortie_type($stype)['site']) {
        // ÉPICE : intégré à l'Activité Guilde. Multi-sorties : on N'ARCHIVE PLUS les
        // autres ouvertes (plusieurs en parallèle) ; cette sortie devient la "vedette".
        $d = read_data();
        $d['sorties'][]     = $sortie;
        $d['soiree_active'] = ['id'=>$sortie['id'],'date'=>$date,'titre'=>$titre,'zone'=>$sortie['zone'],'statut'=>'ouverte'];
        if (!write_data($d)) respond_message("Fichier de sorties occupé (accès concurrent). Réessaie dans quelques secondes.", true);
    } else {
        // AUTRES TYPES : store Discord séparé, n'affecte pas le débrief ni la soirée active.
        $ds = read_dstore();
        $ds['sorties'][] = $sortie;
        if (!write_dstore($ds)) respond_message("Fichier de sorties occupé (accès concurrent). Réessaie dans quelques secondes.", true);
    }

    global $CFG;
    // Le formulaire a-t-il été ouvert depuis le SÉLECTEUR (un composant) ? Dans ce cas
    // l'interaction porte le message éphémère qui l'a déclenché, et on peut le remplacer
    // par un accusé de réception — sinon l'écran de choix d'activité reste affiché
    // derrière la sortie fraîchement créée, ce qui donne l'impression que rien n'a été
    // validé. L'encart public est alors posté par le bot via l'API REST.
    // Repli sur l'ancien comportement (réponse type 4) si le formulaire vient d'une
    // slash command, ou si le bot_token manque : mieux vaut un éphémère résiduel qu'une
    // sortie enregistrée dont l'encart n'est jamais posté.
    $chan     = $body['channel_id'] ?? ($body['channel']['id'] ?? '');
    $depuisUI = isset($body['message']) && $chan !== '' && !empty($CFG['bot_token']);

    if (!$depuisUI) {
        echo json_encode(['type' => 4, 'data' => build_sortie_message($sortie)]);
        // On répond à Discord tout de suite (rafraîchit sous la limite de 3 s), puis on va
        // rechercher l'id du message qu'il vient de créer — Discord ne le renvoie PAS dans la
        // réponse d'interaction elle-même (type 4), il faut le redemander via l'API webhook.
        // Sans ce message_id, discord_sortie_cleanup.php (purge auto 4 h après la fin) ne sait
        // jamais QUOI supprimer et ignore silencieusement la sortie pour toujours.
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        $mid = fetch_original_message_id($body);
        if ($mid !== '') {
            mutate_sortie($sortie['id'], function (&$s) use ($mid) { $s['discord']['message_id'] = $mid; });
        } else {
            dlog('handle_create: message_id introuvable pour sortie ' . $sortie['id'] . ' — purge auto impossible pour ce post');
        }
        exit;
    }

    // Type 7 = on ÉDITE l'éphémère du sélecteur. Le flag Components V2 doit être répété :
    // le message a été créé avec, et `content` y resterait ignoré.
    $t = sortie_type($stype);
    echo json_encode(['type' => 7, 'data' => [
        'flags'      => 32768,
        'components' => [['type' => 17, 'components' => [
            ['type' => 10, 'content' => "### ✅ Activité créée\n{$t['icon']} **" . $titre . "**\nL'encart est posté dans le canal, les inscriptions sont ouvertes."],
        ]]],
    ]], JSON_UNESCAPED_UNICODE);

    // Puis le bot poste lui-même l'encart. Avantage secondaire : l'API REST renvoie
    // directement l'id du message, là où une réponse d'interaction obligeait à le
    // redemander ensuite (cf. fetch_original_message_id).
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    $mid = discord_post_message_api($chan, build_sortie_message($sortie));
    if ($mid !== '') {
        mutate_sortie($sortie['id'], function (&$s) use ($mid) { $s['discord']['message_id'] = $mid; });
        // Encart posté : l'accusé de réception n'a plus de raison d'être, on efface
        // l'éphémère pour ne rien laisser traîner dans le fil.
        // ⚠ L'ORDRE compte : on répond d'abord par un type 7 (l'accusé), puis on supprime.
        // Si la suppression échoue, l'utilisateur voit « ✅ Activité créée » — un état
        // correct. Un type 6 (accusé muet) suivi d'un échec de suppression laisserait
        // à l'écran l'ancien sélecteur d'activité, comme si rien ne s'était passé.
        delete_interaction_original($body);
    } else {
        dlog('handle_create: encart non posté pour sortie ' . $sortie['id'] . ' (canal ' . $chan . ') — la sortie existe côté données mais pas dans le canal');
    }
    exit;
}

// Supprime la réponse d'interaction en cours (ici : l'éphémère du sélecteur, édité
// juste avant en type 7). Authentifié par le TOKEN D'INTERACTION, pas par le bot token
// — un message éphémère n'est pas supprimable via l'API de canal.
function delete_interaction_original($body): bool {
    global $CFG;
    $token = $body['token'] ?? '';
    if ($token === '' || empty($CFG['app_id']) || !function_exists('curl_init')) return false;
    $ch = curl_init("https://discord.com/api/v10/webhooks/{$CFG['app_id']}/{$token}/messages/@original");
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT        => 4,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300) {
        dlog("delete_interaction_original échec HTTP {$code} : " . substr((string)$resp, 0, 200));
        return false;
    }
    return true;
}

// Poste un message dans un canal via l'API bot. Retourne l'id du message créé, ou ''.
function discord_post_message_api($channelId, array $data): string {
    global $CFG;
    if (!$channelId || empty($CFG['bot_token']) || !function_exists('curl_init')) return '';
    $ch = curl_init("https://discord.com/api/v10/channels/{$channelId}/messages");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($data, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 8,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code < 200 || $code >= 300) {
        dlog("discord_post_message_api échec canal={$channelId} HTTP {$code} : " . substr((string)$resp, 0, 300));
        return '';
    }
    $j = json_decode($resp, true);
    return (string)($j['id'] ?? '');
}

// Récupère l'id du message que Discord vient de créer à partir d'une réponse d'interaction
// (type 4/7) — endpoint "get original interaction response", authentifié par le token de
// l'interaction (pas le bot token). Le token n'est valable que ~15 min après l'interaction.
function fetch_original_message_id($body) {
    global $CFG;
    $token = $body['token'] ?? '';
    $appId = $CFG['app_id'] ?? '';
    if ($token === '' || $appId === '') return '';
    $ch = curl_init("https://discord.com/api/v10/webhooks/{$appId}/{$token}/messages/@original");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) { dlog('fetch_original_message_id: HTTP ' . $code); return ''; }
    $j = json_decode((string)$res, true);
    return (string)($j['id'] ?? '');
}

// Trouve la sortie par id dans l'un des deux stores (débrief OU store Discord),
// applique la mutation sur ses signups, sauvegarde, et renvoie la sortie à jour (ou null).
function mutate_sortie($sortieId, callable $fn) {
    $d = read_data();
    foreach ($d['sorties'] as &$s) {
        if (($s['id'] ?? '') === $sortieId) {
            if (!isset($s['signups']) || !is_array($s['signups'])) $s['signups'] = [];
            $fn($s); write_data($d); return $s;
        }
    }
    unset($s);
    $ds = read_dstore();
    foreach ($ds['sorties'] as &$s) {
        if (($s['id'] ?? '') === $sortieId) {
            if (!isset($s['signups']) || !is_array($s['signups'])) $s['signups'] = [];
            $fn($s); write_dstore($ds); return $s;
        }
    }
    unset($s);
    return null;
}

// Upsert l'inscription d'un membre (un membre = une seule entrée, remplacée).
function upsert_signup(&$s, $user, $poste, $statut) {
    foreach ($s['signups'] as &$su) {
        if (($su['id'] ?? '') === $user['id']) {
            $su['poste'] = $poste; $su['statut'] = $statut; $su['name'] = $user['name']; $su['ts'] = time();
            return;
        }
    }
    unset($su);
    $s['signups'][] = ['id'=>$user['id'],'name'=>$user['name'],'poste'=>$poste,'statut'=>$statut,'ts'=>time()];
}

// Inscription à un poste (select des types à postes). Statut « présent » + poste choisi.
// Le poste est validé contre le jeu de postes DU TYPE de la sortie (épice ≠ PvP) :
// on relit donc la sortie avant de muter, pour connaître son type.
function handle_signup($body, $sortieId) {
    $poste  = $body['data']['values'][0] ?? '';
    $sortie = find_sortie($sortieId);
    if (!$sortie) respond_message("Cette sortie n'existe plus.", true);
    if (!array_key_exists($poste, postes_all($sortie['type'] ?? 'epice'))) respond_message("Poste inconnu.", true);
    $user = interaction_user($body);
    $updated = mutate_sortie($sortieId, function (&$s) use ($user, $poste) {
        upsert_signup($s, $user, $poste, 'present');
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    // type 7 = UPDATE_MESSAGE : on réécrit l'encart sur place (roster à jour).
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}

// Réponse présent (RSVP) / peut-être / absent (boutons) : un statut, sans poste.
function handle_status($body, $sortieId, $statut) {
    $user = interaction_user($body);
    $updated = mutate_sortie($sortieId, function (&$s) use ($user, $statut) {
        upsert_signup($s, $user, '', $statut);
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}

// Désinscription (bouton) : retire complètement le membre.
function handle_unsignup($body, $sortieId) {
    $user = interaction_user($body);
    $updated = mutate_sortie($sortieId, function (&$s) use ($user) {
        $s['signups'] = array_values(array_filter($s['signups'], function ($su) use ($user) {
            return ($su['id'] ?? '') !== $user['id'];
        }));
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}

// Bascule « je candidate comme Chef de section » (drapeau optionnel, en plus
// du poste choisi — ne remplace rien). Réservé à ceux déjà inscrits à un
// poste, sinon le badge n'aurait aucun endroit où s'afficher.
function handle_toggle_chef($body, $sortieId) {
    $user = interaction_user($body);
    $found = false;
    $updated = mutate_sortie($sortieId, function (&$s) use ($user, &$found) {
        foreach ($s['signups'] as &$su) {
            if (($su['id'] ?? '') === $user['id']) {
                $su['chef_section'] = empty($su['chef_section']);
                $found = true;
                return;
            }
        }
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    if (!$found) respond_message("Inscris-toi d'abord à un poste, puis candidate comme Chef de section.", true);
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}


// ============================================================
//  MODIFICATION / SUPPRESSION (réservées au créateur de l'activité)
// ============================================================

// Le cliqueur est-il le créateur de la sortie ?
function is_creator($body, $sortie): bool {
    $u = interaction_user($body)['id'];
    return $u !== '' && $u === ($sortie['discord']['user_id'] ?? '');
}

// Le cliqueur a-t-il un rôle de staff (admin/modérateur) sur le serveur ?
// On lit le bitfield de permissions du membre fourni dans l'interaction.
function member_is_staff($body): bool {
    $perms = $body['member']['permissions'] ?? '';
    if ($perms === '') return false;
    $p = intval($perms); // PHP 64 bits : couvre tous les bits utilisés ci-dessous
    // ADMINISTRATOR(8) | MANAGE_GUILD(32) | MANAGE_MESSAGES(8192) | KICK(2) | BAN(4) | MODERATE_MEMBERS(1<<40)
    $staffMask = 8 | 32 | 8192 | 2 | 4 | 1099511627776;
    return ($p & $staffMask) !== 0;
}

// Peut gérer l'activité = créateur OU staff (modérateur/admin).
function can_manage($body, $sortie): bool {
    return is_creator($body, $sortie) || member_is_staff($body);
}

// Cherche une sortie par id dans les deux stores (lecture seule).
function find_sortie($id) {
    foreach (read_data()['sorties']  as $s) { if (($s['id'] ?? '') === $id) return $s; }
    foreach (read_dstore()['sorties'] as $s) { if (($s['id'] ?? '') === $id) return $s; }
    return null;
}

// Ouvre le formulaire de MODIFICATION (pré-rempli). Réservé au créateur.
function handle_edit_open($body, $sid) {
    $sortie = find_sortie($sid);
    if (!$sortie)                      respond_message("Cette activité n'existe plus.", true);
    if (!can_manage($body, $sortie))   respond_message("✋ Réservé à l'organisateur, aux modérateurs et aux admins.", true);
    $vals = [
        'titre'  => $sortie['titre'] ?? '',
        'jour'   => $sortie['date'] ?? '',
        'heure'  => $sortie['heure'] ?? '',
        'duree'  => $sortie['duree'] ?? '',
        'desc'   => $sortie['description'] ?? '',
    ];
    echo json_encode(sortie_modal('sortie_edit_modal:' . $sid, 'Modifier la sortie', $vals));
    exit;
}

// Enregistre la modification + rafraîchit l'encart. Réservé au créateur.
function handle_edit_save($body, $sid) {
    $sortie = find_sortie($sid);
    if (!$sortie)                    respond_message("Cette activité n'existe plus.", true);
    if (!can_manage($body, $sortie)) respond_message("✋ Réservé à l'organisateur, aux modérateurs et aux admins.", true);

    // Date/heure AVANT modification (pour détecter un changement → MP aux inscrits)
    // + auteur de la modif (qu'on n'avertit pas lui-même).
    $oldDate  = $sortie['date']  ?? '';
    $oldHeure = $sortie['heure'] ?? '';
    $editorId = interaction_user($body)['id'];

    $v = modal_values($body);
    $titre = trim($v['titre'] ?? '');
    if ($titre === '') respond_message("Le titre est obligatoire.", true);
    [$date, $heure] = modal_when($v);
    if ($heure === '') respond_missing_heure($v);

    $updated = mutate_sortie($sid, function (&$s) use ($titre, $date, $heure, $v) {
        $s['titre']       = $titre;
        $s['date']        = $date;
        $s['heure']       = $heure;
        $s['description'] = trim($v['desc'] ?? '');
        // ⚠ Écriture CONDITIONNELLE, contrairement aux champs ci-dessus. La ZONE ne
        // figure plus au formulaire : une affectation inconditionnelle effacerait la
        // zone de toutes les sorties existantes à la première modification.
        // Même raisonnement pour la DURÉE : une valeur héritée hors options
        // (ex. « 5h ») ne coche aucun radio et revient vide — ce n'est pas un
        // effacement demandé, seulement une absence de réponse.
        if (isset($v['zone']))                        $s['zone']  = trim($v['zone']);
        if (isset($v['duree']) && $v['duree'] !== '') $s['duree'] = trim($v['duree']);
    });
    if (!$updated) respond_message("Cette activité n'existe plus.", true);

    // Si c'est la soirée épice active, on synchronise aussi le miroir soiree_active.
    $d = read_data();
    if (($d['soiree_active']['id'] ?? null) === $sid) {
        $d['soiree_active']['titre'] = $titre;
        $d['soiree_active']['date']  = $date;
        if (isset($v['zone'])) $d['soiree_active']['zone'] = trim($v['zone']);  // cf. garde ci-dessus
        write_data($d);
    }

    // On répond à Discord (rafraîchit l'encart) AVANT d'envoyer les MP → on reste sous la limite de 3 s.
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);

    // MP aux inscrits si la DATE et/ou l'HEURE a changé — envoi en arrière-plan.
    if ($oldDate !== $date || $oldHeure !== $heure) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        notify_when_change($updated, $oldDate, $oldHeure, $editorId);
    }
    exit;
}

// ============================================================
//  NOTIFICATION MP — changement de date/heure d'une activité
// ============================================================

// Ouvre (ou récupère) le canal MP avec un utilisateur. Renvoie l'id du canal ou ''.
function dm_open_channel($userId) {
    global $CFG;
    if (!$userId || empty($CFG['bot_token']) || !function_exists('curl_init')) return '';
    $ch = curl_init('https://discord.com/api/v10/users/@me/channels');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['recipient_id' => (string)$userId]),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300) { dlog("dm_open_channel échec uid={$userId} HTTP {$code}"); return ''; }
    $j = json_decode($resp, true);
    return $j['id'] ?? '';
}

// Envoie un MP texte à un utilisateur. Silencieux : un échec (MP fermés, blocage…) est juste journalisé.
function dm_send($userId, $content) {
    global $CFG;
    $chan = dm_open_channel($userId);
    if (!$chan) return false;
    $ch = curl_init("https://discord.com/api/v10/channels/{$chan}/messages");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['content' => $content], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $code = (curl_exec($ch) !== false) ? curl_getinfo($ch, CURLINFO_HTTP_CODE) : 0;
    curl_close($ch);
    if ($code < 200 || $code >= 300) { dlog("dm_send échec uid={$userId} HTTP {$code}"); return false; }
    return true;
}

// Prévient par MP les inscrits d'un changement de date/heure.
// Message différencié selon le statut (présent / peut-être / absent).
// N'envoie rien à l'auteur de la modif. Un seul MP par personne.
function notify_when_change($sortie, $oldDate, $oldHeure, $editorId) {
    $titre   = $sortie['titre'] ?? 'la sortie';
    $icon    = sortie_type($sortie['type'] ?? 'epice')['icon'] ?? '📌';
    $newWhen = fmt_when($sortie);
    $oldWhen = fmt_when(['date' => $oldDate, 'heure' => $oldHeure]);

    $head = "{$icon} **L'activité « {$titre} » a été modifiée.**\n"
          . "📅 Nouvelle date/heure : **{$newWhen}**"
          . ($oldWhen !== '' ? "  _(avant : {$oldWhen})_" : '') . "\n\n";

    $tail = [
        'present' => "Tu étais inscrit comme **✅ Présent** : vérifie que le nouveau créneau te convient toujours !",
        'maybe'   => "Tu avais répondu **❓ Peut-être** : le créneau a changé, n'hésite pas à confirmer ou décliner.",
        'absent'  => "Tu avais indiqué **✖️ Absent** : le créneau a changé, celui-ci t'arrange peut-être mieux ?",
    ];

    $seen = [];
    foreach ($sortie['signups'] ?? [] as $su) {
        $uid = (string)($su['id'] ?? '');
        if ($uid === '' || $uid === (string)$editorId || isset($seen[$uid])) continue;
        $seen[$uid] = true;
        $statut = $su['statut'] ?? 'present';
        if (!isset($tail[$statut])) $statut = 'present';
        dm_send($uid, $head . $tail[$statut]);
        usleep(200000); // ~5 MP/s : sous la limite de Discord
    }
}

// Étape 1 — demande de CONFIRMATION (éphémère, visible du seul créateur). Réservé au créateur.
function handle_delete($body, $sid) {
    $sortie = find_sortie($sid);
    if (!$sortie)                    respond_message("Cette activité n'existe plus.", true);
    if (!can_manage($body, $sortie)) respond_message("✋ Réservé à l'organisateur, aux modérateurs et aux admins.", true);

    // On embarque le salon + l'id du message d'origine dans le bouton de confirmation,
    // car l'éphémère qui suit n'aura plus accès au message de l'activité.
    $ch  = $body['channel_id'] ?? '';
    $mid = $body['message']['id'] ?? '';
    // Une sortie liée au site (épice) conserve ses données → message adapté.
    $isSite  = sortie_type($sortie['type'] ?? 'epice')['site'];
    $titre   = $sortie['titre'] ?? '';
    $content = $isSite
        ? "🗑️ Retirer le post de **{$titre}** du canal ?\nLes données du raid (retours, compo, analyse) **restent conservées sur le site**."
        : "🗑️ Supprimer définitivement l'activité **{$titre}** ?\nCette action est irréversible.";
    echo json_encode(['type' => 4, 'data' => [
        'flags'   => 64, // éphémère
        'content' => $content,
        'components' => [['type' => 1, 'components' => [
            ['type' => 2, 'style' => 4, 'label' => ($isSite ? 'Retirer le post' : 'Confirmer la suppression'), 'emoji' => ['name' => '🗑️'], 'custom_id' => "delok:{$sid}:{$ch}:{$mid}"],
        ]]],
    ]]);
    exit;
}

// Étape 2 — suppression effective après confirmation. $args = "<sid>:<channelId>:<messageId>".
function handle_delete_confirm($body, $args) {
    $parts = explode(':', $args);
    $sid = $parts[0] ?? '';
    $ch  = $parts[1] ?? '';
    $mid = $parts[2] ?? '';
    $sortie = find_sortie($sid);
    // L'éphémère n'est visible que du créateur ; on revérifie quand même si la sortie existe encore.
    if ($sortie && !can_manage($body, $sortie)) respond_update("✋ Réservé à l'organisateur, aux modérateurs et aux admins.");

    $res = delete_sortie_by_id($sid);
    discord_delete_message_api($ch, $mid); // le bot supprime son propre message d'activité
    respond_update($res === 'kept'
        ? "🗑️ Post retiré du canal. Les données du raid (retours, compo, analyse) sont **conservées sur le site**."
        : "🗑️ Activité supprimée.");
}

// Suppression depuis le bouton 🗑️ Discord.
//  - ÉPICE (débriefs.json, liée au site) : on CONSERVE les données du raid
//    (retours, compo, analyse, historique). On marque seulement le post comme
//    retiré (discord.cleaned) pour que le nettoyage auto ne le reprenne pas.
//    → retourne 'kept'. La suppression réelle se fait depuis le site (admin).
//  - Autres types (store Discord séparé = simple jauge d'intérêt) : suppression
//    complète de la fiche. → retourne 'removed'.
function delete_sortie_by_id($id) {
    $d = read_data();
    foreach ($d['sorties'] as &$s) {
        if (($s['id'] ?? '') === $id) {
            $s['discord']['cleaned'] = true; // post retiré, données conservées
            write_data($d);
            return 'kept';
        }
    }
    unset($s);
    $ds = read_dstore(); $n = count($ds['sorties']);
    $ds['sorties'] = array_values(array_filter($ds['sorties'], function ($s) use ($id) { return ($s['id'] ?? '') !== $id; }));
    if (count($ds['sorties']) !== $n) { write_dstore($ds); return 'removed'; }
    return false;
}

// Supprime un message Discord via l'API (auth bot token).
function discord_delete_message_api($channelId, $messageId) {
    global $CFG;
    if (!$channelId || !$messageId || empty($CFG['bot_token']) || !function_exists('curl_init')) return;
    $ch = curl_init("https://discord.com/api/v10/channels/{$channelId}/messages/{$messageId}");
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT        => 3,
    ]);
    curl_exec($ch);
    curl_close($ch);
}


// ============================================================
//  RENDU DE L'ENCART (embed + composants)
// ============================================================
function build_sortie_message($sortie) {
    $desc = '';
    if (trim($sortie['description'] ?? '') !== '') $desc .= $sortie['description'] . "\n\n";
    $when = trim(fmt_date_fr($sortie['date'] ?? '') . ' · ' . ($sortie['heure'] ?? ''), ' ·');
    if ($when !== '')                          $desc .= "📅 **{$when}**\n";
    if (fmt_duree($sortie['duree'] ?? '') !== '') $desc .= "⏱️ Durée : " . fmt_duree($sortie['duree']) . "\n";
    if (trim($sortie['zone'] ?? '') !== '')    $desc .= "📍 " . $sortie['zone'] . "\n";

    $signups = $sortie['signups'] ?? [];
    $bullet  = function ($n) { return "• {$n}"; };
    // Statut par défaut 'present' (rétro-compat : anciennes inscriptions sans champ statut).
    $st = function ($su) { return $su['statut'] ?? 'present'; };

    // "X/N inscrits" = uniquement les présents (ceux qui prennent une place).
    $nb = 0;
    foreach ($signups as $su) { if ($st($su) === 'present') $nb++; }
    $desc .= "👥 **{$nb}** inscrit" . ($nb > 1 ? 's' : '');

    $stype     = $sortie['type'] ?? 'epice';
    $t         = sortie_type($stype);
    $usePostes = (bool)$t['postes'];

    $fields = [];
    if ($usePostes) {
        // TYPES À POSTES (épice, entraînement PvP) : un champ par poste (présents regroupés)
        $selectable = postes_selectable($stype);
        $allPostes  = postes_all($stype);
        // Poste vide (RSVP « Présent » d'avant le passage de ce type à l'inscription
        // par poste) ou inconnu du jeu courant : regroupé sous « Présent (poste à
        // définir) » plutôt que de disparaître de l'encart.
        $bucket = function ($su) use ($allPostes) {
            $p = $su['poste'] ?? '';
            return array_key_exists($p, $allPostes) ? $p : 'present';
        };
        foreach ($allPostes as $pid => $plabel) {
            $names = [];
            foreach ($signups as $su) {
                if ($st($su) !== 'present' || $bucket($su) !== $pid) continue;
                // 🎖️ : a candidaté comme Chef de section (drapeau optionnel, cf handle_toggle_chef).
                $names[] = $su['name'] . (!empty($su['chef_section']) ? ' 🎖️' : '');
            }
            // Poste retiré du menu (ex. Défenseur CaC) ET personne dessus : le "0" n'a
            // aucun sens puisque plus personne ne peut le choisir → colonne masquée.
            // Une inscription historique existante (ancienne sortie, avant retrait)
            // reste affichée normalement (cf. commentaire sur POSTES plus haut).
            if (!$names && !array_key_exists($pid, $selectable)) continue;
            $icon = POSTE_ICON[$pid] ?? '•';
            $fields[] = [
                'name'   => "{$icon} {$plabel} (" . count($names) . ")",
                'value'  => $names ? implode("\n", array_map($bullet, $names)) : "—",
                'inline' => true,
            ];
        }
    } else {
        // AUTRES TYPES : une seule colonne « Présents » (RSVP)
        $presentNames = [];
        foreach ($signups as $su) { if ($st($su) === 'present') $presentNames[] = $su['name']; }
        $fields[] = [
            'name'   => "✅ Présents (" . count($presentNames) . ")",
            'value'  => $presentNames ? implode("\n", array_map($bullet, $presentNames)) : "—",
            'inline' => true,
        ];
    }

    // Champs Peut-être / Absent (communs à tous les types)
    $maybeNames = []; $absentNames = [];
    foreach ($signups as $su) {
        if ($st($su) === 'maybe')  $maybeNames[]  = $su['name'];
        if ($st($su) === 'absent') $absentNames[] = $su['name'];
    }
    $fields[] = [
        'name'   => "❓ Peut-être (" . count($maybeNames) . ")",
        'value'  => $maybeNames ? implode("\n", array_map($bullet, $maybeNames)) : "—",
        'inline' => true,
    ];
    $fields[] = [
        'name'   => "✖️ Absent (" . count($absentNames) . ")",
        'value'  => $absentNames ? implode("\n", array_map($bullet, $absentNames)) : "—",
        'inline' => true,
    ];

    $embed = [
        // Le NOM DE L'ACTIVITÉ en tête d'encart. Il ne vivait que dans le pied de page,
        // en petit et noyé entre l'organisateur et l'appel à s'inscrire : on lisait le
        // titre libre de la sortie (« test ») sans savoir de quelle activité il s'agissait.
        // L'author line est le seul emplacement au-dessus du titre.
        'author'      => ['name' => sn_cut($t['icon'] . ' ' . $t['label'], 256)],
        'title'       => $t['icon'] . ' ' . ($sortie['titre'] ?? 'Sortie'),
        'description' => $desc,
        'color'       => hexdec('D4A23B'), // doré Dune
        'fields'      => $fields,
        // Le libellé du type n'y est plus répété — il est désormais en tête.
        'footer'      => ['text' => 'organisé par ' . ($sortie['createur'] ?? '?') . ' · inscris-toi ci-dessous'
            . ($usePostes ? ' · 🎖️ = candidat Chef de section' : '')],
    ];

    // Bannière, dans l'ordre : celle du type → celle d'« Activité Guilde » (le
    // fourre-tout, choisi comme illustration générique) → 'banner_url' → le fichier
    // par défaut connu du code. Une activité a donc TOUJOURS une illustration, même
    // avec une config vierge — la seule façon de n'en avoir aucune est que le fichier
    // par défaut soit absent du serveur.
    //
    // ⚠ On teste la valeur VIDE, pas seulement la clé absente. Avec `??`, une entrée
    // présente mais vide (`'epice' => ''`, ce que produit le gabarit de config) bloquait
    // le repli : ces types n'affichaient aucune bannière alors qu'un défaut était
    // configuré, tandis que les types sans entrée du tout l'obtenaient. Vide = « pas
    // renseigné », donc traité comme absent.
    global $CFG;
    $banner = '';
    foreach ([$stype, BANNIERE_DEFAUT_TYPE] as $cle) {
        $banner = trim((string)($CFG['banners'][$cle] ?? ''));
        if ($banner !== '') break;
    }
    if ($banner === '') $banner = trim((string)($CFG['banner_url'] ?? ''));
    if ($banner === '') {
        // `site_url` distingue prod (racine) et test (/v2) ; vide = prod, ce qui rend
        // l'image visible depuis /v2 aussi. Renseigner site_url sur '.../v2' fait
        // chercher le fichier dans /v2/epice/img/ — il doit alors y être déposé.
        $base = trim((string)($CFG['site_url'] ?? ''));
        if ($base === '') $base = 'https://havresgris.ddns.net';
        $banner = rtrim($base, '/') . BANNIERE_DEFAUT_FICHIER;
    }
    if ($banner !== '') $embed['image'] = ['url' => $banner];

    $sid = $sortie['id'];
    if ($usePostes) {
        // TYPES À POSTES : menu déroulant de postes + boutons peut-être / absent / désinscription.
        $options = [];
        foreach (postes_selectable($stype) as $pid => $plabel) {
            $options[] = ['label' => $plabel, 'value' => $pid, 'emoji' => ['name' => POSTE_ICON[$pid] ?? '✅']];
        }
        $components = [
            ['type' => 1, 'components' => [[
                'type' => 3, 'custom_id' => "signup:{$sid}",
                'placeholder' => "M'inscrire à un poste", 'options' => $options,
            ]]],
            ['type' => 1, 'components' => [
                ['type' => 2, 'style' => 1, 'label' => 'Peut-être',      'emoji' => ['name' => '❓'], 'custom_id' => "maybe:{$sid}"],
                ['type' => 2, 'style' => 4, 'label' => 'Absent',         'emoji' => ['name' => '✖️'], 'custom_id' => "absent:{$sid}"],
                ['type' => 2, 'style' => 2, 'label' => 'Me désinscrire', 'custom_id' => "unsignup:{$sid}"],
                ['type' => 2, 'style' => 2, 'label' => 'Chef de section', 'emoji' => ['name' => '🎖️'], 'custom_id' => "chef:{$sid}"],
            ]],
        ];
    } else {
        // AUTRES TYPES : RSVP simple (Présent / Peut-être / Absent / Me désinscrire).
        $components = [
            ['type' => 1, 'components' => [
                ['type' => 2, 'style' => 3, 'label' => 'Présent',        'emoji' => ['name' => '✅'], 'custom_id' => "present:{$sid}"],
                ['type' => 2, 'style' => 1, 'label' => 'Peut-être',      'emoji' => ['name' => '❓'], 'custom_id' => "maybe:{$sid}"],
                ['type' => 2, 'style' => 4, 'label' => 'Absent',         'emoji' => ['name' => '✖️'], 'custom_id' => "absent:{$sid}"],
                ['type' => 2, 'style' => 2, 'label' => 'Me désinscrire', 'custom_id' => "unsignup:{$sid}"],
            ]],
        ];
    }

    // Rangée gestion : Modifier / Supprimer (boutons visibles par tous, mais
    // n'agissent QUE pour le créateur — Discord ne sait pas masquer par utilisateur).
    $components[] = ['type' => 1, 'components' => [
        ['type' => 2, 'style' => 2, 'label' => 'Modifier',  'emoji' => ['name' => '✏️'], 'custom_id' => "edit:{$sid}"],
        ['type' => 2, 'style' => 4, 'label' => 'Supprimer', 'emoji' => ['name' => '🗑️'], 'custom_id' => "del:{$sid}"],
    ]];

    return ['embeds' => [$embed], 'components' => $components];
}


// ============================================================
//  OUTILS
// ============================================================

// Réponse message simple. $ephemeral = visible du seul cliqueur.
function respond_message($text, $ephemeral = false) {
    $data = ['content' => $text];
    if ($ephemeral) $data['flags'] = 64;
    echo json_encode(['type' => 4, 'data' => $data]);
    exit;
}

// Erreur "heure manquante" — embed rouge avec le détail du problème + récap de ce qui avait
// été saisi (Discord ne permet pas de rouvrir le formulaire pré-rempli après une soumission
// de modal, donc on facilite au moins le copier-coller dans un nouveau /sortie creer).
function respond_missing_heure($v) {
    $val = fn($k) => trim((string)($v[$k] ?? '')) !== '' ? trim((string)$v[$k]) : '—';
    $data = ['flags' => 64, 'embeds' => [[
        'title'       => '⚠ Heure de début illisible',
        'description' => "Le champ **Heure de début** n'a pas pu être interprété.\nFormats acceptés : `21:00` · `21h30` · `07:05` · `2130`\n\nRelance `/sortie creer` — voici ce que tu avais saisi, pour copier-coller :",
        'color'       => hexdec('E74C3C'),
        'fields'      => [
            ['name' => 'Titre',       'value' => $val('titre'), 'inline' => true],
            ['name' => 'Jour',        'value' => $val('jour'),  'inline' => true],
            ['name' => 'Heure tapée', 'value' => $val('heure'), 'inline' => true],
            ['name' => 'Consignes',   'value' => $val('desc'),  'inline' => false],
        ],
    ]]];
    echo json_encode(['type' => 4, 'data' => $data]);
    exit;
}

// Met à jour le message du composant (type 7) — transforme l'éphémère de confirmation en résultat.
function respond_update($text) {
    echo json_encode(['type' => 7, 'data' => ['content' => $text, 'components' => []]]);
    exit;
}

// Extrait les champs d'un modal soumis en tableau id => valeur.
//
// ⚠ Deux structures cohabitent, d'où le parcours récursif :
//   - LABEL (type 18)      → le champ réel est dans `component`, AU SINGULIER ;
//   - ACTION_ROW (type 1)  → ancienne structure, dans `components`. Toujours
//     nécessaire : un modal ouvert avant le déploiement et soumis après arrive
//     encore sous cette forme.
// Et deux façons de porter la valeur : une liste ou un radio renvoient `values`
// (TABLEAU), un champ texte renvoie `value`. Lire seulement `value` renverrait
// des jour/heure/durée vides, donc une sortie créée sans date.
function modal_values($body) {
    $out  = [];
    $walk = function ($c) use (&$out, &$walk) {
        if (!is_array($c)) return;
        if (isset($c['component'])) { $walk($c['component']); return; }
        if (isset($c['components']) && is_array($c['components'])) {
            foreach ($c['components'] as $x) $walk($x);
            return;
        }
        $id = (string)($c['custom_id'] ?? '');
        if ($id === '') return;
        if (isset($c['values']))     $out[$id] = (string)($c['values'][0] ?? '');
        elseif (isset($c['value']))  $out[$id] = (string)$c['value'];
    };
    foreach ($body['data']['components'] ?? [] as $c) $walk($c);
    return $out;
}

// Identité du cliqueur (en serveur : member.user ; en MP : user).
function interaction_user($body) {
    $u = $body['member']['user'] ?? ($body['user'] ?? []);
    $name = trim($u['global_name'] ?? '') ?: trim($u['username'] ?? '') ?: 'Inconnu';
    return ['id' => $u['id'] ?? '', 'name' => $name];
}

// Parse "25-06-2026 21:00" (et variantes) → [Y-m-d, H:i]. Tolérant.
function parse_when($s) {
    $s = trim($s);
    if ($s === '') return ['', ''];
    foreach (['d-m-Y H:i', 'd/m/Y H:i', 'Y-m-d H:i', 'd-m-Y', 'd/m/Y', 'Y-m-d'] as $fmt) {
        $dt = DateTime::createFromFormat($fmt, $s);
        if ($dt instanceof DateTime) {
            $heure = (strpos($fmt, 'H:i') !== false) ? $dt->format('H:i') : '';
            return [$dt->format('Y-m-d'), $heure];
        }
    }
    $ts = strtotime($s);
    if ($ts) return [date('Y-m-d', $ts), date('H:i', $ts)];
    return [$s, '']; // illisible : on garde le texte brut en "date"
}

// Acquiert un verrou exclusif en NON bloquant, avec quelques retries courts, plutôt qu'un
// flock() classique qui peut bloquer indéfiniment si un autre process tient le verrou trop
// longtemps. Discord n'attend que ~3s la réponse à une interaction : mieux vaut échouer vite
// et proprement (loggable) que de laisser la requête pendre jusqu'au générique "Une erreur
// s'est produite. Réessaie." sans la moindre trace côté serveur.
function try_lock($fp, $maxWaitSeconds = 1.5) {
    $deadline = microtime(true) + $maxWaitSeconds;
    do {
        if (flock($fp, LOCK_EX | LOCK_NB)) return true;
        usleep(50000); // 50ms
    } while (microtime(true) < $deadline);
    return false;
}

// --- Stockage partagé avec data-api.php (même fichier, même verrou) ---
function data_file() {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/debriefs.json';
}
function read_data(): array {
    $f = data_file();
    if (!file_exists($f)) return ['soiree_active' => null, 'sorties' => []];
    return json_decode(file_get_contents($f), true) ?? ['soiree_active' => null, 'sorties' => []];
}
function write_data(array $data): bool {
    $fp = @fopen(data_file(), 'c+');
    if (!$fp) { dlog('write_data: ouverture impossible (droits ?)'); return false; }
    if (!try_lock($fp)) { dlog('write_data: verrou non acquis (fichier occupé par un autre process)'); fclose($fp); return false; }
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

// --- Store séparé des sorties NON-épice : ne touche pas au débrief ---
function dstore_file() {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/discord_sorties.json';
}
function read_dstore(): array {
    $f = dstore_file();
    if (!file_exists($f)) return ['sorties' => []];
    return json_decode(file_get_contents($f), true) ?? ['sorties' => []];
}
function write_dstore(array $data): bool {
    $fp = @fopen(dstore_file(), 'c+');
    if (!$fp) { dlog('write_dstore: ouverture impossible (droits ?)'); return false; }
    if (!try_lock($fp)) { dlog('write_dstore: verrou non acquis (fichier occupé par un autre process)'); fclose($fp); return false; }
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}
