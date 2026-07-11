<?php
// ============================================================
//  SONDE de diagnostic — à ouvrir dans le navigateur sur le serveur
//  (https://.../epice/discord_probe.php) AVANT de brancher l'URL
//  d'interactions chez Discord.
//
//  Vérifie que tout le nécessaire est présent pour l'endpoint :
//   - extension sodium (vérif signature Ed25519 des requêtes Discord)
//   - extension cURL (appels à l'API Discord)
//   - fichier de config + bot_token renseigné
//   - dossier data/ accessible en écriture
//
//  ⚠ À SUPPRIMER du serveur une fois le bot en place (ne pas laisser
//     traîner un fichier de diagnostic public).
// ============================================================

header('Content-Type: text/plain; charset=utf-8');

function line($ok, $label, $detail = '') {
    echo ($ok ? '[OK]   ' : '[KO]   ') . $label . ($detail !== '' ? "  ->  $detail" : '') . "\n";
}

echo "=== Sonde bot Sorties Discord ===\n\n";
echo "PHP version           : " . PHP_VERSION . "\n\n";

// 1. sodium (signature Ed25519)
$hasSodium = function_exists('sodium_crypto_sign_verify_detached');
line($hasSodium, "Extension sodium (signature Ed25519)",
    $hasSodium ? "OK" : "ABSENTE — installer php-sodium (ex: apt install php-sodium puis recharger php-fpm)");

// 2. cURL
$hasCurl = function_exists('curl_init');
line($hasCurl, "Extension cURL (API Discord)", $hasCurl ? "OK" : "ABSENTE — installer php-curl");

// 3. config
$cfgPath = __DIR__ . '/discord_sortie_config.php';
$hasCfg  = file_exists($cfgPath);
line($hasCfg, "Fichier discord_sortie_config.php", $hasCfg ? "présent" : "ABSENT — copier discord_sortie_config.example.php");

if ($hasCfg) {
    $cfg = require $cfgPath;
    $tokenOk = !empty($cfg['bot_token']) && strpos($cfg['bot_token'], 'COLLE_TON') === false;
    line($tokenOk, "bot_token renseigné", $tokenOk ? "OK" : "à remplir dans discord_sortie_config.php");
    line(!empty($cfg['public_key']), "public_key présente", $cfg['public_key'] ?? '');
    line(!empty($cfg['app_id']),     "app_id présent",     $cfg['app_id'] ?? '');
    echo "       guild_id            : " . ($cfg['guild_id'] !== '' ? $cfg['guild_id'] : "(vide → commande globale)") . "\n";
}

// 4. data/ accessible en écriture (test réel, pas seulement is_writable() qui peut mentir
// selon les ACL/le user effectif de PHP-FPM)
$dataDir = __DIR__ . '/data';
$testFile = $dataDir . '/discord_probe_test.tmp';
$writeOk = @file_put_contents($testFile, 'probe ' . date('c')) !== false;
if ($writeOk) @unlink($testFile);
line($writeOk, "Écriture réelle dans data/ (fichier de test)",
    $writeOk ? "OK — www-data (uid=" . (function_exists('posix_geteuid') ? posix_geteuid() : '?') . ") peut écrire" : "ÉCHEC — droits insuffisants sur epice/data/ pour l'utilisateur exécutant PHP");

// 5. Le journal existe-t-il déjà, et est-il lisible ?
$logFile = $dataDir . '/discord_sortie.log';
if (file_exists($logFile)) {
    echo "\n--- Dernières lignes de discord_sortie.log ---\n";
    $lines = @file($logFile);
    echo implode('', array_slice($lines ?: [], -20));
} else {
    echo "\n(discord_sortie.log n'existe pas encore — aucune requête n'a atteint ce point du code jusqu'ici)\n";
}

echo "\n=== Fin ===\n";
echo "Quand tout est [OK], renseigne l'URL d'interactions chez Discord puis supprime ce fichier.\n";
