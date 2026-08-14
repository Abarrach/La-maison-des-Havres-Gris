<?php
// ============================================================
//  session_check.php — validité de session + revérif d'appartenance
//
//  Appelé par auth-guard.js à chaque chargement de page protégée.
//  - Pas de session → ok:false (le client redirige vers le login)
//  - Compte Discord : si la dernière vérif date de plus de
//    recheck_seconds, on réinterroge l'API. Si le membre a QUITTÉ
//    la guilde → session détruite → ok:false (reason left_guild).
//    Sinon on rafraîchit le rôle (admin Discord peut changer).
//  - Compte mot de passe (sans discord_id) : toujours ok
//    (page cachée d'accès par mot de passe conservée).
// ============================================================

require_once __DIR__ . '/discord_oauth.php';
header('Content-Type: application/json; charset=utf-8');

$user = $_SESSION['user'] ?? null;
if (!$user) {
    echo json_encode(['ok' => false, 'reason' => 'no_session']);
    exit;
}

// Écriture forcée à chaque appel : modifie une donnée de session pour que PHP
// réécrive le fichier (contourne lazy_write) → sa date est rafraîchie et le
// ramasse-miettes (gc_maxlifetime) ne le purge pas tant qu'un onglet est ouvert.
$_SESSION['last_seen'] = time();

$discordId = $_SESSION['discord_id'] ?? '';

// Compte mot de passe (pas de lien Discord) → on laisse passer tel quel.
if ($discordId === '') {
    echo json_encode(['ok' => true, 'user' => $user, 'role' => $_SESSION['role'] ?? 'user']);
    exit;
}

$cfg = dco_config();
if (!$cfg) {
    // Sans config on ne peut pas revérifier ; on ne casse pas la session existante.
    echo json_encode(['ok' => true, 'user' => $user, 'role' => $_SESSION['role'] ?? 'user']);
    exit;
}

$last = (int)($_SESSION['discord_checked'] ?? 0);
$due  = (time() - $last) >= $cfg['recheck_seconds'];

if ($due) {
    $member = dco_guild_member($cfg, $discordId);

    if (!empty($member['error'])) {
        // Erreur transitoire (API indispo) : on NE déconnecte PAS, on retentera plus tard.
        echo json_encode(['ok' => true, 'user' => $user, 'role' => $_SESSION['role'] ?? 'user', 'recheck' => 'deferred']);
        exit;
    }

    if (!dco_member_allowed($cfg, $member, $user)) {
        // A quitté la guilde OU perdu le rôle d'accès → éjection immédiate,
        // même si une session était encore ouverte. On étiquette le compte pour
        // que l'administration le classe dans les anciens joueurs sans attendre
        // une vérification manuelle.
        dco_mark_left($discordId, true);
        dco_clear_session();
        echo json_encode(['ok' => false, 'reason' => $member['in_guild'] ? 'no_access_role' : 'left_guild']);
        exit;
    }

    // Toujours membre : on rafraîchit le rôle et l'horodatage (et on efface
    // l'étiquette « parti » s'il en portait une — cas d'un retour).
    dco_mark_left($discordId, false);
    $role = dco_compute_role($cfg, $user, $member['roles']);
    $_SESSION['role']            = $role;
    $_SESSION['discord_checked'] = time();
    echo json_encode(['ok' => true, 'user' => $user, 'role' => $role, 'recheck' => 'done']);
    exit;
}

// Vérif encore fraîche
echo json_encode(['ok' => true, 'user' => $user, 'role' => $_SESSION['role'] ?? 'user']);
exit;
