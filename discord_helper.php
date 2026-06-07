<?php
// ============================================================
//  HELPER DISCORD — envoi & suppression de messages via webhook
//  Utilisé par save.php pour les Commandes & Services.
//
//  - L'URL secrète du webhook est lue depuis discord_webhook.txt
//    (fichier ignoré par Git, à renseigner sur le serveur).
//  - Si le fichier est absent / vide / non configuré, toutes les
//    fonctions sont des "no-op" : le site continue de fonctionner
//    normalement, sans Discord.
// ============================================================

// URL publique du site (pour le lien dans le message Discord)
if (!defined('DUNE_SITE_URL')) {
    define('DUNE_SITE_URL', 'https://havresgris.ddns.net/skills.html?tab=requetes');
}

/**
 * Lit l'URL du webhook depuis discord_webhook.txt.
 * Retourne la 1re ligne valide commençant par https://discord.com/api/webhooks/
 * ou null si non configuré.
 */
function discord_get_webhook_url() {
    $path = __DIR__ . '/discord_webhook.txt';
    if (!file_exists($path)) return null;

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!$lines) return null;

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;            // commentaire / vide
        if (strpos($line, 'REMPLACE_PAR_TON_URL') !== false) continue; // placeholder
        if (strpos($line, 'https://discord.com/api/webhooks/') === 0) {
            return $line;
        }
    }
    return null;
}

/**
 * Construit l'EMBED Discord à partir d'une demande.
 * - Barre latérale DORÉE quand la demande est en attente
 * - Barre latérale VERTE + bandeau « Pris en charge par … » quand un crafteur la prend
 *
 * @param array  $req            La demande
 * @param string $siteUrl        URL du lien (fournie par le navigateur). Si vide, fallback DUNE_SITE_URL.
 * @param string $imageFilename  Nom de fichier d'une image jointe à afficher en bas de l'embed
 *                               (référence "attachment://..."), vide = pas d'image.
 * @return array  Structure d'embed prête pour l'API Discord.
 */
function discord_build_embed($req, $siteUrl = '', $imageFilename = '') {
    $player = $req['player'] ?? '?';
    $type   = $req['type']   ?? '';
    $notes  = trim($req['notes'] ?? '');

    // On n'accepte que des URLs http(s) valides ; sinon on retombe sur la valeur par défaut.
    $url = (preg_match('#^https?://#i', $siteUrl)) ? $siteUrl : DUNE_SITE_URL;

    $crafter = trim($req['crafterAssigned'] ?? '');
    $status  = $req['status'] ?? '';
    $isTaken = ($crafter !== '' && $status === 'progress');

    // Couleurs : doré (en attente) / vert (pris en charge)
    $color = $isTaken ? hexdec('41D37A') : hexdec('D4A23B');

    // Titre selon l'état
    $title = $isTaken
        ? "✅ Demande prise en charge"
        : "🛠️ Nouvelle demande de fabrication";

    // Corps de l'embed
    $desc = "";
    if ($isTaken) {
        $desc .= "## ✅ Pris en charge par **{$crafter}**\n\n";
    }
    $desc .= "👤 **{$player}**\n";
    $desc .= "⚙️ **{$type}**";
    if ($notes !== '') {
        $desc .= "\n📝 \"{$notes}\"";
    }
    $desc .= "\n\n👉 [Ouvrir la demande sur le site]({$url})";

    $embed = [
        'title'       => $title,
        'description' => $desc,
        'color'       => $color,
    ];

    // VIGNETTE (thumbnail) en haut à droite de l'embed = petite taille, au lieu de
    // l'image pleine largeur (`image`). Demande : n'afficher que des vignettes.
    if ($imageFilename !== '') {
        $embed['thumbnail'] = ['url' => 'attachment://' . $imageFilename];
    }

    return $embed;
}

/**
 * Retourne la liste des chemins d'images d'une demande (max 4).
 */
function discord_collect_images($req) {
    if (!empty($req['images']) && is_array($req['images'])) {
        return array_slice($req['images'], 0, 4);
    }
    if (!empty($req['image'])) {
        return [$req['image']];
    }
    return [];
}

