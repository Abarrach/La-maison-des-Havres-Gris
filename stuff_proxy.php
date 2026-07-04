<?php
/**
 * stuff_proxy.php — Source de données de l'Optimiseur de stuff
 *
 * ⚠ Cloudflare bloque l'IP datacenter du serveur sur gaming.tools (challenge JS
 *   « Just a moment… », 403) — comme dd_proxy.php. On ne peut donc PAS compter sur
 *   le fetch live depuis la prod. La source réelle est un SNAPSHOT embarqué,
 *   généré depuis une machine non bloquée (IP résidentielle) :
 *     • stuff_data.json     → liste compacte des items (armes/armures/augments/utilitaires)
 *     • stuff_recipes.json  → recettes (ingrédients + quantités) par id
 *   Régénérer après chaque patch du jeu avec tools/build_stuff_snapshot.js.
 *
 * Le proxy reste HYBRIDE : il TENTE le live (au cas où le serveur serait un jour
 * débloqué / mis derrière un proxy sortant), et retombe sur le snapshot sinon.
 *
 * Format source gaming.tools = « flatted » (.d.json) : tableau plat où chaque
 * valeur de champ est un INDEX vers une autre entrée (cf. dd_proxy.php).
 *
 * Endpoints :
 *   GET stuff_proxy.php            → liste compacte
 *   GET stuff_proxy.php?id=xxxx    → détail d'un item (recette)
 *   GET stuff_proxy.php?debug=1    → diagnostic
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

const STUFF_LOCALE   = 'fr'; // langue des données gaming.tools (fr/en/de/es) — on joue en FR
const STUFF_CDN      = 'https://cdn-hosted.gaming.tools/dune/data/' . STUFF_LOCALE;
const STUFF_CACHETTL = 24 * 3600; // 24 h
$listCache    = __DIR__ . '/stuff_cache_list.json';
$skillsCache  = __DIR__ . '/stuff_cache_skills.json';
$snapshotList = __DIR__ . '/stuff_data.json';     // snapshot embarqué (committé)
$snapshotRec  = __DIR__ . '/stuff_recipes.json';  // snapshot recettes (committé)
$snapshotSkl  = __DIR__ . '/stuff_skills.json';   // snapshot capacités/techniques (committé)
$cacheDir     = __DIR__ . '/stuff_cache';

const STUFF_GROUPS = ['weapons', 'garment', 'augment', 'utility'];

// ── HTTP (tentative live) ─────────────────────────────────────────────────────
function stuff_http_get(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_ENCODING       => '',
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Referer: https://dune.gaming.tools/items',
            'Origin: https://dune.gaming.tools',
        ],
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'body' => is_string($body) ? $body : '', 'err' => $err];
}

/** Résolveur format « flatted » (.d.json). */
function stuff_resolve(array $flat, $i, int $depth = 0) {
    if ($depth > 18) return null;
    if (!is_int($i)) return $i;
    if (!array_key_exists($i, $flat)) return $i;
    $v = $flat[$i];
    if (is_array($v)) {
        $out = [];
        foreach ($v as $k => $ref) $out[$k] = stuff_resolve($flat, $ref, $depth + 1);
        return $out;
    }
    return $v;
}

function stuff_compact_stats($stats): array {
    if (!is_array($stats)) return [];
    $out = [];
    foreach ($stats as $s) {
        if (!is_array($s) || !isset($s['key'])) continue;
        $out[] = ['k' => $s['key'], 'n' => $s['name'] ?? $s['key'], 'v' => $s['value'] ?? null,
                  'f' => $s['format'] ?? null, 't' => $s['type'] ?? null];
    }
    return $out;
}

