<?php
// ============================================================
//  weekly_reset.php — remise à zéro hebdomadaire du classement du Hub Jeux
//
//  Lancé par CRON le mardi à 05:00 UTC. ATTENTION : le serveur tourne en UTC
//  (volontairement — d'autres resets, carte des bases et DD, sont calés dessus),
//  donc ça tombe à 7h heure de Paris l'été et 6h l'hiver. Le compte à rebours de
//  hub.html calcule à partir de 05:00 UTC pour rester juste. Calcule les champions de la semaine
//  écoulée (top score par jeu dans scores_weekly.json), poste l'annonce
//  dans Discord (lore : une tempête de Coriolis vient de passer sur
//  Arrakis) — avec, à côté, un rappel du Hall of Fame (scores.json,
//  "le score à détrôner") pour donner un repère aux champions du jour —,
//  archive l'état de la semaine, puis remet scores_weekly.json à vide.
//  Le classement all-time (scores.json, Hall of Fame) n'est JAMAIS
//  modifié par ce script (lecture seule).
//
//  Usage :
//    php weekly_reset.php          (reset réel + annonce Discord)
//    php weekly_reset.php --dry    (simulation : n'écrit rien, ne poste rien)
//
//  Cron suggéré (utilisateur dune) :
//    0 5 * * 2 php /srv/dune-map/jeux/weekly_reset.php >> /home/dune/data/weekly_reset.log 2>&1
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); echo 'CLI only'; exit; }

date_default_timezone_set('Europe/Paris');

const GAMES = [
    'orni_flap'        => 'Ornithopter Flap',
    'spice_runner'     => 'Spice Runner',
    'sandstorm_memory' => 'Sandstorm Memory',
    'worm_rider'       => 'Worm Rider',
    'muaddib_rescue'   => "Muad'Dib Rescue",
];

$DRY = in_array('--dry', $argv ?? [], true);

function clog($m) { echo date('c') . ' ' . $m . "\n"; }

$WEEKLY_FILE = __DIR__ . '/data/scores_weekly.json';
$ARCHIVE_DIR = __DIR__ . '/data/weekly_archive';
$WEBHOOK_FILE = __DIR__ . '/data/discord_webhook.txt';

// --- Contrôle avant vol : droit d'écriture sur le classement hebdo ---
// L'annonce Discord part AVANT la remise à zéro. Si le fichier n'est pas
// inscriptible (typiquement : créé par www-data en 644, alors que ce script
// tourne en tant que dune), on annonçait une remise à zéro qui n'avait jamais
// lieu — panne silencieuse vécue le 21/07/2026. On vérifie donc d'abord, et on
// abandonne AVANT d'annoncer quoi que ce soit.
$whoami = function_exists('posix_geteuid') && function_exists('posix_getpwuid')
    ? (posix_getpwuid(posix_geteuid())['name'] ?? '?')
    : 'l\'utilisateur courant';
$canWrite = file_exists($WEEKLY_FILE) ? is_writable($WEEKLY_FILE) : is_writable(dirname($WEEKLY_FILE));
if (!$canWrite) {
    clog('ERREUR : ' . $WEEKLY_FILE . ' non inscriptible par ' . $whoami . '.');
    clog('  Rien n\'a été annoncé ni modifié. Correction :');
    clog('    sudo chown dune:www-data ' . $WEEKLY_FILE);
    clog('    sudo chmod 664 ' . $WEEKLY_FILE);
    exit(1);
}
if ($DRY) clog('[DRY] droit d\'écriture sur scores_weekly.json : OK (utilisateur ' . $whoami . ').');

// --- Lecture du classement hebdomadaire sortant ---
$weekly = [];
if (file_exists($WEEKLY_FILE)) {
    $weekly = json_decode(file_get_contents($WEEKLY_FILE), true) ?? [];
}
if (!is_array($weekly)) $weekly = [];

// --- Champion de la semaine par jeu (meilleur score) ---
$champions = [];
foreach (GAMES as $gameId => $gameName) {
    $best = null;
    foreach ($weekly as $e) {
        if (($e['game'] ?? '') !== $gameId) continue;
        if ($best === null || ($e['score'] ?? 0) > $best['score']) {
            $best = ['player' => $e['player'] ?? '?', 'score' => (int)($e['score'] ?? 0)];
        }
    }
    if ($best) $champions[$gameId] = $best;
}

if (empty($champions)) {
    clog(($DRY ? '[DRY] ' : '') . 'Aucun score cette semaine — reset sans annonce de champions.');
}

// --- Hall of Fame (all-time, scores.json) — donne un repère aux champions de
// la semaine ("le score à détrôner"). Lecture seule, jamais modifié ici. ---
$ALLTIME_FILE = __DIR__ . '/data/scores.json';
$alltime = [];
if (file_exists($ALLTIME_FILE)) {
    $alltime = json_decode(file_get_contents($ALLTIME_FILE), true) ?? [];
}
if (!is_array($alltime)) $alltime = [];

$hallOfFame = [];
foreach (GAMES as $gameId => $gameName) {
    $best = null;
    foreach ($alltime as $e) {
        if (($e['game'] ?? '') !== $gameId) continue;
        if ($best === null || ($e['score'] ?? 0) > $best['score']) {
            $best = ['player' => $e['player'] ?? '?', 'score' => (int)($e['score'] ?? 0)];
        }
    }
    if ($best) $hallOfFame[$gameId] = $best;
}

