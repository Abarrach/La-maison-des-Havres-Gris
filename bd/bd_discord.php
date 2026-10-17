<?php
// ============================================================
//  bd_discord.php — annonce Discord d'une histoire publiée
//  (« Havres Gris Stories », inclus par bd_api.php)
//
//  Fonctions seules, aucun effet à l'inclusion : le message peut ainsi être
//  construit et vérifié en ligne de commande sans rien envoyer.
//
//  Décisions de l'utilisateur (2026-10-17) :
//    - une annonce par BD validée ET par flash publiée, UNE SEULE fois par
//      histoire (drapeau `annonce_le` posé par bd_api.php) ;
//    - AUCUN ping : le nom de l'auteur est écrit, sans mention ;
//    - si Discord refuse, l'histoire reste publiée : on rapporte l'erreur.
//
//  Même mécanique que les tournois (epice/tournois-api.php) : bot Sorties,
//  config epice/discord_sortie_config.php. Salon : `stories_channel_id`, sinon
//  `partage_channel_id`. Images passées PAR URL PUBLIQUE (doctrine du dépôt :
//  jamais de multipart, sinon double affichage).
// ============================================================

const BD_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
                 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function bd_date_fr(string $d): string {
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m)) return $d;
    return (int)$m[3] . ' ' . BD_MOIS[(int)$m[2] - 1] . ' ' . $m[1];
}

// Extrait sans mbstring : coupe à $n caractères, sur un mot, avec « … ».
function bd_extrait(string $t, int $n): string {
    $t = trim(preg_replace("/\n{3,}/", "\n\n", str_replace("\r", '', $t)));
    if (!preg_match('/^.{0,' . $n . '}/us', $t, $m) || $m[0] === $t) return $t;
    $cut = preg_replace('/\s+\S*$/u', '', $m[0]);
    return rtrim($cut !== '' ? $cut : $m[0], " ,;:.-—") . '…';
}

/** Config du bot pour les Stories, ou un message d'erreur (string). */
function bd_discord_config() {
    $path = __DIR__ . '/../epice/discord_sortie_config.php';
    if (!file_exists($path)) return 'configuration du bot absente sur le serveur';
    $c = @include $path;
    if (!is_array($c)) return 'configuration du bot illisible';
    $token = trim((string)($c['bot_token'] ?? ''));
    if ($token === '' || strpos($token, 'COLLE_TON') !== false) return "le bot n'a pas de token configuré";
    if (!function_exists('curl_init')) return 'cURL indisponible sur le serveur';
    $chan = trim((string)($c['stories_channel_id'] ?? '')) ?: trim((string)($c['partage_channel_id'] ?? ''));
    if ($chan === '') return 'aucun salon : renseigne `stories_channel_id` dans epice/discord_sortie_config.php';
    $base = rtrim(trim((string)($c['site_url'] ?? '')) ?: 'https://havresgris.ddns.net', '/');
    return ['token' => $token, 'chan' => $chan, 'base' => $base];
}

/**
 * Construit l'embed d'annonce. $a = histoire telle que vue par bd_view() (avec
 * `numero` pour une BD), $base = URL publique du site (prod ou /v2), $lieux = BD_LIEUX.
 */
function bd_annonce_embed(array $a, string $base, array $lieux): array {
    $flash = ($a['type'] ?? '') === 'flash';
    $id    = (string)$a['id'];
    $lien  = $base . '/bd/aventures.html#' . ($flash ? 'flash=' . rawurlencode($id) : 'ep=' . rawurlencode($id) . '&p=1');
    $img   = (string)(($a['pages'][0]['src'] ?? ''));
    $titre = (string)($a['titre'] ?? '');

    $desc = '';
    if (!$flash && !empty($a['sous_titre'])) $desc .= '*' . $a['sous_titre'] . "*\n\n";
    $recit = bd_extrait((string)($a['recit'] ?? ''), $flash ? 500 : 350);
    if ($recit !== '') $desc .= $recit . "\n\n";
    $nb = count($a['pages'] ?? []);
    $desc .= $flash ? '**[→ Voir la flash sur Havres Gris Stories](' . $lien . ')**'
                    : '**[→ Lire les ' . $nb . ' planche' . ($nb > 1 ? 's' : '') . ' sur Havres Gris Stories](' . $lien . ')**';

    $fields = [];
    if (!empty($a['createur'])) $fields[] = ['name' => 'Racontée par', 'value' => (string)$a['createur'], 'inline' => true];
    if (!empty($a['date']))     $fields[] = ['name' => $flash ? 'Le' : 'Soirée du', 'value' => bd_date_fr((string)$a['date']), 'inline' => true];
    if ($flash && !empty($a['lieu']) && isset($lieux[$a['lieu']])) $fields[] = ['name' => 'Lieu', 'value' => $lieux[$a['lieu']], 'inline' => true];
    if (!empty($a['personnages'])) {
        $p = implode(', ', (array)$a['personnages']);
        $fields[] = ['name' => 'Personnages', 'value' => bd_extrait($p, 1000), 'inline' => false];
    }

    // Série : « Le Sable Rose, partie 2 » pour une BD, « Le Sable Rose (coulisses) » pour une flash.
    $serie = '';
    if (!empty($a['serie_nom'])) {
        $serie = $flash ? ' · ' . $a['serie_nom'] . ' (coulisses)'
                        : ' · ' . $a['serie_nom'] . (!empty($a['partie']) ? ', partie ' . $a['partie'] : '');
    }
    $embed = [
        'author'      => ['name' => bd_extrait(($flash ? '⚡ Nouvelle histoire flash' : '📖 Nouvel épisode' . (!empty($a['numero']) ? ' — Épisode ' . $a['numero'] : '')) . $serie, 250)],
        'title'       => bd_extrait($titre, 250),
        'url'         => $lien,
        'description' => bd_extrait($desc, 4000),
        'color'       => $flash ? 0xE08A2B : 0xCDA434,
        'fields'      => $fields,
        'footer'      => ['text' => 'Havres Gris Stories · Maison des Havres Gris'],
    ];
    if ($img !== '') $embed['image'] = ['url' => $base . '/bd/' . ltrim($img, '/')];
    return $embed;
}

/** Poste l'annonce. Renvoie '' si Discord l'a acceptée, sinon le motif lisible. */
function bd_annoncer(array $a, array $lieux): string {
    $cfg = bd_discord_config();
    if (!is_array($cfg)) return $cfg;
    $ch = curl_init('https://discord.com/api/v10/channels/' . $cfg['chan'] . '/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        // Aucune mention ne doit notifier qui que ce soit (décision : pas de ping).
        CURLOPT_POSTFIELDS     => json_encode(['embeds' => [bd_annonce_embed($a, $cfg['base'], $lieux)], 'allowed_mentions' => ['parse' => []]], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $cfg['token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp !== false && $code >= 200 && $code < 300) return '';
    $j = json_decode((string)$resp, true);
    $err = trim((string)($j['message'] ?? ''));
    // Mêmes aides que les tournois : les deux refus ne se règlent pas au même endroit.
    $aide = stripos($err, 'Missing Access') !== false ? ' — le bot ne voit pas ce salon (« Voir le salon », « Envoyer des messages »)'
          : (stripos($err, 'Missing Permissions') !== false ? ' — le bot ne peut pas y écrire (« Envoyer des messages », « Intégrer des liens »)' : '');
    return 'Discord a refusé (HTTP ' . $code . ($err !== '' ? ' : ' . $err : '') . ')' . $aide;
}
