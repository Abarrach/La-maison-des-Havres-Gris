<?php
// ============================================================
//  HELPER DISCORD — envoi / édition / suppression des messages
//  de demande de fabrication (skills.html → tab Commandes).
//  Utilisé par save.php.
//
//  Deux modes possibles, choisis automatiquement :
//
//   1) MODE BOT (préféré, actif si epice/discord_sortie_config.php
//      contient bot_token + commandes_channel_id) : le bot poste
//      l'encart lui-même via l'API REST de Discord. Il peut alors
//      porter des BOUTONS interactifs (✋ prise en charge, ✅ terminé,
//      ↩️ libérer, 🗑️ retirer) — c'est ce qui permet le suivi côté
//      Discord (les webhooks entrants n'ont pas droit aux composants).
//
//   2) MODE WEBHOOK (fallback historique) : URL secrète lue dans
//      discord_webhook.txt (gitignoré). Pas de boutons.
//
//  Chaque demande enregistre 'discordMsgVia' = 'bot' ou 'webhook'
//  pour router correctement les édits ultérieurs (un message posté
//  par le webhook DOIT être édité via le webhook, et inversement).
//
//  Toutes les fonctions sont silencieuses : si Discord n'est pas
//  configuré, le site continue à fonctionner normalement.
// ============================================================

// URL publique du site (pour le lien dans le message Discord — utilisée quand
// le formulaire de création n'a pas fourni de siteUrl personnalisée).
if (!defined('DUNE_SITE_URL')) {
    define('DUNE_SITE_URL', 'https://havresgris.ddns.net/skills.html?tab=requetes');
}

/**
 * Base URL publique du site (sans slash final) pour construire les URLs
 * d'images que Discord viendra hotlinker (évite le double affichage
 * grand-plan + vignette qu'on avait avec l'upload multipart).
 * Config : 'site_url' dans epice/discord_sortie_config.php. Fallback : prod.
 */
function dune_site_base_url() {
    static $cache = null;
    if ($cache !== null) return $cache;
    $cfgPath = __DIR__ . '/epice/discord_sortie_config.php';
    $u = '';
    if (file_exists($cfgPath)) {
        $c = @include $cfgPath;
        if (is_array($c)) $u = trim((string)($c['site_url'] ?? ''));
    }
    if ($u === '') $u = 'https://havresgris.ddns.net';
    return $cache = rtrim($u, '/');
}

/**
 * Convertit un chemin relatif d'image (ex: "uploads/img_xxx.png") en URL
 * publique absolue (ex: "https://havresgris.ddns.net/v2/uploads/img_xxx.png").
 * Renvoie chaîne vide si l'entrée est vide.
 */
function dune_image_absolute_url($relPath) {
    $p = trim((string)$relPath);
    if ($p === '') return '';
    if (preg_match('#^https?://#i', $p)) return $p; // déjà absolue
    return dune_site_base_url() . '/' . ltrim($p, '/');
}

// ============================================================
//  CONFIGURATION MODE BOT
// ============================================================

/**
 * Charge (une fois) la config du bot depuis epice/discord_sortie_config.php.
 * Retourne un array [bot_token, channel_id] si tout est renseigné,
 * false sinon (→ fallback webhook).
 */
function discord_bot_config() {
    static $cache = null;
    if ($cache !== null) return $cache;

    $path = __DIR__ . '/epice/discord_sortie_config.php';
    if (!file_exists($path)) return $cache = false;

    $c = @include $path;
    if (!is_array($c)) return $cache = false;

    $token = (string)($c['bot_token'] ?? '');
    $chan  = (string)($c['commandes_channel_id'] ?? '');

    // On considère "non configuré" un token laissé au placeholder ou vide,
    // et un channel_id vide (l'utilisateur peut avoir renseigné le token
    // pour /sortie sans encore avoir activé le mode bot pour les commandes).
    if ($token === '' || strpos($token, 'COLLE_TON') !== false) return $cache = false;
    if ($chan === '') return $cache = false;

    return $cache = ['bot_token' => $token, 'channel_id' => $chan];
}

// ============================================================
//  CONFIGURATION MODE WEBHOOK (fallback)
// ============================================================

/**
 * Lit l'URL du webhook depuis discord_webhook.txt.
 * Retourne la 1re ligne valide ou null si non configuré.
 */
