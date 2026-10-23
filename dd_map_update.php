<?php
/**
 * dd_map_update.php — Compose deep_desert.jpg, le fond de la carte Deep Desert de la semaine
 *
 * Tileset hebdomadaire : deepdesert_1_NN où NN = (compteur hebdo) mod 12.
 * Le compteur part d'une référence calibrée (semaine du 13 mai 2026). Cette
 * formule modulo 12 donne le bon tileset chaque semaine — c'est le MÊME calcul
 * que côté client pour l'épice (`currentActorSeed()` = est%12), donc l'image et
 * les marqueurs restent synchronisés.
 *
 * ── Deux sources, la locale d'abord (2026-10-23) ─────────────────────────────
 * 1. dd_fonds/deepdesert_1_NN.gtpk : le paquet de tuiles de gaming.tools, gardé SUR LE
 *    SERVEUR. Un paquet = la pyramide complète d'une variante (zooms 0 à 5, 1 365 tuiles
 *    WebP, 2,2 Mo), et il ne change pas d'une semaine à l'autre (celui de la variante 11
 *    date du 2 juillet 2026) : avec les 12 paquets, la rotation tourne sans rien demander
 *    à gaming.tools. Composé au zoom 4 = 16×16 tuiles = 4096 px (le zoom 3 des .webp ne
 *    donnait que 2048 px). Le serveur ne peut PAS télécharger les paquets lui-même
 *    (Cloudflare lui présente un défi JavaScript) : on les récupère depuis un PC avec
 *    `bash tools/fetch_dd_fonds.sh`, puis on dépose dd_fonds/ par WinSCP.
 * 2. Les tuiles .webp du CDN (zoom 3, 8×8 = 2048 px) : elles passent Cloudflare depuis le
 *    serveur. Servent de CONTRÔLE (3 tuiles comparées octet pour octet au zoom 3 du paquet :
 *    si elles diffèrent, un patch a changé la carte et le paquet local est périmé) et de
 *    SECOURS (paquet absent ou périmé). gaming.tools ne s'en sert plus lui-même : elles
 *    peuvent disparaître — sans elles, le paquet local suffit.
 *
 * Format .gtpk (lu ici, relevé le 2026-10-23) : en-tête de 48 octets en little-endian —
 * « GTPK », version (2), nombre de tuiles, taille d'une tuile (256), ?, zoom max (5),
 * largeur, hauteur, taille d'une entrée d'index (24), position de l'index (48) — puis
 * l'index : z, x, y (u32), position (u64), longueur (u32) ; puis les images WebP.
 *
 * ── Garde-fous ───────────────────────────────────────────────────────────────
 *   • chaque tuile est contrôlée (décodable, pas « vide ») et le jeu complet aussi (assez
 *     de tuiles DIFFÉRENTES : une image de remplacement partout passerait le reste) ;
 *   • l'image est écrite dans un fichier temporaire, et ne remplace deep_desert.jpg que
 *     si tout est valide — une panne garde la carte de la semaine précédente ;
 *   • panne ou paquet périmé → MESSAGE PRIVÉ (`alerte_user_id`, comme le relevé de
 *     présence), une fois par cause et par jour ; le retour à la normale efface le marqueur.
 *
 * Usage : php dd_map_update.php
 * Cron  : crontab de l'utilisateur dune (relevé le 2026-10-23), sur la PROD racine :
 *         30 6 * * 2 /usr/bin/php /srv/dune-map/dd_map_update.php >/dev/null 2>>/srv/dune-map/dd_map_update.log
 *         Il tourne sous dune, pas www-data : deep_desert.jpg et le marqueur d'alerte lui appartiennent.
 *
 * Options : --alerte-test          envoie un MP de contrôle, ne compose rien
 *           --sortie=<fichier>     écrit ailleurs que deep_desert.jpg (essais)
 *           --cdn=<url de base>    autre source de tuiles .webp (essais : simuler une panne)
 *           --fonds=<dossier>      autre dossier de paquets (essais : simuler un paquet absent)
 */

