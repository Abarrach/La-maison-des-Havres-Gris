<?php
// ============================================================
//  DISPATCHER — endpoint UNIQUE des interactions Discord
//
//  Discord n'autorise qu'une seule "Interactions Endpoint URL"
//  par application. Ce fichier reçoit TOUT ce que le bot envoie
//  (slash commands, boutons, modals, PING de validation), vérifie
//  la signature Ed25519 UNE SEULE FOIS, puis route vers le
//  handler approprié.
//
//  URL à déclarer chez Discord (portail dev → General Information
//  → "Interactions Endpoint URL") :
//      https://.../discord_interactions.php
//
//  Routes actuelles :
//   - /sortie + composants sortie   → epice/discord_sortie.php  (existant, inchangé)
//   - /commande + composants cmd_   → discord_commande.php      (lot 3+, pas encore livré)
//
//  Sécurité : chaque requête Discord est signée. On refuse (401)
//  tout ce qui n'est pas signé correctement. La clé publique est
//  dans epice/discord_sortie_config.php (même app que /sortie).
// ============================================================

// ---- Config -------------------------------------------------
$CFG_PATH = __DIR__ . '/epice/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { http_response_code(500); echo 'config absente'; exit; }
$CFG = require $CFG_PATH;

// ---- Journal ------------------------------------------------
// On loggue au même endroit que discord_sortie.php (epice/data/ est le seul
// dossier confirmé accessible en écriture pour www-data, cf. commentaire
// original dans discord_sortie.php). Fichier distinct pour distinguer le
// niveau "dispatcher" du niveau "handler".
function dispatcher_log($msg) {
    $dir = __DIR__ . '/epice/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    @file_put_contents($dir . '/discord_interactions.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
}

// Filet erreurs FATALES (sinon Discord affiche "Une erreur s'est produite" sans trace).
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        dispatcher_log('FATAL (shutdown) : ' . $err['message'] . ' @ ' . $err['file'] . ':' . $err['line']);
    }
});

// ============================================================
//  1) VÉRIFICATION DE LA SIGNATURE (une seule fois pour tout le pipeline)
// ============================================================
$raw       = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_SIGNATURE_ED25519']   ?? '';
$timestamp = $_SERVER['HTTP_X_SIGNATURE_TIMESTAMP'] ?? '';

dispatcher_log('requête reçue : méthode=' . ($_SERVER['REQUEST_METHOD'] ?? '?')
    . ' longueur_body=' . strlen($raw)
    . ' sig=' . ($signature !== '' ? 'présente' : 'absente'));

if (!function_exists('sodium_crypto_sign_verify_detached')) {
    dispatcher_log('FATAL: extension sodium absente — signature non vérifiable');
    http_response_code(500); echo 'sodium manquant'; exit;
}
if ($signature === '' || $timestamp === '') {
    dispatcher_log('signature manquante (en-têtes X-Signature-Ed25519 / X-Signature-Timestamp absents)');
    http_response_code(401); echo 'signature manquante'; exit;
}

$sig_ok = false;
try {
    $sig_ok = sodium_crypto_sign_verify_detached(
        sodium_hex2bin($signature),
        $timestamp . $raw,
        sodium_hex2bin($CFG['public_key'])
    );
} catch (Throwable $e) {
    dispatcher_log('Erreur vérif signature: ' . $e->getMessage());
}
if (!$sig_ok) {
    dispatcher_log('signature invalide (public_key configurée ? longueur=' . strlen((string)($CFG['public_key'] ?? '')) . ')');
    http_response_code(401); echo 'signature invalide'; exit;
}

// ============================================================
//  2) PING (poignée de main de validation de l'URL par Discord)
// ============================================================
header('Content-Type: application/json; charset=utf-8');
$body = json_decode($raw, true) ?? [];
$type = $body['type'] ?? 0;

if ($type === 1) {
    dispatcher_log('PING → PONG');
    echo json_encode(['type' => 1]);
    exit;
}

// ============================================================
//  3) ROUTAGE
// ============================================================
// On identifie la route par :
//   - type 2 (slash command)          → data.name  (ex: "sortie", "commande")
//   - type 3 (composant : bouton/select) → prefix du data.custom_id
//   - type 5 (modal submit)           → prefix du data.custom_id
function detect_route(array $body): ?string {
    $type = $body['type'] ?? 0;

    if ($type === 2) {
        $name = $body['data']['name'] ?? '';
        if ($name === 'sortie')   return 'sortie';
        if ($name === 'commande') return 'commande';
        return null;
    }

    if ($type === 3 || $type === 5) {
        $cid = (string)($body['data']['custom_id'] ?? '');
        // Sortie : préfixes existants (cf. epice/discord_sortie.php)
        $sortiePrefixes = [
            'signup:', 'present:', 'maybe:', 'absent:', 'unsignup:',
            'chef:', 'edit:', 'delok:', 'del:',
            'pick:',   // tuile du sélecteur graphique de type d'activité
            'sortie_edit_modal:', 'sortie_create_modal',
        ];
        foreach ($sortiePrefixes as $p) {
            if (strpos($cid, $p) === 0) return 'sortie';
        }
        // Commande : namespace réservé pour le lot 3+ (pas encore de handler).
        if (strpos($cid, 'cmd_') === 0) return 'commande';
        return null;
    }

    return null;
}

$route = detect_route($body);
dispatcher_log('type=' . $type
    . ' name=' . ($body['data']['name'] ?? '-')
    . ' custom_id=' . ($body['data']['custom_id'] ?? '-')
    . ' → route=' . ($route ?? 'inconnue'));

// Marqueur consommé par les handlers pour NE PAS revérifier la signature
// (elle vient d'être validée ici). Voir epice/discord_sortie.php pour l'usage.
define('DUNE_INTERACTIONS_DISPATCHED', true);

if ($route === 'sortie') {
    require __DIR__ . '/epice/discord_sortie.php';
    exit;
}

if ($route === 'commande') {
    require __DIR__ . '/discord_commande.php';
    exit;
}

// Type ou route non gérée : on répond 400 (Discord retentera au besoin).
dispatcher_log('route inconnue → 400');
http_response_code(400);
echo 'type/route non géré';
exit;