function discord_get_webhook_url() {
    $path = __DIR__ . '/discord_webhook.txt';
    if (!file_exists($path)) return null;

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!$lines) return null;

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (strpos($line, 'REMPLACE_PAR_TON_URL') !== false) continue;
        if (strpos($line, 'https://discord.com/api/webhooks/') === 0) return $line;
    }
    return null;
}

// ============================================================
//  RENDU — EMBED + COMPOSANTS
// ============================================================

/**
 * Embed principal : bordure DORÉE (pending) ou VERTE (progress).
 * $imageUrl doit être une URL PUBLIQUE ABSOLUE (Discord la fetch depuis son CDN
 * pour l'afficher en vignette top-right). Passer '' pour ne pas afficher de vignette.
 * $extraImagesCount = nombre d'IMAGES EN PLUS de la vignette : si >0, on ajoute
 * une mention "📸 +N sur le site" pour inciter à cliquer (Discord n'a pas de
 * vraie galerie compacte — cf. discord_build_all_embeds).
 * Utiliser dune_image_absolute_url() pour convertir un chemin relatif comme
 * "uploads/img_xxx.png" en URL absolue.
 */
function discord_build_embed($req, $siteUrl = '', $imageUrl = '', $extraImagesCount = 0) {
    $player = $req['player'] ?? '?';
    $type   = $req['type']   ?? '';
    $notes  = trim($req['notes'] ?? '');

    $url = (preg_match('#^https?://#i', $siteUrl)) ? $siteUrl : DUNE_SITE_URL;

    $crafter = trim($req['crafterAssigned'] ?? '');
    $status  = $req['status'] ?? '';
    $isTaken = ($crafter !== '' && $status === 'progress');

    $color = $isTaken ? hexdec('41D37A') : hexdec('D4A23B');
    $title = $isTaken
        ? "✅ Demande prise en charge"
        : "🛠️ Nouvelle demande de fabrication";

    $desc = "";
    if ($isTaken) $desc .= "## ✅ Pris en charge par **{$crafter}**\n\n";
    $desc .= "👤 **{$player}**\n";
    $desc .= "⚙️ **{$type}**";
    if ($notes !== '') $desc .= "\n📝 \"{$notes}\"";
    if ($extraImagesCount > 0) {
        $plural = $extraImagesCount > 1 ? 's' : '';
        $desc .= "\n📸 *+{$extraImagesCount} autre{$plural} capture{$plural} sur le site*";
    }
    $desc .= "\n\n👉 [Ouvrir la demande sur le site]({$url})";

    $embed = ['title' => $title, 'description' => $desc, 'color' => $color];
    if ($imageUrl !== '') $embed['thumbnail'] = ['url' => $imageUrl];
    return $embed;
}

/**
 * Extrait l'URL absolue de la 1re image d'une demande, ou '' si aucune.
 * Factorise la logique utilisée par post et edit.
 */
function discord_first_image_url($req) {
    $imgs = discord_collect_images($req);
    return $imgs ? dune_image_absolute_url($imgs[0]) : '';
}

/**
 * Construit le tableau d'embeds pour une demande. Toujours UN seul embed :
 *   - 0 image   → embed sans vignette
 *   - 1 image   → embed + vignette top-right
 *   - 2+ images → embed + vignette de la 1re + mention "📸 +N sur le site"
 *                 pour les suivantes (Discord n'a pas de vraie galerie compacte,
 *                 cf. testé le 2026-07-28 — les embeds thumbnail seuls sont
 *                 silencieusement ignorés ; les embeds `image` sont trop gros ;
 *                 la solution "mention + click-to-site" respecte la doctrine
 *                 "salon commandes = teaser, détail sur le site").
 */
function discord_build_all_embeds($req, $siteUrl) {
    $imgs       = discord_collect_images($req);
    $imageUrl   = $imgs ? dune_image_absolute_url($imgs[0]) : '';
    $extraCount = max(0, count($imgs) - 1);
    return [discord_build_embed($req, $siteUrl, $imageUrl, $extraCount)];
}

/**
 * Boutons associés à l'état de la demande.
 *   - pending  → [✋ Je prends en charge] [🗑️ Retirer]
 *   - progress → [✅ Terminé] [↩️ Libérer] [🗑️ Retirer]
 *   - done     → aucun (l'embed est remplacé par le remerciement)
 *
 * Utilisés UNIQUEMENT en mode bot (les webhooks entrants n'ont pas droit
 * aux composants). Les custom_id sont préfixés 'cmd_' pour être routés
 * vers le handler /commande par discord_interactions.php.
 */