$ARGS     = $argv ?? [];
$optVal   = function (string $nom) use ($ARGS): ?string {
    foreach ($ARGS as $a) if (strpos($a, "--{$nom}=") === 0) return substr($a, strlen($nom) + 3);
    return null;
};
$OUT_FILE = $optVal('sortie') ?: __DIR__ . '/deep_desert.jpg';
$LOG_FILE = __DIR__ . '/dd_map_update.log';
$FONDS    = rtrim($optVal('fonds') ?: __DIR__ . '/dd_fonds', '/');
const DD_ZOOM_PAQUET           = 4;     // 16×16 tuiles = 4096 px (5 = 8192 px, ~4× plus lourd)
const DD_ZOOM_WEBP             = 3;     // 8×8 tuiles = 2048 px
const DD_CONTROLES             = [[0, 0], [3, 4], [7, 7]];   // tuiles .webp comparées au paquet (zoom 3)
const DD_ALERTE_FICHIER        = __DIR__ . '/dd_map_alerte.json';
const DD_ALERTE_REPETER_H      = 24;
ini_set('memory_limit', '512M');        // toile 4096² en vraies couleurs ≈ 64 Mo pour GD

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

// ── Paquet .gtpk local ─────────────────────────────────────────────────────────
/** Index du paquet ([« z/x_y » => [position, longueur]]), ou null s'il est absent ou invalide. */
function dd_lire_paquet(string $chemin): ?array {
    if (!is_file($chemin) || !($f = @fopen($chemin, 'rb'))) return null;
    $taille = filesize($chemin);
    $h = fread($f, 48);
    if (strlen($h) < 48 || substr($h, 0, 4) !== 'GTPK') { fclose($f); return null; }
    $e = unpack('Vversion/Vnb/Vtuile/Vinconnu/Vzmax/Vlargeur/Vhauteur/Ventree/Vindex', substr($h, 4, 36));
    if ($e['version'] !== 2 || $e['entree'] !== 24 || $e['nb'] < 1 || $e['nb'] > 100000) { fclose($f); return null; }
    fseek($f, $e['index']);
    $brut = fread($f, $e['nb'] * 24);
    fclose($f);
    if (strlen($brut) !== $e['nb'] * 24) return null;
    $idx = [];
    for ($i = 0; $i < $e['nb']; $i++) {
        $t = unpack('Vz/Vx/Vy/Vlo/Vhi/Vlen', substr($brut, $i * 24, 24));
        $pos = $t['lo'] + $t['hi'] * 4294967296;
        if ($pos + $t['len'] > $taille) return null;   // paquet tronqué
        $idx["{$t['z']}/{$t['x']}_{$t['y']}"] = [$pos, $t['len']];
    }
    return ['chemin' => $chemin, 'idx' => $idx, 'zmax' => $e['zmax'], 'tuile' => $e['tuile']];
}

/** Octets d'une tuile du paquet ('' si absente). */
function dd_tuile_paquet(array $p, int $z, int $x, int $y): string {
    $e = $p['idx']["{$z}/{$x}_{$y}"] ?? null;
    if (!$e) return '';
    $f = fopen($p['chemin'], 'rb');
    fseek($f, $e[0]);
    $b = fread($f, $e[1]);
    fclose($f);
    return (string) $b;
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

// Heure des MP en heure de Paris : le serveur est en UTC, le message affichait 20:33 pour 22:33.
function dd_heure_paris(): string {
    return (new DateTime('now', new DateTimeZone('Europe/Paris')))->format('d/m/Y à H:i');
}

function dd_signature(): string {
    return '*' . gethostname() . ', ' . dd_heure_paris() . '*';
}

// Panne : on garde la carte de la semaine précédente, on prévient, on sort en erreur.
function dd_echec(string $cause, string $detail): void {
    global $world;
    log_msg("ÉCHEC ({$cause}) : {$detail} — " . basename($GLOBALS["OUT_FILE"]) . " n'est PAS remplacé (carte précédente conservée).");
    dd_alerter($cause, "🗺️ **Carte Deep Desert de la semaine non mise à jour** ({$world})." . chr(10)
        . $detail . chr(10)
        . "La carte de la semaine précédente reste affichée. Le paquet local (`dd_fonds/{$world}.gtpk`) "
        . "manque ou n'est pas lisible, et les tuiles .webp de gaming.tools non plus. Remède : sur ton PC, "
        . '`bash tools/fetch_dd_fonds.sh`, puis déposer `dd_fonds/` sur le serveur. Journal : `dd_map_update.log`.' . chr(10)
        . dd_signature());
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
        . dd_signature());
    @unlink(DD_ALERTE_FICHIER);   // un essai ne doit pas masquer une vraie panne ensuite
    exit(0);
}

