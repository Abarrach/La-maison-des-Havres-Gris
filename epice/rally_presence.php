<?php
// ============================================================
//  RELEVÉ DE PRÉSENCE — un point par demi-heure passée en vocal
// ============================================================
// Lancé par cron toutes les 30 minutes. Pour chaque sortie OUVERTE dont la
// fenêtre horaire couvre l'instant présent, il note qui se trouve dans le salon
// vocal dédié et enregistre un « tick ». Un tick = un point.
//
//   */30 * * * *  php /srv/dune-map/epice/rally_presence.php >> /srv/dune-map/epice/data/rally_presence.log 2>&1
//
// Essai à blanc (n'écrit RIEN, affiche qui serait compté) :
//   php /srv/dune-map/epice/rally_presence.php --test
//
// ------------------------------------------------------------
//  POURQUOI C'EST FAIT COMME ÇA
// ------------------------------------------------------------
// Notre bot est un endpoint HTTP d'interactions, PAS un bot connecté à la
// gateway : il ne reçoit aucun événement temps réel et ne peut donc pas
// « écouter » les entrées/sorties du salon. Discord n'expose en REST que l'état
// vocal d'UN utilisateur à la fois (`GET /guilds/{g}/voice-states/{u}`), jamais
// la liste des occupants d'un salon. Il faut donc une liste de candidats et les
// interroger un par un.
//
// Candidats, par ordre de préférence :
//   1. les membres de la guilde (`GET /guilds/{g}/members`) — couvre les
//      VISITEURS, ceux qui viennent récolter sans s'être inscrits. Demande
//      l'intent privilégié « Server Members » (à activer dans le portail
//      développeur, côté GM).
//   2. à défaut, les inscrits de la sortie — on a leurs identifiants dans le
//      fichier. Suffisant si tout le monde s'inscrit, aveugle aux visiteurs.
// L'échec du point 1 est JOURNALISÉ, jamais silencieux : sinon on croirait
// relever tout le monde alors qu'on ne voit que les inscrits.
// ============================================================

if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI uniquement.\n"); }

date_default_timezone_set('Europe/Paris');   // même fuseau que le reste du bot

const BLOC_MINUTES = 30;      // un point par demi-heure
const MAX_CANDIDATS = 500;    // garde-fou : on n'interroge pas une guilde entière sans borne
const PAUSE_US      = 25000;  // 25 ms entre deux appels (limite Discord ~50 req/s)

$essai = in_array('--test', $argv ?? [], true);

$CFG_PATH = __DIR__ . '/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { fwrite(STDERR, "Config absente : $CFG_PATH\n"); exit(1); }
$CFG = require $CFG_PATH;

define('DATA_FILE', __DIR__ . '/data/debriefs.json');

function plog(string $m): void {
    echo '[' . date('Y-m-d H:i:s') . '] ' . $m . "\n";
}

// ------------------------------------------------------------
//  Appels Discord
// ------------------------------------------------------------
function discord_get(string $path, array &$erreur = null) {
    global $CFG;
    if (empty($CFG['bot_token']) || !function_exists('curl_init')) { $erreur = ['msg' => 'bot_token ou cURL absent']; return null; }
    $ch = curl_init('https://discord.com/api/v10' . $path);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false)              { $erreur = ['msg' => 'cURL en échec', 'code' => 0];    return null; }
    if ($code === 404)                { $erreur = ['msg' => 'introuvable',   'code' => 404];  return null; }  // pas en vocal = 404, cas NORMAL
    if ($code < 200 || $code >= 300)  { $erreur = ['msg' => substr((string)$resp, 0, 200), 'code' => $code]; return null; }
    return json_decode($resp, true);
}