function discord_build_components($req) {
    $id     = (string)($req['id'] ?? '');
    $status = $req['status'] ?? 'pending';
    if ($id === '') return [];

    if ($status === 'pending') {
        return [['type' => 1, 'components' => [
            ['type' => 2, 'style' => 1, 'label' => 'Je prends en charge', 'emoji' => ['name' => '✋'], 'custom_id' => "cmd_take:{$id}"],
            ['type' => 2, 'style' => 4, 'label' => 'Retirer',             'emoji' => ['name' => '🗑️'], 'custom_id' => "cmd_delete:{$id}"],
        ]]];
    }
    if ($status === 'progress') {
        return [['type' => 1, 'components' => [
            ['type' => 2, 'style' => 3, 'label' => 'Terminé',  'emoji' => ['name' => '✅'], 'custom_id' => "cmd_done:{$id}"],
            ['type' => 2, 'style' => 2, 'label' => 'Libérer',  'emoji' => ['name' => '↩️'], 'custom_id' => "cmd_release:{$id}"],
            ['type' => 2, 'style' => 4, 'label' => 'Retirer',  'emoji' => ['name' => '🗑️'], 'custom_id' => "cmd_delete:{$id}"],
        ]]];
    }
    return []; // done
}

/**
 * Embed « remerciement » compact (violet honneur), affiché quand la demande est terminée.
 */
function discord_build_thanks_embed($req) {
    $player  = $req['player'] ?? '?';
    $type    = trim($req['type'] ?? '');
    $crafter = trim($req['crafterAssigned'] ?? '');
    $thanked = $crafter !== '' ? $crafter : $player;

    $desc  = "### 🙏 Merci à **{$thanked}** !\n";
    $desc .= "⚙️ **{$type}** · 👤 **{$player}**\n";
    $desc .= "*✨ Travail réalisé*";

    return ['description' => $desc, 'color' => hexdec('9B59B6')];
}

/**
 * Liste des chemins d'images d'une demande (max 4).
 */
function discord_collect_images($req) {
    if (!empty($req['images']) && is_array($req['images'])) return array_slice($req['images'], 0, 4);
    if (!empty($req['image']))                              return [$req['image']];
    return [];
}

// ============================================================
//  ENVOI DE MESSAGE (POST) — bot en priorité, webhook en fallback
// ============================================================

/**
 * Poste une demande sur Discord.
 *
 * Retourne un array ['id' => string, 'via' => 'bot'|'webhook'] en cas de succès,
 * null en cas d'échec. save.php stocke les deux champs dans requetes.json pour
 * pouvoir router correctement les édits/suppressions ultérieures.
 *
 * (Rétrocompat : les anciennes entrées de requetes.json sans champ 'discordMsgVia'
 *  sont traitées comme 'webhook' par les fonctions d'édition ci-dessous.)
 */
function discord_post_request($req, $siteUrl = '') {
    $GLOBALS['discord_last_error'] = null;

    $cfg = discord_bot_config();
    if ($cfg) {
        $id = discord_bot_post($cfg, $req, $siteUrl);
        if ($id !== null) return ['id' => $id, 'via' => 'bot'];
        // Erreur bot : on log mais on NE tente PAS de fallback silencieux vers
        // webhook — on veut voir l'erreur pour la corriger. Le mode bot est le
        // mode "activé", il doit marcher (ou être désactivé en vidant commandes_channel_id).
        return null;
    }

    $id = discord_webhook_post($req, $siteUrl);
    return $id !== null ? ['id' => $id, 'via' => 'webhook'] : null;
}

/**
 * POST via l'API bot : POST /channels/{id}/messages, JSON pur (pas d'upload de fichier).
 * L'image de la vignette est fournie à Discord sous forme d'URL publique
 * (Discord la fetch depuis son CDN → pas de double affichage grand-plan + vignette
 * qu'on avait avec l'upload multipart).
 */