// Construit la liste compacte à partir d'un items.d.json live (flatted).
function stuff_build_list(array $flat): array {
    $items = [];
    foreach ($flat[0] as $idx) {
        $it = stuff_resolve($flat, $idx);
        if (!is_array($it)) continue;
        $cats = $it['categories'] ?? [];
        if (!is_array($cats) || !$cats) continue;
        $group = null;
        foreach ($cats as $c) {
            $p = explode('/', $c);
            if (($p[0] ?? '') === 'items' && in_array($p[1] ?? '', STUFF_GROUPS, true)) { $group = $p[1]; break; }
        }
        if ($group === null) continue;
        $sub = $group;
        foreach ($cats as $c) {
            $p = explode('/', $c);
            if (($p[1] ?? '') === $group && count($p) > 2) {
                $cand = implode('/', array_slice($p, 1));
                if (strlen($cand) > strlen($sub)) $sub = $cand;
            }
        }
        $items[] = ['id' => $it['id'] ?? '', 'name' => $it['name'] ?? '?', 'icon' => $it['iconPath'] ?? '',
                    'tier' => $it['tier'] ?? null, 'rarity' => $it['rarity'] ?? null,
                    'group' => $group, 'cat' => $sub, 'stats' => stuff_compact_stats($it['stats'] ?? [])];
    }
    return $items;
}

