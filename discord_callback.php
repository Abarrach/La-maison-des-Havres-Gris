<?php
// ============================================================
//  discord_callback.php — retour Discord après autorisation
//
//  1. vérifie le `state` anti-CSRF
//  2. échange le `code` contre un access_token (client_secret)
//  3. récupère l'identité Discord (/users/@me)
//  4. vérifie l'appartenance à la guilde via le BOT TOKEN
//     → si pas membre : ACCÈS REFUSÉ
//  5. mappe l'identité Discord vers le pseudo du site (Excel)
//  6. pose la session + redirige (en posant le localStorage côté client)
// ============================================================

require_once __DIR__ . '/discord_oauth.php';

/** Affiche une page thématisée puis stoppe. */
function dco_page(string $icon, string $title, string $text, string $linkLabel, string $linkHref, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        . '<title>' . htmlspecialchars($title) . '</title></head>'
        . '<body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;'
        . 'min-height:100vh;background:#0a0603;color:#cda434;font-family:\'Segoe UI\',sans-serif;gap:20px;text-align:center;padding:20px;">'
        . '<div style="font-size:2.5rem;">' . $icon . '</div>'
        . '<div style="font-size:1.2rem;font-weight:600;text-transform:uppercase;letter-spacing:2px;">' . htmlspecialchars($title) . '</div>'
        . '<div style="color:#9a8050;font-size:0.95rem;max-width:460px;line-height:1.6;">' . $text . '</div>'
        . '<a href="' . htmlspecialchars($linkHref) . '" style="margin-top:10px;padding:11px 30px;'
        . 'background:linear-gradient(to bottom,#a67c33,#6b4a25);border:1px solid #d4a23b;border-radius:4px;'
        . 'color:#1a1007;font-weight:bold;text-decoration:none;text-transform:uppercase;font-size:12px;">'
        . htmlspecialchars($linkLabel) . '</a></body></html>';
    exit;
}

$cfg = dco_config();
if (!$cfg) {
    dco_page('⚙️', 'Configuration manquante', 'La connexion Discord n\'est pas encore configurée sur le serveur.', '← Accueil', 'index.html', 503);
}

// --- Erreur renvoyée par Discord ---
if (isset($_GET['error'])) {
    $err = $_GET['error'];
    // Avec prompt=none, si le membre n'a pas encore autorisé (ou n'est pas
    // connecté à Discord), Discord renvoie une erreur au lieu d'afficher l'écran.
    // → On relance UNE fois en demandant explicitement le consentement (force=1).
    if (in_array($err, ['consent_required', 'login_required', 'interaction_required'], true)) {
        header('Location: discord_login.php?force=1', true, 302);
        exit;
    }
    // Refus explicite de l'utilisateur (access_denied) ou autre.
    dco_page('✖️', 'Connexion annulée', 'Tu as refusé l\'autorisation Discord, ou une erreur est survenue.', '← Réessayer', 'index.html');
}

// --- 1. Vérification du state anti-CSRF ---
$state = $_GET['state'] ?? '';
$expected = $_SESSION['oauth_state'] ?? '';
unset($_SESSION['oauth_state']);
if ($state === '' || !hash_equals($expected, $state)) {
    dco_page('🛑', 'Session expirée', 'Le jeton de sécurité est invalide ou périmé. Relance la connexion depuis l\'accueil.', '← Accueil', 'index.html', 400);
}

$code = $_GET['code'] ?? '';
if ($code === '') {
    dco_page('🛑', 'Code manquant', 'Discord n\'a pas renvoyé de code d\'autorisation.', '← Accueil', 'index.html', 400);
}

// --- 2. Échange du code contre un access_token ---
$tok = dco_http_post_form(DCO_API . '/oauth2/token', [
    'client_id'     => $cfg['client_id'],
    'client_secret' => $cfg['client_secret'] ?? '',
    'grant_type'    => 'authorization_code',
    'code'          => $code,
    'redirect_uri'  => $cfg['redirect_uri'],
]);
if ($tok['code'] !== 200 || empty($tok['json']['access_token'])) {
    @error_log('Discord token échange échec HTTP ' . $tok['code']);
    dco_page('🛑', 'Échec de connexion', 'Impossible de finaliser l\'échange avec Discord. Réessaie dans un instant.', '← Accueil', 'index.html', 502);
}
$accessToken = $tok['json']['access_token'];

// --- 3. Identité Discord ---
$me = dco_http_get(DCO_API . '/users/@me', 'Bearer ' . $accessToken);
if ($me['code'] !== 200 || empty($me['json']['id'])) {
    dco_page('🛑', 'Identité illisible', 'Discord n\'a pas renvoyé ton profil. Réessaie.', '← Accueil', 'index.html', 502);
}
$discordId   = (string)$me['json']['id'];
$discordName = $me['json']['global_name'] ?? ($me['json']['username'] ?? '');

// --- 4. Vérification de l'appartenance à la guilde (bot token) ---
$member = dco_guild_member($cfg, $discordId);
if (!empty($member['error'])) {
    dco_page('⚠️', 'Vérification impossible', 'Le serveur n\'a pas pu vérifier ton appartenance à la guilde pour le moment (' . htmlspecialchars($member['error']) . '). Réessaie plus tard.', '← Accueil', 'index.html', 502);
}
if (!$member['in_guild']) {
    dco_page('🚫', 'Accès réservé à la guilde',
        'Ton compte Discord n\'est pas membre de la <strong>Maison des Havres Gris</strong>.<br>'
        . 'L\'accès au portail est réservé aux membres de la guilde.',
        '← Accueil', 'index.html', 403);
}

// Filtrage par RÔLE : présent sur le serveur ≠ accès au portail.
// (exclut p. ex. les invités ou les membres d'un autre jeu sans le rôle requis)
if (!dco_member_allowed($cfg, $member)) {
    dco_page('🚫', 'Accès non autorisé',
        'Ton compte Discord est bien sur le serveur, mais ne dispose pas du rôle requis '
        . 'pour accéder au portail (réservé aux membres de la guilde).',
        '← Accueil', 'index.html', 403);
}

// --- 5. Mapping Discord → pseudo du site (Excel pré-chargé) ---
$acct   = dco_resolve_account($discordId, $discordName);
$pseudo = $acct['pseudo'];
$role   = dco_compute_role($cfg, $pseudo, $member['roles']);

// --- 6. Session + pont localStorage côté client ---
dco_apply_session($pseudo, $role, $discordId);
// Force l'émission d'un NOUVEAU cookie de session avec la durée 30 j (sinon un
// cookie de session déjà présent serait réutilisé tel quel → resterait "Session").
// Bonus sécurité : anti-fixation de session.
session_regenerate_id(true);

header('Content-Type: text/html; charset=utf-8');
$pJson = json_encode($pseudo, JSON_UNESCAPED_UNICODE);
$rJson = json_encode($role);
echo '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Connexion…</title></head>'
   . '<body style="background:#0a0603;color:#cda434;font-family:sans-serif;text-align:center;padding-top:20vh;">'
   . 'Connexion réussie, redirection…'
   . '<script>'
   . 'localStorage.setItem("user", ' . $pJson . ');'
   . 'localStorage.setItem("role", ' . $rJson . ');'
   . 'location.replace("menu.html");'
   . '</script></body></html>';
exit;