function discord_bot_post($cfg, $req, $siteUrl) {
    if (!function_exists('curl_init')) { $GLOBALS['discord_last_error'] = 'no_curl'; return null; }

    $payload = [
        'embeds'     => discord_build_all_embeds($req, $siteUrl),
        'components' => discord_build_components($req),
    ];

    $url = "https://discord.com/api/v10/channels/{$cfg['channel_id']}/messages";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($resp === false) { $GLOBALS['discord_last_error'] = 'bot_curl_fail: ' . $err; return null; }
    if ($code < 200 || $code >= 300) {
        $GLOBALS['discord_last_error'] = "bot_http_$code: " . substr((string)$resp, 0, 200);
        return null;
    }
    $j = json_decode($resp, true);
    return $j['id'] ?? null;
}

/**
 * POST via le webhook (mode fallback). Pas de composants (interdit par Discord
 * pour les webhooks entrants). Image en URL comme pour le bot (pas d'upload).
 */
function discord_webhook_post($req, $siteUrl) {
    $url = discord_get_webhook_url();
    if (!$url) { $GLOBALS['discord_last_error'] = 'no_webhook (discord_webhook.txt absent/vide/non configuré)'; return null; }
    if (!function_exists('curl_init')) { $GLOBALS['discord_last_error'] = 'no_curl'; return null; }

    $postUrl = $url . (strpos($url, '?') === false ? '?' : '&') . 'wait=true';
    $payload = ['embeds' => discord_build_all_embeds($req, $siteUrl)];

    $ch = curl_init($postUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($resp === false) { $GLOBALS['discord_last_error'] = 'wh_curl_fail: ' . $err; return null; }
    if ($code < 200 || $code >= 300) {
        $GLOBALS['discord_last_error'] = "wh_http_$code: " . substr((string)$resp, 0, 200);
        return null;
    }
    $j = json_decode($resp, true);
    return $j['id'] ?? null;
}

// ============================================================
//  ÉDITION / REMERCIEMENT / SUPPRESSION
//  → routées automatiquement selon 'discordMsgVia' de la demande
//    (webhook par défaut pour les entrées anciennes sans ce champ).
// ============================================================

/**
 * Détermine si l'édition/suppression d'un message doit passer par le bot ou le webhook.
 * Un message posté par le webhook ne peut être édité que par le webhook, et
 * inversement — Discord vérifie l'auteur du message.
 */
function discord_msg_via($req): string {
    return ($req['discordMsgVia'] ?? '') === 'bot' ? 'bot' : 'webhook';
}

/**
 * Édite l'embed d'un message existant (ex: passage doré → vert lors de la prise en charge).
 */
function discord_edit_message($messageId, $req, $siteUrl = '') {
    if (!$messageId) return false;
    return discord_msg_via($req) === 'bot'
        ? discord_bot_edit($messageId, $req, $siteUrl, /*thanks*/ false)
        : discord_webhook_edit($messageId, $req, $siteUrl, /*thanks*/ false);
}

/**
 * Transforme le message en remerciement (embed violet, sans composants ni images).
 */
function discord_complete_message($messageId, $req) {
    if (!$messageId) return false;
    return discord_msg_via($req) === 'bot'
        ? discord_bot_edit($messageId, $req, '', /*thanks*/ true)
        : discord_webhook_edit($messageId, $req, '', /*thanks*/ true);
}

/**
 * Supprime le message Discord.
 */
function discord_delete_message($messageId, $req = null) {
    if (!$messageId) return false;
    // $req est optionnel pour rétrocompat des appels existants dans save.php ;
    // sans lui on assume webhook (comportement historique).
    $via = $req ? discord_msg_via($req) : 'webhook';
    return $via === 'bot'
        ? discord_bot_delete($messageId)
        : discord_webhook_delete($messageId);
}

// ---- Implémentations mode BOT ------------------------------

function discord_bot_edit($messageId, $req, $siteUrl, $thanks) {
    $cfg = discord_bot_config();
    if (!$cfg || !function_exists('curl_init')) return false;

    if ($thanks) {
        // Remerciement : on retire aussi tout ancien attachement (héritage d'anciens
        // messages postés en multipart avant la refonte URL-based).
        $payload = [
            'embeds'      => [discord_build_thanks_embed($req)],
            'components'  => [],
            'attachments' => [],
        ];
    } else {
        // Édition normale — vignette référencée par URL publique (pas d'upload).
        $payload = [
            'embeds'      => discord_build_all_embeds($req, $siteUrl),
            'components'  => discord_build_components($req),
            'attachments' => [], // idem, purge d'éventuels attachements résiduels
        ];
    }

    $url = "https://discord.com/api/v10/channels/{$cfg['channel_id']}/messages/" . rawurlencode($messageId);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code >= 200 && $code < 300) return true;
    @error_log("Discord bot edit échec (HTTP $code) : " . substr((string)$resp, 0, 300));
    return false;
}