// ════════════════════════════════════════════════════════════════════════════
// DEBUG
// ════════════════════════════════════════════════════════════════════════════
if (isset($_GET['debug'])) {
    $r = stuff_http_get(STUFF_CDN . '/items.d.json');
    echo json_encode([
        'live_status'    => $r['status'],
        'live_bytes'     => strlen($r['body']),
        'live_note'      => $r['status'] === 200 ? 'live OK' : 'live bloqué (403 Cloudflare attendu en prod) → snapshot',
        'snapshot_list'  => file_exists($snapshotList) ? round(filesize($snapshotList)/1024) . ' Ko' : 'ABSENT',
        'snapshot_recip' => file_exists($snapshotRec)  ? round(filesize($snapshotRec)/1024)  . ' Ko' : 'ABSENT',
        'cache_list'     => file_exists($listCache) ? (time() - filemtime($listCache)) . 's old' : 'absent',
        'php'            => PHP_VERSION,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// ════════════════════════════════════════════════════════════════════════════
// SKILLS (capacités & techniques) : ?skills=1
// ════════════════════════════════════════════════════════════════════════════
if (isset($_GET['skills'])) {
    if (file_exists($skillsCache) && (time() - filemtime($skillsCache)) < STUFF_CACHETTL) {
        echo file_get_contents($skillsCache); exit;
    }
    $r = stuff_http_get(STUFF_CDN . '/skills.d.json');
    if ($r['status'] === 200) {
        $flat = json_decode($r['body'], true);
        $arr  = is_array($flat) ? stuff_resolve($flat, 0) : null;
        if (is_array($arr)) {
            $skills = [];
            foreach ($arr as $s) {
                if (!is_array($s) || empty($s['id']) || empty($s['name'])) continue;
                $st = [];
                foreach (($s['stats'] ?? []) as $x) {
                    $st[] = ['lvl' => $x['level'] ?? 1, 'k' => $x['key'] ?? '', 'n' => $x['name'] ?? '',
                             'v' => $x['value'] ?? null, 'f' => $x['format'] ?? null, 'op' => $x['operation'] ?? null];
                }
                $skills[] = ['id' => $s['id'], 'name' => $s['name'], 'icon' => $s['iconPath'] ?? '',
                             'type' => $s['skillType'] ?? '', 'tree' => $s['skillTree'] ?? '',
                             'maxLevel' => $s['maxLevel'] ?? 1, 'stats' => $st];
            }
            if (count($skills) > 20) {
                $out = json_encode(['mode' => 'live', 'icon_base' => 'https://cdn-hosted.gaming.tools/dune/images',
                                    'count' => count($skills), 'skills' => $skills], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                file_put_contents($skillsCache, $out);
                echo $out; exit;
            }
        }
    }
    if (file_exists($snapshotSkl)) { $s = file_get_contents($snapshotSkl); file_put_contents($skillsCache, $s); echo $s; exit; }
    if (file_exists($skillsCache)) { echo file_get_contents($skillsCache); exit; }
    echo json_encode(['skills' => [], 'note' => 'Capacités/techniques indisponibles.']);
    exit;
}

// ════════════════════════════════════════════════════════════════════════════
// DÉTAIL : ?id=xxxx
// ════════════════════════════════════════════════════════════════════════════
if (isset($_GET['id'])) {
    $id = preg_replace('/[^a-z0-9_]/i', '', (string) $_GET['id']);
    if ($id === '') { http_response_code(400); echo json_encode(['error' => 'id invalide']); exit; }

    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
    $f = $cacheDir . '/' . $id . '.json';
    if (file_exists($f) && (time() - filemtime($f)) < STUFF_CACHETTL) { echo file_get_contents($f); exit; }

    // 1) tentative live
    $r = stuff_http_get(STUFF_CDN . '/items/' . $id . '.d.json');
    if ($r['status'] === 200) {
        $flat = json_decode($r['body'], true);
        $root = is_array($flat) ? stuff_resolve($flat, 0) : null;
        if (is_array($root)) {
            $recipes = [];
            foreach (($root['recipes'] ?? []) as $rec) {
                $first = ($rec['qualityLevels'] ?? [])[0] ?? null;
                $ings = [];
                foreach (($first['ingredients'] ?? []) as $ing) {
                    $e = $ing['entity'] ?? [];
                    $ings[] = ['id' => $e['id'] ?? '', 'name' => $e['name'] ?? '?',
                               'icon' => $e['iconPath'] ?? '', 'qty' => $ing['quantity'] ?? 0];
                }
                if ($ings) $recipes[] = ['output' => $rec['outputQuantity'] ?? 1, 'ingredients' => $ings];
            }
            $out = json_encode([
                'id' => $root['id'] ?? $id, 'name' => $root['name'] ?? '',
                'description' => $root['description'] ?? '', 'tier' => $root['tier'] ?? null,
                'rarity' => $root['rarity'] ?? null, 'vendorPrice' => $root['baseBuyFromVendorPrice'] ?? null,
                'stats' => stuff_compact_stats($root['stats'] ?? []), 'recipes' => $recipes,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            file_put_contents($f, $out);
            echo $out;
            exit;
        }
    }

    // 2) repli snapshot recettes
    if (file_exists($snapshotRec)) {
        $rec = json_decode(file_get_contents($snapshotRec), true);
        if (is_array($rec) && isset($rec[$id])) {
            echo json_encode(array_merge(['id' => $id], $rec[$id]), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    echo json_encode(['id' => $id, 'recipes' => [], 'note' => 'Recette non disponible hors ligne.']);
    exit;
}

// ════════════════════════════════════════════════════════════════════════════
// LISTE compacte (défaut)
// ════════════════════════════════════════════════════════════════════════════
if (file_exists($listCache) && (time() - filemtime($listCache)) < STUFF_CACHETTL) {
    echo file_get_contents($listCache); exit;
}

// 1) tentative live
$r = stuff_http_get(STUFF_CDN . '/items.d.json');
if ($r['status'] === 200) {
    $flat = json_decode($r['body'], true);
    if (is_array($flat) && isset($flat[0]) && is_array($flat[0])) {
        $items = stuff_build_list($flat);
        if (count($items) > 50) {
            $out = json_encode([
                'generated_at' => gmdate('c'), 'mode' => 'live', 'source' => 'dune.gaming.tools',
                'icon_base' => 'https://cdn-hosted.gaming.tools/dune/images',
                'count' => count($items), 'items' => $items,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            file_put_contents($listCache, $out);
            echo $out;
            exit;
        }
    }
}

// 2) repli snapshot embarqué → on le copie en cache pour 24 h (évite de re-tenter le live à chaque hit)
if (file_exists($snapshotList)) {
    $snap = file_get_contents($snapshotList);
    file_put_contents($listCache, $snap);
    echo $snap;
    exit;
}

// 3) dernier cache même périmé
if (file_exists($listCache)) { echo file_get_contents($listCache); exit; }

http_response_code(502);
echo json_encode(['error' => 'Aucune donnée disponible (ni live, ni snapshot stuff_data.json).']);
