<?php
// ============================================================
//  discord_sortie_cleanup.php — purge des posts de sortie terminés
//
//  Lancé par CRON (pas par Discord). Supprime le MESSAGE Discord d'une
//  sortie quand elle est finie depuis plus de GRACE_H heures, pour ne pas
//  encombrer le canal. NE supprime PAS les données (débriefs/historique).
//
//  Fin d'une sortie = (date + heure) + durée. Durée absente → DEFAULT_DUREE_H.
//  Une sortie sans heure exploitable n'est jamais auto-supprimée.
//
//  Usage :
//    php discord_sortie_cleanup.php          (suppression réelle)
//    php discord_sortie_cleanup.php --dry    (simulation, ne supprime rien)
//
//  Cron suggéré (utilisateur dune) :
//    */15 * * * * php /srv/dune-map/epice/discord_sortie_cleanup.php >> /home/dune/data/sortie_cleanup.log 2>&1
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); echo 'CLI only'; exit; }

date_default_timezone_set('Europe/Paris');

const DEFAULT_DUREE_H = 4;   // durée présumée si non renseignée
const GRACE_H         = 1;   // délai après la fin avant suppression

$DRY = in_array('--dry', $argv ?? [], true);

$CFG_PATH = __DIR__ . '/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { fwrite(STDERR, "config absente\n"); exit(1); }
$CFG = require $CFG_PATH;
if (empty($CFG['bot_token'])) { fwrite(STDERR, "bot_token manquant\n"); exit(1); }

function clog($m) { echo date('c') . ' ' . $m . "\n"; }

// --- Durée (texte) → heures (float). "2"→2 ; "1h30"→1.5 ; "2h"→2 ; vide→défaut ---
function duree_to_hours($d, $default) {
    $d = trim((string)$d);
    if ($d === '') return $default;
    if (ctype_digit($d)) return (float)$d;
    if (preg_match('/^(\d+)\s*h\s*(\d+)?$/i', $d, $m)) {
        return (float)$m[1] + (isset($m[2]) && $m[2] !== '' ? ((int)$m[2]) / 60 : 0);
    }
    if (preg_match('/^\d+(?:[.,]\d+)?$/', $d)) return (float)str_replace(',', '.', $d);
    return $default; // illisible → défaut
}

// --- Timestamp de fin d'une sortie, ou null si non calculable ---
function sortie_end_ts($s) {
    $date = trim($s['date'] ?? ''); $heure = trim($s['heure'] ?? '');
    if ($date === '' || $heure === '') return null; // pas d'heure exploitable → on ne touche pas
    $dt = DateTime::createFromFormat('Y-m-d H:i', $date . ' ' . $heure, new DateTimeZone('Europe/Paris'));
    if (!($dt instanceof DateTime)) return null;
    $hours = duree_to_hours($s['duree'] ?? '', DEFAULT_DUREE_H);
    return $dt->getTimestamp() + (int)round($hours * 3600);
}

// --- Suppression d'un message Discord (auth bot). 204=ok, 404=déjà absent=ok ---
function delete_message($CFG, $channelId, $messageId) {
    $ch = curl_init("https://discord.com/api/v10/channels/{$channelId}/messages/{$messageId}");
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['ok' => ($code === 204 || $code === 404), 'code' => $code];
}

// --- Lecture/écriture verrouillée d'un store JSON ---
function load_store($path, $empty) {
    if (!file_exists($path)) return $empty;
    return json_decode(file_get_contents($path), true) ?? $empty;
}
function save_store($path, $data) {
    $fp = @fopen($path, 'c+');
    if (!$fp) { clog("ERREUR écriture $path (droits ?)"); return; }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp); flock($fp, LOCK_UN);
    }
    fclose($fp);
}

$now = time();
$stores = [
    __DIR__ . '/data/debriefs.json'        => ['soiree_active' => null, 'sorties' => []],
    __DIR__ . '/data/discord_sorties.json' => ['sorties' => []],
];

$nDeleted = 0; $nSkipped = 0;

foreach ($stores as $path => $empty) {
    $data = load_store($path, $empty);
    if (empty($data['sorties']) || !is_array($data['sorties'])) continue;
    $changed = false;

    foreach ($data['sorties'] as &$s) {
        $disc = $s['discord'] ?? [];
        $mid  = $disc['message_id'] ?? '';
        $cid  = $disc['channel_id'] ?? '';

        if (!empty($disc['cleaned'])) continue;          // déjà nettoyé
        if ($mid === '' || $cid === '') { $nSkipped++; continue; } // pas d'id de message → on ne sait pas supprimer

        $end = sortie_end_ts($s);
        if ($end === null) { $nSkipped++; continue; }    // pas d'heure exploitable
        if ($now < $end + GRACE_H * 3600) continue;      // pas encore l'heure

        $titre = $s['titre'] ?? $s['id'] ?? '?';
        if ($DRY) {
            clog("[DRY] supprimerait « {$titre} » (msg {$mid})");
            $nDeleted++;
            continue;
        }
        $r = delete_message($CFG, $cid, $mid);
        if ($r['ok']) {
            $s['discord']['cleaned'] = true;             // ne pas réessayer
            $changed = true; $nDeleted++;
            clog("supprimé « {$titre} » (msg {$mid})");
        } else {
            clog("ÉCHEC suppression « {$titre} » (msg {$mid}) HTTP {$r['code']}");
        }
    }
    unset($s);

    if ($changed) save_store($path, $data);
}

clog(($DRY ? "[DRY] " : "") . "terminé : {$nDeleted} post(s) " . ($DRY ? "à supprimer" : "supprimé(s)") . ", {$nSkipped} ignoré(s).");
