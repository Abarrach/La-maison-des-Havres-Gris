<?php
// ============================================================
// auth_epice.php — auth serveur partagée des endpoints épice
//   S'appuie sur la session du site (posée par /auth.php) :
//   $_SESSION['user'] + $_SESSION['role'].
//   Droits :
//     - membre connecté   : consultation (retours joueur, organisation)
//     - organisateur      : role=admin OU pseudo dans data/organizers.json
//     - admin             : gestion de la liste des organisateurs
// ============================================================

if (session_status() === PHP_SESSION_NONE) session_start();

function epice_user(): ?string { return $_SESSION['user'] ?? null; }
function epice_role(): string  { return $_SESSION['role'] ?? ''; }

function epice_organizers(): array {
    $f = __DIR__ . '/data/organizers.json';
    if (!file_exists($f)) return [];
    $a = json_decode(file_get_contents($f), true);
    return is_array($a) ? array_values(array_filter($a, 'is_string')) : [];
}

function epice_can_organize(): bool {
    if (epice_role() === 'admin') return true;
    $u = epice_user();
    if (!$u) return false;
    foreach (epice_organizers() as $o) { if (strcasecmp($o, $u) === 0) return true; }
    return false;
}

// Le membre courant est-il le CRÉATEUR de cette sortie ?
// Gère les DEUX identités : pseudo du site (champ `createur`) ET id Discord
// (sorties créées via le bot, dont `createur` = nom Discord ≠ pseudo du site).
function epice_is_creator(array $sortie): bool {
    $me = epice_user() ?? '';
    if ($me !== '' && strcasecmp((string)($sortie['createur'] ?? ''), $me) === 0) return true;
    $myDiscord = $_SESSION['discord_id'] ?? '';
    if ($myDiscord !== '' && (string)($sortie['discord']['user_id'] ?? '') === (string)$myDiscord) return true;
    return false;
}

// Peut gérer cette sortie (assigner / clôturer / rouvrir / supprimer) = admin OU créateur.
function epice_owns_sortie(array $sortie): bool {
    return epice_role() === 'admin' || epice_is_creator($sortie);
}

function epice_deny(string $msg): void {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function epice_require_login(): void    { if (!epice_user())        epice_deny('Connexion requise.'); }
function epice_require_organize(): void { if (!epice_can_organize()) epice_deny('Réservé aux organisateurs.'); }
function epice_require_admin(): void    { if (epice_role() !== 'admin') epice_deny('Réservé aux admins.'); }
