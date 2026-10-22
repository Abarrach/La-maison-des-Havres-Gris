<?php
/**
 * dd_map_update.php — Compose deep_desert.jpg depuis les tuiles CDN
 *
 * Grille zoom-3 : 8×8 tuiles (x:0-7, y:0-7)
 * CDN    : https://cdn-hosted.gaming.tools/dune/map-tiles/{world}/3/{x}_{y}.webp
 *
 * Tileset hebdomadaire : deepdesert_1_NN où NN = (compteur hebdo) mod 12.
 * Le compteur part d'une référence calibrée (semaine du 13 mai 2026). Cette
 * formule modulo 12 donne le bon tileset chaque semaine — c'est le MÊME calcul
 * que côté client pour l'épice (`currentActorSeed()` = est%12), donc l'image et
 * les marqueurs restent synchronisés.
 *
 * ⚠ On NE scrape PAS gaming.tools ici : Cloudflare bloque les requêtes curl du
 * serveur (403). Les TUILES .webp, elles, passent (règle Cloudflare plus souple
 * sur les images) — c'est pourquoi la composition de l'image fonctionne.
 *
 * Usage : php dd_map_update.php
 * Cron  : 30 5 * * 2   www-data php /srv/dune-map/v2/dd_map_update.php
 *
 * ── Garde-fous (2026-10-23) ──────────────────────────────────────────────────
 * gaming.tools charge désormais ses propres tuiles en un paquet `.gtpk` ; les `.webp`
 * lus ici répondent encore, mais il ne s'en sert plus lui-même : elles peuvent
 * disparaître ou être remplacées par une image de remplacement sans prévenir. D'où :
 *   • chaque tuile est contrôlée (HTTP 200, type image, décodable, pas « vide ») et le
 *     jeu complet aussi (assez de tuiles DIFFÉRENTES : un CDN qui renvoie la même image
 *     de remplacement partout passerait tous les autres contrôles) ;
 *   • l'image est écrite dans un fichier temporaire, et ne remplace deep_desert.jpg que
 *     si tout est valide — une panne garde la carte de la semaine précédente, au lieu
 *     d'un aplat de sable ;
 *   • une panne prévient en MESSAGE PRIVÉ (`alerte_user_id`, comme le relevé de présence),
 *     une fois par cause et par jour ; le retour à la normale efface le marqueur.
 *
 * Options : --alerte-test          envoie un MP de contrôle, ne compose rien
 *           --sortie=<fichier>     écrit ailleurs que deep_desert.jpg (essais)
 *           --cdn=<url de base>    autre source de tuiles (essais : simuler une panne)
 */

$ARGS     = $argv ?? [];
$optVal   = function (string $nom) use ($ARGS): ?string {
    foreach ($ARGS as $a) if (strpos($a, "--{$nom}=") === 0) return substr($a, strlen($nom) + 3);
    return null;
};
$OUT_FILE = $optVal('sortie') ?: __DIR__ . '/deep_desert.jpg';
$LOG_FILE = __DIR__ . '/dd_map_update.log';
$X_MAX    = 7;
$Y_MAX    = 7;
const DD_TUILES_MANQUANTES_MAX = 8;   // même seuil que la composition côté navigateur (ddComposeShot)
const DD_TUILES_DISTINCTES_MIN = 16;  // sur 64 : en dessous, c'est une image de remplacement
const DD_ALERTE_FICHIER        = __DIR__ . '/dd_map_alerte.json';
const DD_ALERTE_REPETER_H      = 24;

// ── Seed hebdo (auto-suffisant, sans réseau) ─────────────────────────────────
// Réf : compteur 16 = semaine du 9 juin 2026 (mardi 05h Paris) → 16 mod 12 = 4.
$REF_COUNT = 16;
$REF_DT    = new DateTime('2026-06-09 05:00:00', new DateTimeZone('Europe/Paris'));

function dd_week_count(int $ref, DateTime $refDt): int {
    $now  = new DateTime('now', new DateTimeZone('Europe/Paris'));
    $diff = $now->getTimestamp() - $refDt->getTimestamp();
    return $ref + (int) floor($diff / (7 * 24 * 3600));
}
function dd_seed_world(int $count): string {
    return 'deepdesert_1_' . str_pad((string) ((($count % 12) + 12) % 12), 2, '0', STR_PAD_LEFT);
}

// ── Logger ───────────────────────────────────────────────────────────────────
function log_msg(string $msg): void {
    global $LOG_FILE;
    $line = '[' . date('c') . '] ' . $msg . PHP_EOL;
    file_put_contents($LOG_FILE, $line, FILE_APPEND);
    echo $line;
}

