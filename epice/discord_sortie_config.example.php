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

    // Salon VOCAL où le relevé de présence compte les points (epice/rally_presence.php,
    // cron toutes les 30 min). Clic droit sur le salon vocal → Copier l'identifiant.
    // ⚠ `guild_id` ci-dessus devient OBLIGATOIRE dès que ce relevé tourne : il était
    //   facultatif tant qu'il ne servait qu'à enregistrer la commande instantanément.
    // ⚠ Le bot doit pouvoir VOIR et REJOINDRE ce salon : Discord exige la permission de
    //   connexion pour lire l'état vocal d'un autre membre.
    // ⚠ Pour compter aussi les VISITEURS (présents en vocal mais non inscrits à la sortie),
    //   l'intent privilégié « Server Members » doit être activé dans le portail développeur.
    //   Sans lui, seuls les inscrits sont vus — le script le journalise, il ne fait pas semblant.
    // Vide = aucun relevé de présence (le cron sort sans rien faire).
    'rally_voice_channel_id' => '', // ex : '1518329489862557919'

    // Serveur où se trouve CE salon vocal, si ce n'est pas celui de `guild_id`.
    // Cas d'usage : relever les présences sur la vraie guilde tout en publiant sur un
    // serveur de test. On ne détourne pas `guild_id` pour ça — il sert aussi à
    // enregistrer les commandes /sortie, et le changer les poserait sur le mauvais
    // serveur. Le bot doit évidemment être MEMBRE des deux.
    // Vide = on utilise `guild_id`.
    'rally_guild_id' => '',

    // Salon où le bot postera les demandes de fabrication (skills.html → tab Commandes).
    // Renseigné = le site poste via le BOT (encart + boutons ✋/✅/↩️/🗑️ interactifs).
    // Vide      = fallback sur l'ancien webhook (discord_webhook.txt), sans boutons.
    // Clic droit sur le salon → Copier l'identifiant (mode dev activé).
    'commandes_channel_id' => '', // ex : '1518329489862557919'

    // Salon où le site publie le PARTAGE DE LA RÉCOLTE (bouton « Publier sur Discord »
    // de l'onglet Assignation). À mettre sur un salon de discussion, pas sur celui des
    // commandes du bot : c'est une annonce que les joueurs relisent, pas une interaction.
    // Vide = repli sur le salon où la sortie a été créée.
    'partage_channel_id' => '', // ex : le salon « activités-discussion »

    // Salon où la page Tournois PvP (epice/tournois.html) annonce le lancement d'un
    // tournoi et publie ses vainqueurs. Vide = repli sur `partage_channel_id`, puis
    // sur le salon de la sortie Discord rattachée au tournoi.
    // Le bot y a besoin de « Voir le salon », « Envoyer des messages » et « Intégrer des liens ».
    'tournoi_channel_id' => '',

    // Serveur dont la page Tournois propose les MEMBRES à l'ajout d'un joueur.
    // Vide (cas de la PRODUCTION) = la vraie guilde, lue dans discord_oauth_config.php.
    // À renseigner sur /v2 : le bot de test n'est pas sur la vraie guilde, Discord
    // répondrait 404 « Unknown Guild ». Mettre l'identifiant du Discord de test.
    // ⚠ Ne pas toucher au guild_id de discord_oauth_config.php pour ça : la connexion
    //   au site vérifie l'appartenance des membres sur ce serveur-là.
    // Le bot doit avoir l'intent « Server Members » (portail développeur → Bot).
    'membres_guild_id' => '',

    // Qui prévenir quand le RELEVÉ DE PRÉSENCE tombe en panne pendant une sortie.
    // En message PRIVÉ, et à une seule personne : les autres ne peuvent rien y faire, et
    // une alerte technique dans un salon de guilde n'y produit que du bruit.
    // Une alerte par panne, pas une par passage — un rappel toutes les 30 minutes serait
    // ignoré aussi sûrement qu'un fichier journal.
    // Mode dev → clic droit sur ton pseudo → Copier l'identifiant.
    // Vérifier une fois posé :  php epice/rally_presence.php --alerte-test
    // Vide = aucune alerte (la panne reste dans data/rally_presence.log).
    'alerte_user_id' => '', // ex : '289122662817726465'

    // URL de base du site (sans slash final), pour les liens envoyés depuis Discord
    // (éphémère de /commande creer → "Ajouter des captures"). Utile pour distinguer
    // prod (racine) et dev (/v2). Vide = fallback sur https://havresgris.ddns.net.
    'site_url' => '', // ex prod : 'https://havresgris.ddns.net' — dev : 'https://havresgris.ddns.net/v2'

    // Bannière par DÉFAUT (image pleine largeur en bas de l'encart). URL publique HTTPS.
    // Utilisée si aucune bannière spécifique n'est définie pour le type ci-dessous.
    // Laisser vide pour ne pas afficher d'image.
    // ⚠ URL ABSOLUE obligatoire (Discord récupère l'image depuis ses serveurs ; pas de chemin relatif possible).
    'banner_url' => '', // ex : 'https://havresgris.ddns.net/epice/img/sortie.jpg'

    // Bannière par TYPE de sortie (prioritaire sur banner_url).
    // Les clés sont les identifiants de SORTIE_TYPES dans discord_sortie.php (34 activités
    // depuis le classement à trois niveaux) — inutile de toutes les lister : un type absent
    // de ce tableau retombe simplement sur banner_url. Ci-dessous, les historiques.
    // Dépose tes images sur le serveur (ex: epice/img/) et mets leurs URL HTTPS absolues.
    'banners' => [
        'epice'     => '', // ex : 'https://havresgris.ddns.net/epice/img/epice.jpg'
        'labo'      => '',
        'farm'      => '',
        'landsraad' => '',
        'pvp_train' => '',  // reprise aussi par les 3 entraînements par niveau (pvp_train_deb/_int/_vet) s'ils n'ont pas la leur
        'pvp_hunt'  => '',
        'base_dd'   => '',
        'guilde'    => '',
        'course_dd' => '', // ex : 'https://havresgris.ddns.net/epice/img/sortiecoursedd.jpg'
    ],
];
