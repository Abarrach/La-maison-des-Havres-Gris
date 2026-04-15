<?php
// auth.php
session_start();
header('Content-Type: application/json');

// 1. Récupérer les données envoyées par le JS
$input = json_decode(file_get_contents('php://input'), true);
$userSent = $input['user'] ?? '';
$passSent = $input['password'] ?? '';

// 2. Charger le fichier JSON (On utilise un nom secret, voir étape 3)
// Note le nom du fichier modifié ici :
$jsonFile = 'users_SECURE_9x.json'; 

if (!file_exists($jsonFile)) {
    echo json_encode(['ok' => false, 'error' => 'Base utilisateurs introuvable']);
    exit;
}

$users = json_decode(file_get_contents($jsonFile), true);

// 3. Vérifier les identifiants
$found = false;
$role = 'user';

foreach ($users as $u) {
    // Comparaison stricte (Note: idéalement il faudrait des mots de passe hachés, mais on reste simple pour l'instant)
    if ($u['user'] === $userSent && $u['password'] === $passSent) {
        $found = true;
        $role = $u['role'];
        break;
    }
}

if ($found) {
    // On enregistre la session côté serveur
    $_SESSION['user'] = $userSent;
    $_SESSION['role'] = $role;
    echo json_encode(['ok' => true, 'user' => $userSent, 'role' => $role]);
} else {
    echo json_encode(['ok' => false, 'error' => 'Identifiants incorrects']);
}
?>