// ── Fetch HTTP ───────────────────────────────────────────────────────────────
function fetch_url(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; DuneMapBot/1.0)',
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type   = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return ['status' => $status, 'body' => $body ?: '', 'type' => $type];
}

// ── Alerte en message privé (une fois par cause et par jour) ─────────────────
function dd_alerter(string $cause, string $texte): void {
    $cfgPath = __DIR__ . '/epice/discord_sortie_config.php';
    $cfg = file_exists($cfgPath) ? (include $cfgPath) : null;
    $uid = trim((string) ($cfg['alerte_user_id'] ?? ''));
    $tok = trim((string) ($cfg['bot_token'] ?? ''));
    if (!is_array($cfg) || $uid === '' || $tok === '' || strpos($tok, 'COLLE_TON') !== false) {
        log_msg('(alerte non envoyée : bot_token ou alerte_user_id absent de epice/discord_sortie_config.php)');
        return;
    }
    $etat = @json_decode((string) @file_get_contents(DD_ALERTE_FICHIER), true) ?: [];
    if (($etat['cause'] ?? '') === $cause && (time() - (int) ($etat['ts'] ?? 0)) < DD_ALERTE_REPETER_H * 3600) {
        log_msg('(alerte déjà envoyée pour cette cause, pas de rappel)');
        return;
    }
    $post = function (string $url, array $corps) use ($tok): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($corps, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => ['Authorization: Bot ' . $tok, 'Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 6,
        ]);
        $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        return [$code, json_decode((string) $r, true)];
    };
    [$code, $j] = $post('https://discord.com/api/v10/users/@me/channels', ['recipient_id' => $uid]);
    $chan = ($code >= 200 && $code < 300) ? ($j['id'] ?? null) : null;
    if (!$chan) { log_msg("(alerte non envoyée : ouverture du MP en échec, HTTP {$code})"); return; }
    [$code] = $post("https://discord.com/api/v10/channels/{$chan}/messages", ['content' => $texte]);
    if ($code < 200 || $code >= 300) { log_msg("(alerte non envoyée, HTTP {$code})"); return; }
    @file_put_contents(DD_ALERTE_FICHIER, json_encode(['cause' => $cause, 'ts' => time()]));
    log_msg('📨 Alerte envoyée en MP.');
}

// Panne : on garde la carte de la semaine précédente, on prévient, on sort en erreur.
function dd_echec(string $cause, string $detail): void {
    global $world;
    log_msg("ÉCHEC ({$cause}) : {$detail} — " . basename($GLOBALS["OUT_FILE"]) . " n'est PAS remplacé (carte précédente conservée).");
    dd_alerter($cause, "🗺️ **Carte Deep Desert de la semaine non mise à jour** ({$world})." . chr(10)
        . $detail . chr(10)
        . "La carte de la semaine précédente reste affichée. Piste probable : gaming.tools a changé ses tuiles "
        . "(il charge désormais un paquet `.gtpk`). Journal : `dd_map_update.log`." . chr(10)
        . '*' . gethostname() . ', ' . date('d/m/Y à H:i') . '*');
    exit(1);
}

// Écart-type de luminosité d'une tuile, sur un échantillon 16×16 : une tuile « vide »
// (aplat, transparente, image d'erreur unie) tombe sous ~2.
function dd_tuile_variee($img): float {
    $w = imagesx($img); $h = imagesy($img); $n = 0; $s = 0.0; $s2 = 0.0;
    for ($i = 0; $i < 16; $i++) for ($k = 0; $k < 16; $k++) {
        $c = imagecolorat($img, (int) (($i + 0.5) * $w / 16), (int) (($k + 0.5) * $h / 16));
        $l = 0.299 * (($c >> 16) & 255) + 0.587 * (($c >> 8) & 255) + 0.114 * ($c & 255);
        $s += $l; $s2 += $l * $l; $n++;
    }
    $m = $s / $n;
    return sqrt(max(0.0, $s2 / $n - $m * $m));
}

// ════════════════════════════════════════════════════════════════════════════
if (in_array('--alerte-test', $ARGS, true)) {
    $world = '(essai)';
    dd_alerter('essai-' . time(), "✅ **Essai d'alerte de la carte Deep Desert.**" . chr(10)
        . 'Si tu lis ce message, tu seras prévenu si la carte du mardi ne peut pas être mise à jour.' . chr(10)
        . '*' . gethostname() . ', ' . date('d/m/Y à H:i') . '*');
    @unlink(DD_ALERTE_FICHIER);   // un essai ne doit pas masquer une vraie panne ensuite
    exit(0);
}

log_msg('══ Démarrage mise à jour carte Deep Desert ══');

$count = dd_week_count($REF_COUNT, $REF_DT);  // compteur hebdo
$world = dd_seed_world($count);                // deepdesert_1_NN (NN = count mod 12)
log_msg("Compteur hebdo : {$count} → tileset : {$world} (mod 12 = " . ((($count % 12) + 12) % 12) . ")");

