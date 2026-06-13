<?php
/**
 * dd_proxy.php — Proxy server-side pour les données Deep Desert
 *
 * Récupère, côté serveur (pas de CORS, pas de blocage Cloudflare), les données
 * de la SEMAINE EN COURS et les renvoie au client, mises en cache.
 *
 * Sources (toutes calées sur le MÊME seed actif, détecté via dd_seed.php) :
 *   1. API acteurs gaming.tools (seed=N)         → zones PVP/PVE, champs d'épice
 *                                                   (L/M/S), filons titane/stravidium
 *   2. Données carte gaming.tools (deepdesert_1_NN.d.json, format « flatted »)
 *                                                   → grottes, labos (ecolab), épaves
 *
 * ⚠ Avant : le proxy interrogeait seed=0 (une vieille semaine figée) → l'épice
 * affichée avait toujours 1-3 semaines de retard. Corrigé : on utilise le seed
 * actif réel (cf. dd_seed.php).
 *
 * GET  → sert le cache si frais (< 4h ET même seed), sinon refetch
 * POST → (compatibilité) accepte encore un payload client
 */

require_once __DIR__ . '/dd_seed.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$cacheFile = __DIR__ . '/dd_cache.json';
$cacheTTL  = 4 * 3600; // 4 heures

// ── Géométrie monde → cellule A1..I9 (identique à script.js, validé vs gridCell)
const DD_MINX = -1270000, DD_MAXX = 1168400;
const DD_MINY = -1270000, DD_MAXY = 1168400;
const DD_IMGW = 6144, DD_IMGH = 6120;

function dd_cell(float $x, float $y): string {
    $W = DD_MAXX - DD_MINX; $H = DD_MAXY - DD_MINY;
    $lng = ($x - DD_MINX) / $W * DD_IMGW;
    $lat = (DD_MAXY - $y) / $H * DD_IMGH;
    $r = min(8, (int) floor($lat / (DD_IMGH / 9)));
    $c = min(9, (int) floor($lng / (DD_IMGW / 9)) + 1);
    return substr('ABCDEFGHI', $r, 1) . $c;
}

function dd_http_get(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Referer: https://dune.gaming.tools/deep-desert',
            'Origin: https://dune.gaming.tools',
        ],
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'body' => is_string($body) ? $body : '', 'err' => $err];
}

/**
 * Résolveur du format « flatted » de gaming.tools (.d.json) : un grand tableau
 * plat où chaque valeur de champ est un INDEX vers une autre entrée du tableau.
 * $skip : clés à ne pas développer (ex. parentMarkers, lourd et inutile ici).
 */
function dd_flat_resolve(array $flat, $i, array $skip = [], int $depth = 0) {
    if ($depth > 14) return null;
    if (!is_int($i)) return $i;
    if (!array_key_exists($i, $flat)) return null;
    $v = $flat[$i];
    if (is_array($v)) {
        $out = [];
        foreach ($v as $k => $ref) {
            if (in_array($k, $skip, true)) { $out[$k] = null; continue; }
            $out[$k] = dd_flat_resolve($flat, $ref, $skip, $depth + 1);
        }
        return $out;
    }
    return $v;
}

/** Regroupe des nœuds (ore) en « champs » par grille spatiale → centroïdes + count. */
function dd_cluster(array $pts, float $bucket = 100000.0): array {
    $buckets = [];
    foreach ($pts as $p) {
        $bx = (int) floor(($p['x'] - DD_MINX) / $bucket);
        $by = (int) floor(($p['y'] - DD_MINY) / $bucket);
        $key = $bx . ':' . $by;
        if (!isset($buckets[$key])) $buckets[$key] = ['sx' => 0, 'sy' => 0, 'n' => 0];
        $buckets[$key]['sx'] += $p['x'];
        $buckets[$key]['sy'] += $p['y'];
        $buckets[$key]['n']  += 1;
    }
    $out = [];
    foreach ($buckets as $b) {
        $x = $b['sx'] / $b['n'];
        $y = $b['sy'] / $b['n'];
        $out[] = ['x' => round($x, 1), 'y' => round($y, 1), 'cell' => dd_cell($x, $y), 'count' => $b['n']];
    }
    return $out;
}

// ════════════════════════════════════════════════════════════════════════════
// POST : compatibilité — un client peut encore pousser un payload
// ════════════════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    if (!$data || (empty($data['zones']) && empty($data['layers']))) {
        http_response_code(400);
        echo json_encode(['error' => 'Payload invalide']);
        exit;
    }
    file_put_contents($cacheFile, $body);
    echo json_encode(['ok' => true]);
    exit;
}

// ════════════════════════════════════════════════════════════════════════════
// GET
// ════════════════════════════════════════════════════════════════════════════
$seed = dd_current_seed();

