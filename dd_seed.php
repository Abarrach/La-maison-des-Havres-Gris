<?php
/**
 * dd_seed.php — Détection du seed Deep Desert ACTIF (semaine en cours)
 *
 * ⚠ Point clé : les numéros de seed de l'API gaming.tools NE SONT PAS des
 * compteurs hebdomadaires séquentiels (seeds 5 et 6 vides, 7-11 = semaines
 * passées, etc.). Aucune formule basée sur la date ne peut donc retrouver le
 * bon seed. La SEULE source fiable est ce que le frontend de gaming.tools
 * utilise lui-même : on lit la page deep-desert et on en extrait le seed actif.
 *
 * Vérifié : la page précharge
 *   actors?world=deepdesert_1&seed=4   (champs d'épice / ressources)
 *   .../maps/deepdesert_1_04.d.json    (POI : grottes, labos, épaves, tuiles)
 *
 * Utilisé par dd_proxy.php (épice/zones/POI) ET dd_map_update.php (tuiles).
 */

if (!defined('DD_SEED_CACHE')) define('DD_SEED_CACHE', __DIR__ . '/dd_seed.cache');
if (!defined('DD_SEED_TTL'))   define('DD_SEED_TTL', 30 * 60); // 30 min
// Repli ultime si gaming.tools est injoignable ET aucun cache : à mettre à jour
// manuellement au pire (sinon vieillit). Normalement jamais atteint.
if (!defined('DD_SEED_FALLBACK')) define('DD_SEED_FALLBACK', 4);

function dd_seed_http_get(string $url, int $timeout = 20): string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/json'],
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($status === 200 && is_string($body)) ? $body : '';
}

/** Lit le seed actif depuis la page gaming.tools (source de vérité). null si échec. */
function dd_detect_seed(): ?int {
    $html = dd_seed_http_get('https://dune.gaming.tools/deep-desert');
    if ($html === '') return null;
    // Priorité au tileset (le plus direct) : deepdesert_1_NN.d.json
    if (preg_match('/deepdesert_1_(\d{2})\.d\.json/', $html, $m)) {
        return (int) $m[1];
    }
    // Repli : lien de préchargement des acteurs (seed=N, &amp; possible)
    if (preg_match('/actors\?world=deepdesert_1&(?:amp;)?seed=(\d+)/', $html, $m)) {
        return (int) $m[1];
    }
    return null;
}

/**
 * Seed Deep Desert actif, avec cache 30 min + replis.
 * Chaîne : cache frais → scrape gaming.tools → cache périmé → repli baké.
 */
function dd_current_seed(): int {
    // 1. Cache frais
    if (is_file(DD_SEED_CACHE) && (time() - filemtime(DD_SEED_CACHE)) < DD_SEED_TTL) {
        $v = trim(@file_get_contents(DD_SEED_CACHE));
        if ($v !== '' && is_numeric($v)) return (int) $v;
    }
    // 2. Scrape la source de vérité
    $seed = dd_detect_seed();
    if ($seed !== null) {
        @file_put_contents(DD_SEED_CACHE, (string) $seed);
        return $seed;
    }
    // 3. Cache périmé (mieux que rien)
    if (is_file(DD_SEED_CACHE)) {
        $v = trim(@file_get_contents(DD_SEED_CACHE));
        if ($v !== '' && is_numeric($v)) return (int) $v;
    }
    // 4. Repli baké
    return DD_SEED_FALLBACK;
}

/** Nom du tileset / fichier de données pour un seed donné : deepdesert_1_NN */
function dd_seed_world(int $seed): string {
    return 'deepdesert_1_' . str_pad((string) ($seed % 100), 2, '0', STR_PAD_LEFT);
}
