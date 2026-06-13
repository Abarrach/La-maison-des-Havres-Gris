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
 */

$OUT_FILE = __DIR__ . '/deep_desert.jpg';
$LOG_FILE = __DIR__ . '/dd_map_update.log';
$X_MAX    = 7;
$Y_MAX    = 7;

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
    curl_close($ch);
    return ['status' => $status, 'body' => $body ?: ''];
}

// ════════════════════════════════════════════════════════════════════════════
log_msg('══ Démarrage mise à jour carte Deep Desert ══');

$count = dd_week_count($REF_COUNT, $REF_DT);  // compteur hebdo
$world = dd_seed_world($count);                // deepdesert_1_NN (NN = count mod 12)
log_msg("Compteur hebdo : {$count} → tileset : {$world} (mod 12 = " . ((($count % 12) + 12) % 12) . ")");

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