// --- Annonce Discord (lore : tempête de Coriolis) ---
// Deux blocs séparés (fields Discord, pas du texte enchaîné) : les champions
// de la semaine (frais, remis à zéro) et le Hall of Fame (repère stable, pour
// donner un objectif à viser plutôt qu'un classement froid).
function post_discord(string $webhookFile, array $champions, array $hallOfFame): bool {
    if (!file_exists($webhookFile)) { clog('pas de discord_webhook.txt — annonce ignorée'); return false; }
    $url = trim(file_get_contents($webhookFile));
    if ($url === '' || !function_exists('curl_init')) { clog('webhook vide ou curl indisponible — annonce ignorée'); return false; }

    $link = 'https://havresgris.ddns.net/jeux/hub.html';

    $desc = empty($champions)
        ? "Une **tempête de Coriolis** a balayé Arrakis cette nuit — le sable a tout recouvert, "
          . "et avec lui les scores de la semaine écoulée (personne ne s'était encore illustré).\n\n"
          . "Une nouvelle semaine de compétition démarre sur le [Hub de jeux]({$link}) !"
        : "Une **tempête de Coriolis** a balayé Arrakis cette nuit — le sable a tout recouvert, "
          . "et avec lui le classement de la semaine écoulée.\n\n"
          . "Une nouvelle semaine de compétition démarre sur le [Hub de jeux]({$link}) !";

    $fields = [];
    if (!empty($champions)) {
        $lines = [];
        foreach ($champions as $gameId => $c) {
            $lines[] = '🏆 **' . (GAMES[$gameId] ?? $gameId) . "** — {$c['player']} (**{$c['score']}**)";
        }
        $fields[] = ['name' => '🏆 Champions de la semaine', 'value' => implode("\n", $lines), 'inline' => false];
    }
    if (!empty($hallOfFame)) {
        $lines = [];
        foreach ($hallOfFame as $gameId => $c) {
            $lines[] = '👑 **' . (GAMES[$gameId] ?? $gameId) . "** — {$c['player']} (**{$c['score']}**)";
        }
        $fields[] = ['name' => '🏛️ Hall of Fame — le score à détrôner', 'value' => implode("\n", $lines), 'inline' => false];
    }

    $embed = [
        'title'       => '🌪️ Tempête de Coriolis sur Arrakis — classement hebdo remis à zéro',
        'url'         => $link,
        'description' => $desc,
        'color'       => hexdec('D4A23B'),
        'fields'      => $fields,
        'footer'      => ['text' => 'Hub de jeux — Les Havres Gris · rendez-vous mardi prochain'],
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['embeds' => [$embed]], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300;
}

if ($DRY) {
    clog('[DRY] annoncerait sur Discord :');
    clog('  Champions de la semaine :');
    foreach ($champions as $gameId => $c) {
        clog('    ' . (GAMES[$gameId] ?? $gameId) . ' : ' . $c['player'] . ' (' . $c['score'] . ')');
    }
    clog('  Hall of Fame (all-time) :');
    foreach ($hallOfFame as $gameId => $c) {
        clog('    ' . (GAMES[$gameId] ?? $gameId) . ' : ' . $c['player'] . ' (' . $c['score'] . ')');
    }
} else {
    $posted = post_discord($WEBHOOK_FILE, $champions, $hallOfFame);
    clog($posted ? 'annonce Discord envoyée.' : 'annonce Discord NON envoyée (voir logs ci-dessus).');
}

// --- Archive l'état sortant avant de le vider (historique, jamais écrasé) ---
if (!$DRY && !empty($weekly)) {
    if (!is_dir($ARCHIVE_DIR)) @mkdir($ARCHIVE_DIR, 0775, true);
    // Numéro de semaine ISO de la semaine qui SE TERMINE (on est mardi matin,
    // donc "hier" = encore dans la semaine ISO qui vient de s'écouler).
    $label = date('o-\WW', strtotime('-1 day'));
    $archiveFile = $ARCHIVE_DIR . '/scores_' . $label . '.json';
    if (!file_exists($archiveFile)) {
        file_put_contents($archiveFile, json_encode([
            'week'       => $label,
            'reset_at'   => date('c'),
            'champions'  => $champions,
            'all_scores' => $weekly,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        clog("archivé : {$archiveFile}");
    }
}

// --- Remise à zéro du classement hebdomadaire ---
if ($DRY) {
    clog('[DRY] viderait scores_weekly.json (' . count($weekly) . ' entrée(s)).');
} else {
    $fp = @fopen($WEEKLY_FILE, 'c+');
    if (!$fp) {
        clog('ERREUR : impossible d\'ouvrir ' . $WEEKLY_FILE . ' (droits ?)');
        exit(1);
    }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode([], JSON_PRETTY_PRINT));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    // Garde le fichier inscriptible par le groupe (www-data ET dune doivent
    // pouvoir écrire : le site pour enregistrer, ce script pour remettre à zéro).
    @chmod($WEEKLY_FILE, 0664);
    clog('scores_weekly.json remis à zéro (' . count($weekly) . ' entrée(s) archivée(s)).');
}

clog(($DRY ? '[DRY] ' : '') . 'terminé.');
