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

// 4. data/ accessible en écriture
$dataDir = __DIR__ . '/data';
$writable = is_dir($dataDir) && is_writable($dataDir);
line($writable, "Dossier data/ accessible en écriture",
    $writable ? "OK" : "le serveur web (www-data) doit pouvoir écrire data/debriefs.json");

echo "\n=== Fin ===\n";
echo "Quand tout est [OK], renseigne l'URL d'interactions chez Discord puis supprime ce fichier.\n";
