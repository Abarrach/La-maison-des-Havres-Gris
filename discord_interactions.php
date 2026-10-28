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
//   - composants tpari/tparim/tparimes → epice/discord_paris.php (paris des tournois PvP)
//   - /carte (+ autocomplétion)     → discord_carte.php         (carte Deep Desert de la semaine)
//   - /objet, clic droit « Fiches objets », objet_pub: → discord_objet.php (fiches d'objets)
//   - /decret + menu decret_choix   → discord_decret.php        (sondage des décrets du Landsraad)
//   - /aide, clic droit « Aide du bot », aide_pub → discord_aide.php (tout ce que sait faire le bot)
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

    // Type 4 = AUTOCOMPLÉTION (Discord interroge l'app pendant que l'utilisateur tape).
    // Il porte le même `data.name` qu'une slash command, donc même routage — mais il
    // attend une réponse d'un type différent (8), gérée par le handler.
    if ($type === 2 || $type === 4) {
        $name = $body['data']['name'] ?? '';
        if ($name === 'sortie')   return 'sortie';
        if ($name === 'commande') return 'commande';
        if ($name === 'plan')     return 'plan';
        if ($name === 'carte')    return 'carte';
        if ($name === 'decret')   return 'decret';
        if ($name === 'aide' || $name === 'Aide du bot') return 'aide';   // + clic droit sur un membre
        // `/objet` et le clic droit « Fiches objets » (commande de message, data.type 3).
        if ($name === 'objet' || $name === 'Fiches objets') return 'objet';
        return null;
    }

    if ($type === 3 || $type === 5) {
        $cid = (string)($body['data']['custom_id'] ?? '');
        // Bouton « Publier dans le salon » des fiches objets (cf. discord_objet.php).
        if (strpos($cid, 'objet_pub:') === 0) return 'objet';
        // Menu du sondage des décrets (cf. discord_decret.php).
        if (strpos($cid, 'decret_') === 0) return 'decret';
        // Bouton « Publier dans le salon » de /aide (cf. discord_aide.php).
        if (strpos($cid, 'aide_') === 0) return 'aide';
        // Paris des tournois PvP (cf. epice/discord_paris.php) : boutons du message de
        // paris (tpari:, tparimes:) et son formulaire (tparim:). Les messages déjà
        // postés gardent ces boutons : ne jamais retirer ces préfixes.
        if (preg_match('/^tpari(m|mes)?:/', $cid)) return 'paris';
        // Sortie : préfixes existants (cf. epice/discord_sortie.php)
        $sortiePrefixes = [
            'signup:', 'present:', 'maybe:', 'absent:', 'unsignup:',
            'chef:', 'edit:', 'delok:', 'del:',
            'sortie_edit_modal:', 'sortie_create_modal',
            // Sélecteur de création par catégories (boutons + menu déroulant).
            // ⚠ Le panneau `/sortie panneau` est un message PERMANENT : ces préfixes
            // doivent rester routés indéfiniment, sinon les boutons déjà épinglés
            // cessent de répondre du jour où on les retirerait d'ici.
            'newcat:', 'newsub:', 'newpick:', 'newtype', 'newback',
            'creneaux:',
        ];
        foreach ($sortiePrefixes as $p) {
            if (strpos($cid, $p) === 0) return 'sortie';
        }
        // FILET : tout composant posé sur un encart de sortie a un custom_id de la
        // forme "<action>:<id de sortie>", et les ids de sortie sont "sortie_<horodatage>".
        // Sans ce filet, ajouter un composant à l'encart SANS penser à cette liste-ci
        // renvoie un 400 et Discord affiche « n'a pas répondu à temps » — le handler
        // n'est jamais atteint, son journal reste muet, et le vrai coupable est
        // invisible. C'est exactement ce qui est arrivé au menu de créneaux le
        // 2026-09-19 : une liste de plus, tenue à distance du code qui la remplit.
        if (preg_match('/:sortie_\d+$/', $cid)) return 'sortie';
        // Commande : namespace réservé pour le lot 3+ (pas encore de handler).
        if (strpos($cid, 'cmd_') === 0) return 'commande';
        return null;
    }

    return null;
}

/**
 * Âge de l'interaction au moment où NOTRE code la reçoit.
 *
 * L'identifiant Discord est un « snowflake » : ses bits de poids fort portent la date de
 * création, à la milliseconde. On peut donc comparer l'heure de naissance de l'interaction
 * à l'instant où PHP la traite — c'est la seule façon de distinguer deux causes qu'on
 * confondait jusqu'ici :
 *   âge faible + traitement lent  → le temps se perd dans NOTRE code ;
 *   âge déjà élevé                → il s'est perdu AVANT (réseau, TLS, nginx, file
 *                                   d'attente php-fpm), et chercher dans le handler est
 *                                   une perte de temps.
 * Mesuré le 2026-10-20 : un traitement complet prend 3 ms. Un dépassement des 3 s de
 * Discord ne peut donc pas venir du handler.
 */
function interaction_age_ms(array $body): ?int {
    $id = (string)($body['id'] ?? '');
    if ($id === '' || !ctype_digit($id)) return null;
    if (PHP_INT_SIZE < 8) return null;              // décalage 22 bits : exige du 64 bits
    $ts = ((int)$id >> 22) + 1420070400000;         // epoch Discord
    return (int)round(microtime(true) * 1000) - $ts;
}

$route = detect_route($body);
dispatcher_log('type=' . $type
    . ' name=' . ($body['data']['name'] ?? '-')
    . ' custom_id=' . ($body['data']['custom_id'] ?? '-')
    . ' → route=' . ($route ?? 'inconnue')
    . ' âge=' . (interaction_age_ms($body) ?? '?') . 'ms');

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

if ($route === 'plan') {
    require __DIR__ . '/discord_plan.php';
    exit;
}

if ($route === 'carte') {
    require __DIR__ . '/discord_carte.php';
    exit;
}

if ($route === 'objet') {
    require __DIR__ . '/discord_objet.php';
    exit;
}

if ($route === 'decret') {
    require __DIR__ . '/discord_decret.php';
    exit;
}

if ($route === 'aide') {
    require __DIR__ . '/discord_aide.php';
    exit;
}

if ($route === 'paris') {
    require __DIR__ . '/epice/discord_paris.php';
    exit;
}

// Type ou route non gérée : on répond 400 (Discord retentera au besoin).
dispatcher_log('route inconnue → 400');
http_response_code(400);
echo 'type/route non géré';
exit;