$CDN_BASE = rtrim($optVal('cdn') ?: 'https://cdn-hosted.gaming.tools/dune/map-tiles', '/') . "/{$world}/3";

// ── Dimensions réelles d'une tuile ───────────────────────────────────────────
$sample = fetch_url("{$CDN_BASE}/0_0.webp");
if ($sample['status'] !== 200 || $sample['body'] === '') {
    dd_echec('tuile-0-0', "La tuile (0,0) ne répond pas (HTTP {$sample['status']}).");
}

$sampleImg = @imagecreatefromstring($sample['body']);
if (!$sampleImg) {
    dd_echec('tuile-illisible', "La tuile (0,0) n'est pas une image lisible (type annoncé : « {$sample['type']} »).");
}
$tileW  = imagesx($sampleImg);
$tileH  = imagesy($sampleImg);
imagedestroy($sampleImg);

$totalW = ($X_MAX + 1) * $tileW;
$totalH = ($Y_MAX + 1) * $tileH;
log_msg("Tuile : {$tileW}×{$tileH} px  →  Image finale : {$totalW}×{$totalH} px");

// ── Canvas ───────────────────────────────────────────────────────────────────
$canvas = imagecreatetruecolor($totalW, $totalH);
if (!$canvas) {
    log_msg('ERREUR : impossible de créer le canvas');
    exit(1);
}

// Fond sable neutre (au cas où une tuile manque)
$sand = imagecolorallocate($canvas, 210, 175, 120);
imagefill($canvas, 0, 0, $sand);

// ── Téléchargement et composition ────────────────────────────────────────────
$ok = 0; $fail = 0; $vides = 0; $empreintes = [];
for ($y = 0; $y <= $Y_MAX; $y++) {
    for ($x = 0; $x <= $X_MAX; $x++) {
        $r = fetch_url("{$CDN_BASE}/{$x}_{$y}.webp");
        if ($r['status'] !== 200 || !$r['body']) {
            log_msg("  MANQUANTE : ({$x},{$y}) HTTP {$r['status']}");
            $fail++;
            continue;
        }
        $tile = @imagecreatefromstring($r['body']);
        if (!$tile) { log_msg("  ILLISIBLE : ({$x},{$y}) type « {$r['type']} »"); $fail++; continue; }
        if (dd_tuile_variee($tile) < 2) { log_msg("  VIDE : ({$x},{$y})"); $vides++; }
        $empreintes[md5($r['body'])] = true;
        imagecopy($canvas, $tile, $x * $tileW, $y * $tileH, 0, 0, $tileW, $tileH);
        imagedestroy($tile);
        $ok++;
    }
}
$distinctes = count($empreintes);
log_msg("Tuiles : {$ok} OK, {$fail} manquantes, {$vides} vides, {$distinctes} distinctes");

if ($fail + $vides > DD_TUILES_MANQUANTES_MAX) {
    imagedestroy($canvas);
    dd_echec('tuiles-manquantes', "{$fail} tuile(s) manquante(s) ou illisible(s) et {$vides} vide(s) sur 64 (tolérance : "
        . DD_TUILES_MANQUANTES_MAX . ').');
}
if ($distinctes < DD_TUILES_DISTINCTES_MIN) {
    imagedestroy($canvas);
    dd_echec('tuiles-identiques', "Seulement {$distinctes} tuile(s) différente(s) sur 64 : le CDN renvoie sans doute une "
        . 'image de remplacement.');
}

// ── Sauvegarde JPEG : fichier temporaire, puis remplacement ──────────────────
// Écrire directement dans deep_desert.jpg laissait une image tronquée en cas d'erreur
// d'écriture ; le renommage est atomique sur le même disque.
$tmp = $OUT_FILE . '.tmp';
if (!imagejpeg($canvas, $tmp, 90) || !rename($tmp, $OUT_FILE)) {
    imagedestroy($canvas);
    @unlink($tmp);
    dd_echec('ecriture', "Impossible d'écrire {$OUT_FILE} (droits du dossier ?).");
}
imagedestroy($canvas);
@chmod($OUT_FILE, 0664);   // un fichier recréé par PHP arrive en 644 : WinSCP et les crons ne pourraient plus le remplacer

$size = round(filesize($OUT_FILE) / 1024);
log_msg("✓ " . basename($OUT_FILE) . " sauvegardé — {$size} Ko ({$totalW}×{$totalH})");
if (file_exists(DD_ALERTE_FICHIER)) { @unlink(DD_ALERTE_FICHIER); log_msg('(panne précédente résolue)'); }
log_msg('══ Terminé ══');
