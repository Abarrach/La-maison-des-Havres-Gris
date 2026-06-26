<?php
// ============================================================
//  GABARIT de configuration — Connexion via Discord (OAuth2)
//
//  → Copier ce fichier en  discord_oauth_config.php  (GITIGNORÉ,
//    comme discord_webhook.txt) sur le serveur, et renseigner
//    le client_secret + guild_id + admin_role_ids.
//
//  On RÉUTILISE la même application Discord que le bot Sorties
//  (epice/discord_sortie_config.php) :
//    - client_id  = app_id  (PUBLIC)
//    - bot_token  = même token (SECRET) — sert à vérifier
//                   l'appartenance à la guilde côté serveur.
//  Le client_secret est NOUVEAU (portail Discord → OAuth2 →
//  « Reset Secret ») : SECRET, ne JAMAIS commiter.
//
//  Côté portail Discord (OAuth2 → Redirects), il faut AJOUTER
//  l'URL de redirection ci-dessous à l'identique.
// ============================================================

return [
    // --- Application Discord (réutilise le bot Sorties) ---
    'client_id'     => '1518337529261068319',          // = app_id (public)
    'client_secret' => 'COLLE_TON_CLIENT_SECRET_ICI',  // SECRET (OAuth2 → Reset Secret)
    'bot_token'     => 'COLLE_TON_BOT_TOKEN_ICI',       // même token que le bot Sorties (SECRET)

    // --- Redirection OAuth (doit être déclarée à l'identique dans le portail) ---
    // ⚠ ENV DE TEST /v2/ : on déploie d'abord sous /v2/. Pour la mise en
    //   RACINE finale, enlever « v2/ » ici ET dans le portail Discord.
    'redirect_uri'  => 'https://havresgris.ddns.net/v2/discord_callback.php',

    // --- Guilde (serveur Discord de la guilde) ---
    'guild_id'      => '1470057863257919663',  // Maison des Havres Gris

    // --- Rôles Discord qui donnent le DROIT D'ACCÈS au site ---
    // Filtre l'accès au portail par catégorie (rôle Discord).
    //   - VIDE  → tout membre présent sur le serveur Discord a accès.
    //   - DÉFINI→ il faut porter au moins UN de ces rôles. Les autres
    //             (invités, membres d'un autre jeu avec un label différent…)
    //             sont REFUSÉS, et éjectés s'ils perdent le rôle.
    // (mode dev → Paramètres du serveur → Rôles → clic droit → Copier l'identifiant)
    'access_role_ids' => [
        '1470134253164429591', // rôle « Dune »
        '1470276608710410272', // rôle « Dune Pause »
    ],

    // --- Rôles Discord qui donnent l'accès ADMIN du site ---
    // Liste d'IDs de rôles. Un membre portant l'un de ces rôles est admin.
    // (un rôle admin donne aussi automatiquement l'accès au site.)
    'admin_role_ids' => [
        '1470057863257919665', // rôle « Admins »
        '1470088471631626578', // rôle « Modos »
    ],

    // --- Sécurité session : intervalle de revérification d'appartenance (secondes) ---
    // À chaque navigation, si la dernière vérif Discord est plus vieille que ce délai,
    // le serveur re-interroge l'API. Si le membre a quitté la guilde → session détruite.
    'recheck_seconds' => 900, // 15 min
];
