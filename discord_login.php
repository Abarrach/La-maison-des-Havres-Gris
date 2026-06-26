<?php
// ============================================================
//  discord_login.php — démarre le flux "Se connecter avec Discord"
//
//  Génère un paramètre `state` anti-CSRF (stocké en session) puis
//  redirige vers l'écran d'autorisation Discord. On ne demande que
//  le scope `identify` : l'appartenance à la guilde et les rôles sont
//  vérifiés côté serveur via le BOT TOKEN (le bot est déjà membre).
// ============================================================

require_once __DIR__ . '/discord_oauth.php';

$cfg = dco_config();
if (!$cfg) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Connexion Discord non configurée (discord_oauth_config.php absent sur le serveur).";
    exit;
}

// State anti-CSRF, vérifié au retour dans discord_callback.php
$state = bin2hex(random_bytes(16));
$_SESSION['oauth_state'] = $state;

// prompt=none → pas de réaffichage de l'écran d'autorisation pour les membres
// déjà autorisés (le défaut Discord est "consent", qui le remontre à chaque fois).
// Au tout premier passage (pas encore autorisé), Discord renvoie une erreur
// `consent_required` ; discord_callback.php relance alors avec ?force=1 pour
// afficher l'écran UNE fois.
$force = isset($_GET['force']);

$params = http_build_query([
    'client_id'     => $cfg['client_id'],
    'redirect_uri'  => $cfg['redirect_uri'],
    'response_type' => 'code',
    'scope'         => 'identify',
    'state'         => $state,
    'prompt'        => $force ? 'consent' : 'none',
]);

header('Location: https://discord.com/oauth2/authorize?' . $params, true, 302);
exit;