function discord_bot_delete($messageId) {
    $cfg = discord_bot_config();
    if (!$cfg || !function_exists('curl_init')) return false;
    $url = "https://discord.com/api/v10/channels/{$cfg['channel_id']}/messages/" . rawurlencode($messageId);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['bot_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code === 204 || $code === 404) return true;
    @error_log("Discord bot delete échec (HTTP $code) : " . substr((string)$resp, 0, 300));
    return false;
}

// ---- Implémentations mode WEBHOOK (fallback) ---------------

function discord_webhook_patch($editUrl, $payloadArr) {
    $ch = curl_init($editUrl);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_POSTFIELDS     => json_encode($payloadArr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => substr((string)$resp, 0, 300)];
}

function discord_webhook_edit($messageId, $req, $siteUrl, $thanks) {
    $url = discord_get_webhook_url();
    if (!$url || !function_exists('curl_init')) return false;

    // Sépare l'éventuelle query string (?thread_id=...) avant d'ajouter /messages/<id>
    $base = $url; $query = '';
    if (($qpos = strpos($url, '?')) !== false) {
        $base  = substr($url, 0, $qpos);
        $query = substr($url, $qpos);
    }
    $editUrl = rtrim($base, '/') . '/messages/' . rawurlencode($messageId) . $query;

    if ($thanks) {
        $embed = discord_build_thanks_embed($req);
        // Certaines conditions refusent `attachments: []` (HTTP 400) → on retente sans.
        $r1 = discord_webhook_patch($editUrl, ['embeds' => [$embed], 'attachments' => []]);
        if ($r1['code'] >= 200 && $r1['code'] < 300) return true;
        $r2 = discord_webhook_patch($editUrl, ['embeds' => [$embed]]);
        if ($r2['code'] >= 200 && $r2['code'] < 300) return true;
        $msg = "Discord webhook thanks échec : essai1 HTTP {$r1['code']} {$r1['body']} || essai2 HTTP {$r2['code']} {$r2['body']}";
        @error_log($msg);
        @file_put_contents(__DIR__ . '/discord_debug.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
        return false;
    }

    // Édition normale : embeds galerie référencés par URL publique (comme pour le bot).
    $r = discord_webhook_patch($editUrl, ['embeds' => discord_build_all_embeds($req, $siteUrl)]);
    if ($r['code'] >= 200 && $r['code'] < 300) return true;
    @error_log("Discord webhook edit échec (HTTP {$r['code']}) : {$r['body']}");
    return false;
}

// ============================================================
//  MP DIRECT — envoyer un message privé à un utilisateur Discord
//  (utilisé par discord_commande.php pour prévenir le demandeur).
//  Silencieux : un utilisateur qui a fermé ses MP → échec journalisé.
// ============================================================

function discord_bot_dm($userId, $content) {
    $cfg = discord_bot_config();
    if (!$cfg || !function_exists('curl_init')) return false;
    $userId = (string)$userId;
    if ($userId === '') return false;

    // 1) Ouvre (ou récupère) le canal MP avec cet utilisateur.
    $ch = curl_init('https://discord.com/api/v10/users/@me/channels');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['recipient_id' => $userId]),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300) { @error_log("discord_bot_dm: dm_channel HTTP $code"); return false; }
    $j = json_decode((string)$resp, true);
    $chanId = (string)($j['id'] ?? '');
    if ($chanId === '') return false;

    // 2) Poste le message dans ce canal.
    $ch = curl_init("https://discord.com/api/v10/channels/{$chanId}/messages");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['content' => $content], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300) { @error_log("discord_bot_dm: msg HTTP $code"); return false; }
    return true;
}

function discord_webhook_delete($messageId) {
    $url = discord_get_webhook_url();
    if (!$url || !function_exists('curl_init')) return false;
    $delUrl = rtrim($url, '/') . '/messages/' . rawurlencode($messageId);
    $ch = curl_init($delUrl);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code === 204 || $code === 404) return true;
    @error_log("Discord webhook delete échec (HTTP $code) : " . substr((string)$resp, 0, 300));
    return false;
}