log_msg('══ Démarrage mise à jour carte Deep Desert ══');

$count = dd_week_count($REF_COUNT, $REF_DT);  // compteur hebdo
$world = dd_seed_world($count);                // deepdesert_1_NN (NN = count mod 12)
log_msg("Compteur hebdo : {$count} → tileset : {$world} (mod 12 = " . ((($count % 12) + 12) % 12) . ")");

$CDN_BASE = rtrim($optVal('cdn') ?: 'https://cdn-hosted.gaming.tools/dune/map-tiles', '/') . "/{$world}/" . DD_ZOOM_WEBP;

// ── Choix de la source : paquet local, contrôlé par 3 tuiles .webp ─────────────
$paquet = dd_lire_paquet("{$FONDS}/{$world}.gtpk");
$source = 'webp';
$perime = false;
if (!$paquet) {
    log_msg("Paquet local {$world}.gtpk absent ou illisible → tuiles .webp.");
} elseif ($paquet['zmax'] < DD_ZOOM_PAQUET) {
    log_msg("Paquet local sans zoom " . DD_ZOOM_PAQUET . " → tuiles .webp.");
    $paquet = null;
} else {
    $repondu = 0; $differe = [];
    foreach (DD_CONTROLES as [$x, $y]) {
        $r = fetch_url("{$CDN_BASE}/{$x}_{$y}.webp");
        if ($r['status'] !== 200 || $r['body'] === '') continue;
        $repondu++;
        if (md5($r['body']) !== md5(dd_tuile_paquet($paquet, DD_ZOOM_WEBP, $x, $y))) $differe[] = "{$x}_{$y}";
    }
    if ($repondu === 0) {
        // Les .webp ne répondent plus (gaming.tools les a retirées ?) : le paquet est la seule
        // source, et c'est précisément pour ça qu'on le garde. Rien à signaler.
        log_msg('Tuiles .webp injoignables : paquet local utilisé sans contrôle.');
        $source = 'paquet';
    } elseif ($differe) {
        log_msg('Paquet local PÉRIMÉ (tuiles différentes : ' . implode(', ', $differe) . ') → tuiles .webp cette semaine.');
        dd_alerter('fond-perime-' . $world, "🗺️ **Fond local de la carte Deep Desert périmé** ({$world})." . chr(10)
            . "Les tuiles de gaming.tools ne correspondent plus au paquet `dd_fonds/{$world}.gtpk` : un patch a sans doute "
            . "changé la carte de cette variante. Cette semaine, la carte est composée depuis les tuiles .webp (2048 px)." . chr(10)
            . "Remède : sur ton PC, `bash tools/fetch_dd_fonds.sh " . (int) substr($world, -2) . "`, puis déposer le paquet dans `dd_fonds/` sur le serveur." . chr(10)
            . dd_signature());
        $paquet = null;
        $perime = true;
    } else {
        log_msg("Paquet local à jour ({$repondu} tuile(s) .webp identiques).");
        $source = 'paquet';
    }
}

// ── Lecteur de tuiles selon la source ─────────────────────────────────────────
if ($source === 'paquet') {
    $grille = 1 << DD_ZOOM_PAQUET;
    $lire = function (int $x, int $y) use ($paquet): array {
        $b = dd_tuile_paquet($paquet, DD_ZOOM_PAQUET, $x, $y);
        return ['status' => $b === '' ? 404 : 200, 'body' => $b, 'type' => 'image/webp (paquet)'];
    };
} else {
    $grille = 1 << DD_ZOOM_WEBP;
    $lire = function (int $x, int $y) use ($CDN_BASE): array { return fetch_url("{$CDN_BASE}/{$x}_{$y}.webp"); };
}
$nbTuiles   = $grille * $grille;
$manqueMax  = intdiv($nbTuiles, 8);    // 8 sur 64 : même seuil que la composition côté navigateur (ddComposeShot)
$distinctes = intdiv($nbTuiles, 4);    // 16 sur 64 : en dessous, c'est une image de remplacement
$libSource  = $source === 'paquet' ? "paquet local, zoom " . DD_ZOOM_PAQUET : "tuiles .webp, zoom " . DD_ZOOM_WEBP;

