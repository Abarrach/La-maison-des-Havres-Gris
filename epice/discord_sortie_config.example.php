<?php
// ============================================================
//  Configuration du bot Discord du site (sorties, commandes, tournois, BD,
//  carte Deep Desert). Un seul bot pour tout.
//
//  → Copier ce gabarit en  epice/discord_sortie_config.php  sur le serveur
//    (fichier GITIGNORÉ : il contient le token du bot) et le remplir.
//
//  Trouver un identifiant (ID) : Discord → Paramètres → Avancés → Mode
//  développeur activé, puis clic droit sur le serveur / salon / pseudo →
//  « Copier l'identifiant ».
//  Les droits du bot dans CHAQUE salon où il poste : « Voir le salon »,
//  « Envoyer des messages », « Intégrer des liens ».
// ============================================================

return [

    // ---- 1. L'application Discord (portail développeur → ton application) ----
    'app_id'     => '',  // « Application ID » (General Information) — public
    'public_key' => '',  // « Public Key » (General Information) — public, vérifie que les clics viennent bien de Discord
    'bot_token'  => 'COLLE_TON_BOT_TOKEN_ICI',  // onglet Bot → token. SECRET : comme un mot de passe, ne jamais le partager

    // ---- 2. Le serveur Discord et le site ----
    // Serveur de la guilde. Sert à enregistrer les commandes /sortie, /commande, /plan,
    // /carte (instantané ; vide = global, jusqu'à 1 h) et au relevé de présence.
    'guild_id' => '',
    // Adresse publique du site, sans « / » final. Les images envoyées à Discord sont
    // cherchées ici. Prod : https://havresgris.ddns.net — test : …/v2
    'site_url' => 'https://havresgris.ddns.net',

    // ---- 3. Les salons où le bot poste ----
    'commandes_channel_id' => '',  // demandes de fabrication (page Commandes) — vide = ancien webhook, sans boutons
    'partage_channel_id'   => '',  // partage de la récolte d'une sortie + repli des tournois et de la BD
    'tournoi_channel_id'   => '',  // tournois PvP : lancement et vainqueurs — vide = partage_channel_id
    'stories_channel_id'   => '',  // Havres Gris Stories : chaque BD / flash publiée — vide = partage_channel_id
    'dd_channel_id'        => '',  // carte Deep Desert de la semaine (bouton de la carte, /carte) — pas de repli

    // ---- 4. Relevé de présence des rallys (cron epice/rally_presence.php) ----
    'rally_voice_channel_id' => '',  // salon VOCAL où l'on compte les présents — vide = pas de relevé
    'rally_guild_id'         => '',  // serveur de ce salon, seulement s'il diffère de guild_id

    // ---- Alertes en MP (crons qui tombent en panne) ----
    // Qui reçoit un MP quand un cron échoue : relevé de présence des rallys ET carte Deep
    // Desert de la semaine (dd_map_update.php : tuiles manquantes ou remplacées, la carte
    // précédente est gardée). Une alerte par cause et par jour. Vide = pas d'alerte.
    // Tester : php epice/rally_presence.php --alerte-test
    //          php dd_map_update.php --alerte-test
    'alerte_user_id'         => '',  // ton ID Discord

    // ---- 5. Tournois PvP ----
    // Serveur dont les membres sont proposés à l'ajout d'un joueur. Vide en prod (vraie
    // guilde) ; à remplir sur /v2 avec le Discord de test. Intent « Server Members » requis.
    'membres_guild_id' => '',

    // ---- 6. Bannières des annonces de sortie (images HTTPS, déposées dans epice/img/) ----
    // Une image par type d'activité. Clés = identifiants des types (catalogue en tête
    // de epice/discord_sortie.php). Ordre de choix : type → activité parente → image
    // livrée avec le code → 'guilde' → banner_url → epice/img/sortie.jpg.
    'banners' => [
        'epice'     => '',  // sortie épice
        'labo'      => '',  // labos / stations de test
        'farm'      => '',  // farm dans Hagga
        'landsraad' => '',  // Landsraad
        'pvp_train' => '',  // entraînements PvP (les 3 niveaux)
        'pvp_hunt'  => '',  // chasse PvP
        'base_dd'   => '',  // base avancée Deep Desert
        'course_dd' => '',  // course Deep Desert
        'guilde'    => '',  // activité de guilde diverse — sert aussi d'image par défaut
    ],
    'banner_url' => '',  // dernier repli si rien d'autre n'est trouvé
];