// ── Diagnostic : ?debug=1 → renvoie ce que le serveur reçoit des sources ─────
if (isset($_GET['debug'])) {
    $world = dd_seed_world($seed);
    $a = dd_http_get("https://dune-api-v2.gaming.tools/actors?world=deepdesert_1&seed={$seed}");
    $d = dd_http_get("https://cdn-hosted.gaming.tools/dune/data/en/maps/{$world}.d.json");
    $pg = function_exists('dd_seed_http_get') ? dd_seed_http_get('https://dune.gaming.tools/deep-desert') : '';
    echo json_encode([
        'seed'        => $seed,
        'seed_source' => ($pg !== '' ? 'page-ok' : 'page-FAIL→fallback'),
        'world'       => $world,
        'actors'      => ['status' => $a['status'], 'len' => strlen($a['body']), 'err' => $a['err'], 'head' => substr($a['body'], 0, 180)],
        'djson'       => ['status' => $d['status'], 'len' => strlen($d['body']), 'err' => $d['err'], 'head' => substr($d['body'], 0, 120)],
        'php'         => PHP_VERSION,
        'curl'        => function_exists('curl_init'),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Cache : valide si frais ET même seed que la semaine en cours ─────────────
if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTTL) {
    $cached = json_decode(file_get_contents($cacheFile), true);
    if (is_array($cached) && (int) ($cached['seed'] ?? -1) === $seed) {
        echo file_get_contents($cacheFile);
        exit;
    }
    // seed changé (reset hebdo) → on ignore le cache et on refetch
}

// ── 1. Acteurs (zones, épice, filons) ───────────────────────────────────────
$zones = [];
$spiceL = []; $spiceM = []; $spiceS = [];
$titaniumPts = []; $stravidiumPts = [];

$actorsRes = dd_http_get("https://dune-api-v2.gaming.tools/actors?world=deepdesert_1&seed={$seed}");
$actors    = ($actorsRes['status'] === 200) ? json_decode($actorsRes['body'], true) : null;

if (is_array($actors) && count($actors) > 100) {
    foreach ($actors as $a) {
        $type = $a['type'] ?? null;
        $mk   = $a['map_marker_id'] ?? null;
        $x = (float) ($a['x'] ?? 0); $y = (float) ($a['y'] ?? 0);
        if ($type === 'BP_SecurityZone_C') {
            $zones[] = [
                'zoneType' => $a['metadata']['Type'] ?? 'Unknown',
                'bounds'   => $a['metadata']['Bounds'] ?? [],
                'cx' => $x, 'cy' => $y,
            ];
        } elseif ($mk === 'spicefieldlarge') {
            $spiceL[] = ['x' => $x, 'y' => $y, 'cell' => dd_cell($x, $y)];
        } elseif ($mk === 'spicefieldmedium') {
            $spiceM[] = ['x' => $x, 'y' => $y, 'cell' => dd_cell($x, $y)];
        } elseif ($mk === 'spicefieldsmall') {
            $spiceS[] = ['x' => $x, 'y' => $y, 'cell' => dd_cell($x, $y)];
        } elseif ($mk === 'titaniumore') {
            $titaniumPts[] = ['x' => $x, 'y' => $y];
        } elseif ($mk === 'stravidiumore') {
            $stravidiumPts[] = ['x' => $x, 'y' => $y];
        }
    }
}

// ── 2. POI carte (.d.json) : grottes, labos, épaves ─────────────────────────
$caves = []; $ecolabs = []; $shipwrecks = [];
$world  = dd_seed_world($seed);
$djRes  = dd_http_get("https://cdn-hosted.gaming.tools/dune/data/en/maps/{$world}.d.json");
$flat   = ($djRes['status'] === 200) ? json_decode($djRes['body'], true) : null;

if (is_array($flat) && isset($flat[0])) {
    $root = dd_flat_resolve($flat, 0, ['parentMarkers']);
    $locs = $root['locations'] ?? [];
    if (is_array($locs)) {
        foreach ($locs as $l) {
            if (($l['locationType'] ?? '') !== 'marker') continue;
            $icon = $l['iconId'] ?? '';
            $loc  = $l['location'] ?? null;
            if (!is_array($loc)) continue;
            $x = (float) ($loc['x'] ?? 0); $y = (float) ($loc['y'] ?? 0);
            $entry = [
                'x' => $x, 'y' => $y,
                'cell' => $l['gridCell'] ?? dd_cell($x, $y),
                'name' => $l['name'] ?? '',
            ];
            if     ($icon === 'cave')      $caves[]      = $entry;
            elseif ($icon === 'ecolab')    $ecolabs[]    = $entry;
            elseif ($icon === 'shipwreck') $shipwrecks[] = $entry;
        }
    }
}

// ── Échec total des deux sources → servir le cache (même périmé) ─────────────
$gotActors = is_array($actors) && count($actors) > 100;
$gotPoi    = is_array($flat) && isset($flat[0]);
if (!$gotActors && !$gotPoi) {
    if (file_exists($cacheFile)) { echo file_get_contents($cacheFile); exit; }
    http_response_code(502);
    echo json_encode(['error' => 'Sources gaming.tools indisponibles', 'seed' => $seed]);
    exit;
}

// Si l'épice (donnée volatile principale) a échoué mais qu'on a un cache du
// même seed, on préfère servir ce cache plutôt que de l'écraser par du partiel.
if (!$gotActors && file_exists($cacheFile)) {
    $cached = json_decode(file_get_contents($cacheFile), true);
    if (is_array($cached) && (int) ($cached['seed'] ?? -1) === $seed) {
        echo file_get_contents($cacheFile);
        exit;
    }
}

// ── Assemblage + cache ──────────────────────────────────────────────────────
$result = json_encode([
    'seed'         => $seed,
    'world'        => 'deepdesert_1',
    'tileset'      => $world,
    'generated_at' => gmdate('c'),
    'zones'        => $zones,
    // alias rétro-compat (ancien client lisait data.resources = grands champs)
    'resources'    => $spiceL,
    'layers'       => [
        'spice_large'  => $spiceL,
        'spice_medium' => $spiceM,
        'spice_small'  => $spiceS,
        'titanium'     => dd_cluster($titaniumPts),
        'stravidium'   => dd_cluster($stravidiumPts),
        'cave'         => $caves,
        'ecolab'       => $ecolabs,
        'shipwreck'    => $shipwrecks,
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

// On ne réécrit le cache que si au moins les acteurs OU les POI sont valides
file_put_contents($cacheFile, $result);
echo $result;
