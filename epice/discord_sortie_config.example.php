<?php
// ============================================================
//  GABARIT de configuration du bot "Sorties" (endpoint Discord)
//
//  → Copier ce fichier en  discord_sortie_config.php  (GITIGNORÉ)
//    à côté, sur le serveur, et renseigner le BOT_TOKEN.
//
//  app_id / public_key : PUBLICS (visibles dans le portail Discord),
//                        pas de secret, OK de les versionner.
//  bot_token           : SECRET — ne JAMAIS commiter, comme un mot de passe.
//  guild_id            : (optionnel) ID du serveur de test → enregistrement
//                        INSTANTANÉ de la commande. Vide = commande globale
//                        (propagation jusqu'à ~1h).
// ============================================================

return [
    'app_id'     => '1518337529261068319',
    'public_key' => '45786ddfdd7d276e226e57fc7fe285d720c665eee47d4eda731d3ada8b8c8496',
    'bot_token'  => 'COLLE_TON_BOT_TOKEN_ICI',
    'guild_id'   => '', // ex : '123456789012345678' (Mode dev → clic droit serveur → Copier l'identifiant)

    // Salon où le bot postera les demandes de fabrication (skills.html → tab Commandes).
    // Renseigné = le site poste via le BOT (encart + boutons ✋/✅/↩️/🗑️ interactifs).
    // Vide      = fallback sur l'ancien webhook (discord_webhook.txt), sans boutons.
    // Clic droit sur le salon → Copier l'identifiant (mode dev activé).
    'commandes_channel_id' => '', // ex : '1518329489862557919'

    // URL de base du site (sans slash final), pour les liens envoyés depuis Discord
    // (éphémère de /commande creer → "Ajouter des captures"). Utile pour distinguer
    // prod (racine) et dev (/v2). Vide = fallback sur https://havresgris.ddns.net.
    'site_url' => '', // ex prod : 'https://havresgris.ddns.net' — dev : 'https://havresgris.ddns.net/v2'

    // Bannière par DÉFAUT (image pleine largeur en bas de l'encart). URL publique HTTPS.
    // Utilisée si aucune bannière spécifique n'est définie pour le type ci-dessous.
    // Laisser vide pour ne pas afficher d'image.
    // ⚠ URL ABSOLUE obligatoire (Discord récupère l'image depuis ses serveurs ; pas de chemin relatif possible).
    'banner_url' => '', // ex : 'https://havresgris.ddns.net/epice/img/sortie.jpg'

    // Bannière par TYPE de sortie (prioritaire sur banner_url). Clés : epice / labo / farm / landsraad / pvp_train / pvp_hunt / base_dd / guilde.
    // Dépose tes images sur le serveur (ex: epice/img/) et mets leurs URL HTTPS absolues.
    'banners' => [
        'epice'     => '', // ex : 'https://havresgris.ddns.net/epice/img/epice.jpg'
        'labo'      => '',
        'farm'      => '',
        'landsraad' => '',
        'pvp_train' => '',
        'pvp_hunt'  => '',
        'base_dd'   => '',
        'guilde'    => '',
    ],
];