/** Membres de la guilde (hors bots). [] si l'intent « Server Members » manque. */
function membres_guilde(string $guildId): array {
    $err = null;
    $out = [];
    $after = '';
    // Pagination par 1000 ; une guilde de plus de 3000 membres s'arrête au garde-fou.
    for ($page = 0; $page < 3; $page++) {
        $url = "/guilds/{$guildId}/members?limit=1000" . ($after !== '' ? "&after={$after}" : '');
        $lot = discord_get($url, $err);
        if (!is_array($lot)) {
            plog("⚠️ Liste des membres indisponible (" . ($err['code'] ?? '?') . " " . ($err['msg'] ?? '') . ")."
               . " L'intent privilégié « Server Members » est-il activé dans le portail développeur ?"
               . " → repli sur les seuls INSCRITS, les visiteurs ne seront pas comptés.");
            return [];
        }
        foreach ($lot as $m) {
            $u = $m['user'] ?? [];
            if (!empty($u['bot']) || empty($u['id'])) continue;
            $out[(string)$u['id']] = (string)($m['nick'] ?? ($u['global_name'] ?? ($u['username'] ?? $u['id'])));
            $after = (string)$u['id'];
        }
        if (count($lot) < 1000) break;
    }
    return $out;
}

/** L'utilisateur est-il dans CE salon vocal ? */
function est_dans_le_salon(string $guildId, string $userId, string $channelId): bool {
    $err = null;
    $vs  = discord_get("/guilds/{$guildId}/voice-states/{$userId}", $err);
    if (!is_array($vs)) return false;   // 404 = pas connecté au vocal, cas courant
    return (string)($vs['channel_id'] ?? '') === $channelId;
}

