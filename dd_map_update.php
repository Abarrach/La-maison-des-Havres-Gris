<?php
/**
 * dd_map_update.php — Compose deep_desert.jpg depuis les tuiles CDN
 *
 * Grille zoom-3 : 8×8 tuiles (x:0-7, y:0-7)
 * CDN    : https://cdn-hosted.gaming.tools/dune/map-tiles/{world}/3/{x}_{y}.webp
 *
 * Détection automatique du tileset hebdomadaire :
 *   essaie deepdesert_1_NN (seed courant puis _00 à _20)
 *   jusqu'à trouver un tileset valide.
 *
 * Usage : php dd_map_update.php
 * Cron  : 30 5 * * 2   www-data php /srv/dune-map/v2/dd_map_update.php
 */

$OUT_FILE = __DIR__ . '/deep_desert.jpg';
$LOG_FILE = __DIR__ . '/dd_map_update.log';
$X_MAX    = 7;
$Y_MAX    = 7;

// ── Référence seed ───────────────────────────────────────────────────────────
// Seed 12 = semaine du 13 mai 2026 (mardi 05h Paris)
// Formule tileset : deepdesert_1_NN où NN = seed mod 12 (12 variantes cycliques)
$REF_SEED = 12;
$REF_DT   = new DateTime('2026-05-13 05:00:00', new DateTimeZone('Europe/Paris'));

function currentSeed(int $ref, DateTime $refDt): int {
    $now  = new DateTime('now', new DateTimeZone('Europe/Paris'));
    $diff = $now->getTimestamp() - $refDt->getTimestamp();
    return max(1, $ref + (int) floor($diff / (7 * 24 * 3600)));
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
    curl_close($ch);
    return ['status' => $status, 'body' => $body ?: ''];
}

// ── Calculer le tileset depuis le seed ────────────────────────────────────────
// 12 variantes de terrain cycliques (deepdesert_1_00 à deepdesert_1_11)
// Formule : NN = seed mod 12
// Vérifié : seed 11 → _11, seed 12 → _00, seed 13 → _01, etc.
function seedToWorld(int $seed): string {
    $nn = str_pad($seed % 12, 2, '0', STR_PAD_LEFT);
    return "deepdesert_1_{$nn}";
}

// ════════════════════════════════════════════════════════════════════════════
log_msg('══ Démarrage mise à jour carte Deep Desert ══');

$seed  = currentSeed($REF_SEED, $REF_DT);
$world = seedToWorld($seed);
log_msg("Seed courant : {$seed} → tileset : {$world} (seed mod 12 = " . ($seed % 12) . ")");

$CDN_BASE = "https://cdn-hosted.gaming.tools/dune/map-tiles/{$world}/3";

// ── Dimensions réelles d'une tuile ───────────────────────────────────────────
$sample = fetch_url("{$CDN_BASE}/0_0.webp");
if ($sample['status'] !== 200) {
    log_msg('ERREUR : impossible de charger la tuile (0,0)');
    exit(1);
}

$sampleImg = imagecreatefromstring($sample['body']);
if (!$sampleImg) {
    log_msg('ERREUR : GD ne peut pas décoder le WebP');
    exit(1);
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
$ok = 0; $fail = 0;
for ($y = 0; $y <= $Y_MAX; $y++) {
    for ($x = 0; $x <= $X_MAX; $x++) {
        $r = fetch_url("{$CDN_BASE}/{$x}_{$y}.webp");
        if ($r['status'] !== 200 || !$r['body']) {
            log_msg("  MANQUANTE : ({$x},{$y}) HTTP {$r['status']}");
            $fail++;
            continue;
        }
        $tile = imagecreatefromstring($r['body']);
        if (!$tile) { $fail++; continue; }
        imagecopy($canvas, $tile, $x * $tileW, $y * $tileH, 0, 0, $tileW, $tileH);
        imagedestroy($tile);
        $ok++;
    }
}
log_msg("Tuiles : {$ok} OK, {$fail} manquantes");

// ── Sauvegarde JPEG ──────────────────────────────────────────────────────────
if (!imagejpeg($canvas, $OUT_FILE, 90)) {
    log_msg("ERREUR : impossible d'écrire {$OUT_FILE}");
    imagedestroy($canvas);
    exit(1);
}
imagedestroy($canvas);

$size = round(filesize($OUT_FILE) / 1024);
log_msg("✓ deep_desert.jpg sauvegardé — {$size} Ko ({$totalW}×{$totalH})");
log_msg('══ Terminé ══');