// ── Dimensions réelles d'une tuile ───────────────────────────────────────────
$sample = $lire(0, 0);
if ($sample['status'] !== 200 || $sample['body'] === '') {
    dd_echec('tuile-0-0', "La tuile (0,0) ne répond pas (HTTP {$sample['status']}, {$libSource}).");
}

$sampleImg = @imagecreatefromstring($sample['body']);
if (!$sampleImg) {
    dd_echec('tuile-illisible', "La tuile (0,0) n'est pas une image lisible (type annoncé : « {$sample['type']} »).");
}
$tileW  = imagesx($sampleImg);
$tileH  = imagesy($sampleImg);
imagedestroy($sampleImg);

$totalW = $grille * $tileW;
$totalH = $grille * $tileH;
log_msg("Source : {$libSource} — tuile {$tileW}×{$tileH} px → image finale {$totalW}×{$totalH} px");

// ── Canvas ───────────────────────────────────────────────────────────────────
$canvas = imagecreatetruecolor($totalW, $totalH);
if (!$canvas) {
    log_msg('ERREUR : impossible de créer le canvas');
    exit(1);
}

// Fond sable neutre (au cas où une tuile manque)
$sand = imagecolorallocate($canvas, 210, 175, 120);
imagefill($canvas, 0, 0, $sand);

// ── Lecture et composition ───────────────────────────────────────────────────
$ok = 0; $fail = 0; $vides = 0; $empreintes = [];
for ($y = 0; $y < $grille; $y++) {
    for ($x = 0; $x < $grille; $x++) {
        $r = $lire($x, $y);
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
$nbDistinctes = count($empreintes);
log_msg("Tuiles : {$ok} OK, {$fail} manquantes, {$vides} vides, {$nbDistinctes} distinctes (sur {$nbTuiles})");

if ($fail + $vides > $manqueMax) {
    imagedestroy($canvas);
    dd_echec('tuiles-manquantes', "{$fail} tuile(s) manquante(s) ou illisible(s) et {$vides} vide(s) sur {$nbTuiles} "
        . "(tolérance : {$manqueMax}, {$libSource}).");
}
if ($nbDistinctes < $distinctes) {
    imagedestroy($canvas);
    dd_echec('tuiles-identiques', "Seulement {$nbDistinctes} tuile(s) différente(s) sur {$nbTuiles} ({$libSource}) : "
        . 'sans doute une image de remplacement.');
}

// ── Sauvegarde JPEG : fichier temporaire, puis remplacement ──────────────────
// Écrire directement dans deep_desert.jpg laissait une image tronquée en cas d'erreur
// d'écriture ; le renommage est atomique sur le même disque.
$tmp = $OUT_FILE . '.tmp';
if (!imagejpeg($canvas, $tmp, 85) || !rename($tmp, $OUT_FILE)) {
    imagedestroy($canvas);
    @unlink($tmp);
    dd_echec('ecriture', "Impossible d'écrire {$OUT_FILE} (droits du dossier ?).");
}
imagedestroy($canvas);
@chmod($OUT_FILE, 0664);   // un fichier recréé par PHP arrive en 644 : WinSCP et les crons ne pourraient plus le remplacer

$size = round(filesize($OUT_FILE) / 1024);
log_msg("✓ " . basename($OUT_FILE) . " sauvegardé — {$size} Ko ({$totalW}×{$totalH})");
// Paquet périmé : la carte est faite, mais le problème demeure — le MP repartira chaque
// semaine tant que le paquet n'est pas remplacé.
if (!$perime && file_exists(DD_ALERTE_FICHIER)) { @unlink(DD_ALERTE_FICHIER); log_msg('(panne précédente résolue)'); }
log_msg('══ Terminé ══');