// ------------------------------------------------------------
//  Fenêtre d'une sortie
// ------------------------------------------------------------
/** Début et fin d'une sortie, ou null si la date/heure n'est pas exploitable. */
function fenetre_sortie(array $s): ?array {
    $date  = trim((string)($s['date'] ?? ''));
    $heure = trim((string)($s['heure'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $heure)) return null;
    $debut = DateTime::createFromFormat('Y-m-d H:i', "$date $heure", new DateTimeZone('Europe/Paris'));
    if (!$debut) return null;
    // Même lecture de la durée que creneaux_sortie() : « 8 » ou « 2h30 ».
    $d = trim((string)($s['duree'] ?? ''));
    if (ctype_digit($d))                                    $h = (float)$d;
    elseif (preg_match('/^(\d+)\s*h\s*(\d+)?$/i', $d, $m))   $h = (float)$m[1] + (isset($m[2]) && $m[2] !== '' ? ((int)$m[2]) / 60 : 0);
    else return null;
    $fin = (clone $debut)->modify('+' . (int)round($h * 60) . ' minutes');
    return [$debut, $fin];
}

/** Clé du tick : la demi-heure en cours, en heure locale. Stable et lisible. */
function cle_tick(DateTime $now): string {
    $m = (int)$now->format('i') < BLOC_MINUTES ? '00' : (string)BLOC_MINUTES;
    return $now->format('Y-m-d\TH:') . $m;
}

// ------------------------------------------------------------
//  Programme
// ------------------------------------------------------------
$guildId   = (string)($CFG['guild_id'] ?? '');
$channelId = (string)($CFG['rally_voice_channel_id'] ?? '');
if ($guildId === '' || $channelId === '') {
    fwrite(STDERR, "guild_id et rally_voice_channel_id doivent être renseignés dans discord_sortie_config.php\n");
    exit(1);
}

if (!file_exists(DATA_FILE)) { plog('Aucun fichier de sorties.'); exit(0); }
$data = json_decode(file_get_contents(DATA_FILE), true);
if (!is_array($data)) { fwrite(STDERR, "debriefs.json illisible\n"); exit(1); }

$now  = new DateTime('now', new DateTimeZone('Europe/Paris'));
$tick = cle_tick($now);

// Quelles sorties sont en cours ? Plusieurs peuvent l'être (multi-sorties).
$encours = [];
foreach ($data['sorties'] ?? [] as $i => $s) {
    if (($s['statut'] ?? '') !== 'ouverte') continue;
    $f = fenetre_sortie($s);
    if (!$f) continue;
    if ($now >= $f[0] && $now <= $f[1]) $encours[$i] = $s;
}

if (!$encours) { plog('Aucune sortie en cours — rien à relever.'); exit(0); }

// Candidats : les membres de la guilde (visiteurs compris), à défaut les inscrits.
$candidats = membres_guilde($guildId);
$source    = 'membres de la guilde';
if (!$candidats) {
    $source = 'inscrits des sorties en cours (repli)';
    foreach ($encours as $s) {
        foreach ($s['signups'] ?? [] as $su) {
            if (!empty($su['id'])) $candidats[(string)$su['id']] = (string)($su['name'] ?? $su['id']);
        }
    }
}
if (count($candidats) > MAX_CANDIDATS) {
    plog('⚠️ ' . count($candidats) . " candidats, tronqué à " . MAX_CANDIDATS . '.');
    $candidats = array_slice($candidats, 0, MAX_CANDIDATS, true);
}
plog(count($candidats) . " candidats ($source) — salon $channelId — tick $tick");

$presents = [];
foreach ($candidats as $id => $nom) {
    if (est_dans_le_salon($guildId, (string)$id, $channelId)) $presents[(string)$id] = $nom;
    usleep(PAUSE_US);
}

if (!$presents) { plog('Salon vide — tick non enregistré.'); exit(0); }
plog(count($presents) . ' présent(s) : ' . implode(', ', $presents));

if ($essai) { plog('--test : rien n’a été écrit.'); exit(0); }

// ------------------------------------------------------------
//  Écriture — relecture SOUS VERROU
// ------------------------------------------------------------
// Le fichier est partagé avec le site et le bot d'interactions : on le relit à
// l'intérieur du verrou plutôt que de réécrire la copie chargée en mémoire il y a
// trente secondes, sinon une inscription arrivée entre-temps serait effacée.
$fp = @fopen(DATA_FILE, 'c+');
if (!$fp) { fwrite(STDERR, "Ouverture impossible de " . DATA_FILE . "\n"); exit(1); }
$ok = false;
for ($essais = 0; $essais < 30; $essais++) {
    if (flock($fp, LOCK_EX | LOCK_NB)) { $ok = true; break; }
    usleep(100000);
}
if (!$ok) { fclose($fp); fwrite(STDERR, "Verrou indisponible sur debriefs.json\n"); exit(1); }

rewind($fp);
$frais = json_decode(stream_get_contents($fp), true);
if (!is_array($frais)) { flock($fp, LOCK_UN); fclose($fp); fwrite(STDERR, "Relecture illisible\n"); exit(1); }

$touche = 0;
foreach ($frais['sorties'] as $i => &$s) {
    if (!isset($encours[$i]) || ($s['id'] ?? '') !== ($encours[$i]['id'] ?? '~')) {
        // L'index a bougé (sortie créée/supprimée entre-temps) : on retrouve par id.
        continue;
    }
    if (!isset($s['presence']) || !is_array($s['presence'])) $s['presence'] = ['ticks' => [], 'noms' => [], 'volume' => 0];
    $s['presence']['ticks'][$tick] = array_values(array_map('strval', array_keys($presents)));
    foreach ($presents as $id => $nom) $s['presence']['noms'][(string)$id] = $nom;
    $touche++;
}
unset($s);

// Repêchage par id si les index ont bougé pendant le relevé.
if ($touche === 0) {
    $ids = array_map(function ($s) { return $s['id'] ?? ''; }, $encours);
    foreach ($frais['sorties'] as &$s) {
        if (!in_array($s['id'] ?? '', $ids, true)) continue;
        if (!isset($s['presence']) || !is_array($s['presence'])) $s['presence'] = ['ticks' => [], 'noms' => [], 'volume' => 0];
        $s['presence']['ticks'][$tick] = array_values(array_map('strval', array_keys($presents)));
        foreach ($presents as $id => $nom) $s['presence']['noms'][(string)$id] = $nom;
        $touche++;
    }
    unset($s);
}

ftruncate($fp, 0); rewind($fp);
fwrite($fp, json_encode($frais, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

plog("✅ tick $tick enregistré sur $touche sortie(s).");