/**
 * Poste une demande sur Discord (texte + captures jointes).
 * Retourne l'ID du message Discord (string) en cas de succès, sinon null.
 *
 * @param array $req  La demande (player, type, notes, images[])
 */
function discord_post_request($req, $siteUrl = '') {
    $GLOBALS['discord_last_error'] = null;

    $url = discord_get_webhook_url();
    if (!$url) { $GLOBALS['discord_last_error'] = 'no_webhook (discord_webhook.txt absent/vide/non configuré)'; return null; }
    if (!function_exists('curl_init')) { $GLOBALS['discord_last_error'] = 'no_curl (extension cURL PHP absente)'; return null; }

    // On ajoute ?wait=true pour que Discord renvoie le message créé (avec son id)
    $postUrl = $url . (strpos($url, '?') === false ? '?' : '&') . 'wait=true';

    // On prépare d'abord les fichiers image à joindre
    $images = discord_collect_images($req);
    $fields = [];
    $firstImageName = '';
    $i = 0;
    foreach ($images as $relPath) {
        if (!$relPath) continue;
        $abs = __DIR__ . '/' . ltrim($relPath, '/');
        if (!is_file($abs)) continue;
        $mime = function_exists('mime_content_type') ? (mime_content_type($abs) ?: 'image/jpeg') : 'image/jpeg';
        $name = basename($abs);
        if ($firstImageName === '') $firstImageName = $name; // 1re image = affichée dans l'embed
        $fields["files[$i]"] = new CURLFile($abs, $mime, $name);
        $i++;
    }

    // La 1re image est intégrée DANS l'embed en VIGNETTE (thumbnail, petite, haut-droite) ;
    // les éventuelles autres restent jointes sous le message.
    $embed   = discord_build_embed($req, $siteUrl, $firstImageName);
    $payload = json_encode(['embeds' => [$embed]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $fields['payload_json'] = $payload;

    $ch = curl_init($postUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $fields,   // multipart/form-data automatique
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp    = curl_exec($ch);
    $code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($resp === false) {
        $GLOBALS['discord_last_error'] = 'curl_fail: ' . $curlErr;
        @error_log("Discord post échec cURL : $curlErr");
        return null;
    }
    if ($code < 200 || $code >= 300) {
        $GLOBALS['discord_last_error'] = "http_$code: " . substr((string)$resp, 0, 200);
        @error_log("Discord post échec (HTTP $code) : " . substr((string)$resp, 0, 300));
        return null;
    }

    $json = json_decode($resp, true);
    return $json['id'] ?? null;
}

/**
 * Édite (réécrit le texte) un message Discord déjà posté par le webhook.
 * Sert à ajouter « Pris en charge par … » quand un crafteur prend la demande.
 * Silencieux : ne bloque jamais le flux principal.
 *
 * @param string $messageId  ID du message Discord
 * @param array  $req        La demande mise à jour (avec crafterAssigned, status)
 * @param string $siteUrl    URL du lien (pour reconstruire le message)
 */
function discord_edit_message($messageId, $req, $siteUrl = '') {
    if (!$messageId) return false;
    $url = discord_get_webhook_url();
    if (!$url) return false;
    if (!function_exists('curl_init')) return false;

    // Sépare l'éventuelle query string (?thread_id=...) avant d'ajouter /messages/<id>
    $base = $url;
    $query = '';
    if (($qpos = strpos($url, '?')) !== false) {
        $base  = substr($url, 0, $qpos);
        $query = substr($url, $qpos); // inclut le '?'
    }
    $editUrl = rtrim($base, '/') . '/messages/' . rawurlencode($messageId) . $query;

    // On réédite l'embed en conservant la même image en bas (les fichiers déjà
    // attachés au message restent présents ; on garde la référence attachment://).
    $images = discord_collect_images($req);
    $firstImageName = '';
    foreach ($images as $relPath) {
        if (!$relPath) continue;
        $firstImageName = basename($relPath);
        break;
    }
    $embed   = discord_build_embed($req, $siteUrl, $firstImageName);
    $payload = json_encode(['embeds' => [$embed]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $ch = curl_init($editUrl);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code >= 200 && $code < 300) return true;
    @error_log("Discord edit échec (HTTP $code) : " . substr((string)$resp, 0, 300));
    return false;
}

/**
 * Construit l'EMBED « remerciement » affiché quand une demande est terminée.
 * Épuré et compact (3 lignes), bordure VIOLETTE « honneur ».
 * Pas d'image ni de note : on ne garde que l'essentiel pour ne pas spammer le salon.
 *
 * @param array $req  La demande terminée (player, type, crafterAssigned)
 * @return array      Structure d'embed prête pour l'API Discord.
 */
function discord_build_thanks_embed($req) {
    $player  = $req['player'] ?? '?';
    $type    = trim($req['type'] ?? '');
    $crafter = trim($req['crafterAssigned'] ?? '');
    $thanked = $crafter !== '' ? $crafter : $player;

    $desc  = "### 🙏 Merci à **{$thanked}** !\n";
    $desc .= "⚙️ **{$type}** · 👤 **{$player}**\n";
    $desc .= "*✨ Travail réalisé*";

    return [
        'description' => $desc,
        'color'       => hexdec('9B59B6'), // violet « honneur »
    ];
}

/**
 * Transforme un message Discord existant en remerciement (demande terminée).
 * On réédite l'embed et on retire les pièces jointes (attachments: []) pour
 * que la capture ne reste pas collée sous le message.
 * Silencieux : ne bloque jamais le flux principal.
 *
 * @param string $messageId  ID du message Discord
 * @param array  $req        La demande terminée
 */
// PATCH JSON d'un message webhook. Retourne ['code'=>int, 'body'=>string].
function discord_patch_json($editUrl, $payloadArr) {
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $ch = curl_init($editUrl);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_POSTFIELDS     => $payload,
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

function discord_complete_message($messageId, $req) {
    if (!$messageId) return false;
    $url = discord_get_webhook_url();
    if (!$url) return false;
    if (!function_exists('curl_init')) return false;

    // Sépare l'éventuelle query string (?thread_id=...) avant d'ajouter /messages/<id>
    $base = $url;
    $query = '';
    if (($qpos = strpos($url, '?')) !== false) {
        $base  = substr($url, 0, $qpos);
        $query = substr($url, $qpos); // inclut le '?'
    }
    $editUrl = rtrim($base, '/') . '/messages/' . rawurlencode($messageId) . $query;

    $embed = discord_build_thanks_embed($req);

    // Essai 1 : remplace l'embed ET retire les captures (attachments vide = message épuré).
    $r1 = discord_patch_json($editUrl, ['embeds' => [$embed], 'attachments' => []]);
    if ($r1['code'] >= 200 && $r1['code'] < 300) return true;

    // REPLI : certaines conditions refusent `attachments: []` (HTTP 400) → on retente SANS ce
    // champ. Le remerciement s'affiche alors (la capture peut rester sous le message) plutôt que
    // de laisser la demande inchangée. (Diagnostic du vrai code d'erreur dans discord_debug.log.)
    $r2 = discord_patch_json($editUrl, ['embeds' => [$embed]]);
    if ($r2['code'] >= 200 && $r2['code'] < 300) return true;

    $msg = "Discord complete (remerciement) échec : essai1 HTTP {$r1['code']} {$r1['body']} || essai2 HTTP {$r2['code']} {$r2['body']}";
    @error_log($msg);
    @file_put_contents(__DIR__ . '/discord_debug.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
    return false;
}

/**
 * Supprime un message Discord précédemment posté par le webhook.
 * Silencieux : ne bloque jamais le flux principal.
 *
 * @param string $messageId  ID du message Discord
 */
function discord_delete_message($messageId) {
    if (!$messageId) return false;
    $url = discord_get_webhook_url();
    if (!$url) return false;
    if (!function_exists('curl_init')) return false;

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

    // 204 = supprimé ; 404 = déjà absent (on considère OK)
    if ($code === 204 || $code === 404) return true;
    @error_log("Discord delete échec (HTTP $code) : " . substr((string)$resp, 0, 300));
    return false;
}
