<?php
/**
 * dd_proxy.php — Proxy server-side pour les données Deep Desert
 *
 * Fetch l'API gaming.tools côté serveur (pas de CORS), filtre zones + épices,
 * met en cache 4h, et retourne le JSON au client.
 *
 * GET  → sert le cache si < 4h, sinon fetch l'API et met à jour le cache
 * POST → (compatibilité) accepte encore les données du client si besoin
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$cacheFile = __DIR__ . '/dd_cache.json';
$cacheTTL  = 4 * 3600; // 4 heures

// ── Calcul du seed courant (même formule que script.js) ─────────────────────
// Référence : seed 12 = mardi 13 mai 2026 à 05:00 Europe/Paris (= 03:00 UTC)
$REF_SEED = 12;
$REF_TS   = gmmktime(3, 0, 0, 5, 13, 2026); // 2026-05-13 03:00:00 UTC

function currentSeed(): int {
    global $REF_SEED, $REF_TS;
    $diff = time() - $REF_TS;
    return max(1, $REF_SEED + (int) floor($diff / (7 * 24 * 3600)));
}

// ── POST : compatibilité — le client peut encore envoyer des données ─────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    if (!$data || empty($data['zones'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Payload invalide']);
        exit;
    }
    file_put_contents($cacheFile, $body);
    echo json_encode(['ok' => true]);
    exit;
}

// ── GET : sert le cache s'il est frais ──────────────────────────────────────
if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTTL) {
    echo file_get_contents($cacheFile);
    exit;
}

// ── Cache absent ou périmé → fetch server-side depuis gaming.tools ──────────
$apiUrl = 'https://dune-api-v2.gaming.tools/actors?world=deepdesert_1&seed=0';

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => [
        'Accept: application/json',
        'Referer: https://dune.gaming.tools/deep-desert',
        'Origin: https://dune.gaming.tools',
    ],
]);
$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// ── Si l'API échoue → servir le cache périmé (mieux que rien) ──────────────
if ($status !== 200 || !$body) {
    if (file_exists($cacheFile)) {
        echo file_get_contents($cacheFile);
    } else {
        http_response_code(502);
        echo json_encode(['error' => 'API gaming.tools indisponible', 'http' => $status]);
    }
    exit;
}

$actors = json_decode($body, true);
if (!is_array($actors) || count($actors) < 100) {
    // Réponse invalide ou vide → servir cache périmé si dispo
    if (file_exists($cacheFile)) {
        echo file_get_contents($cacheFile);
    } else {
        http_response_code(502);
        echo json_encode(['error' => 'Réponse API invalide ou vide']);
    }
    exit;
}

// ── Filtrage : zones de sécurité + champs d'épices ──────────────────────────
$zones     = [];
$resources = [];

foreach ($actors as $a) {
    if (!isset($a['type'])) continue;

    if ($a['type'] === 'BP_SecurityZone_C') {
        $zones[] = [
            'zoneType' => $a['metadata']['Type'] ?? 'Unknown',
            'bounds'   => $a['metadata']['Bounds'] ?? [],
            'cx'       => $a['x'] ?? 0,
            'cy'       => $a['y'] ?? 0,
        ];
    } elseif (isset($a['map_marker_id']) && $a['map_marker_id'] === 'spicefieldlarge') {
        $resources[] = [
            'markerId' => $a['map_marker_id'],
            'x'        => $a['x'] ?? 0,
            'y'        => $a['y'] ?? 0,
        ];
    }
}

// ── Sérialisation et mise en cache ──────────────────────────────────────────
$seed   = currentSeed();
$result = json_encode([
    'seed'         => $seed,
    'world'        => 'deepdesert_1',
    'generated_at' => gmdate('c'),
    'zones'        => $zones,
    'resources'    => $resources,
], JSON_UNESCAPED_SLASHES);

file_put_contents($cacheFile, $result);
echo $result;
