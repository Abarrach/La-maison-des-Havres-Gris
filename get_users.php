<?php
// get_users.php
session_start();
header('Content-Type: application/json');

// SÉCURITÉ : On vérifie que c'est bien un ADMIN qui demande
if (!isset($_SESSION['role']) || $_SESSION['role'] !== 'admin') {
    echo json_encode([]); // On renvoie une liste vide aux curieux
    exit;
}

// Le PHP a le droit de lire le fichier, même si Nginx le bloque pour le web
$jsonFile = 'users_SECURE_9x.json';

if (file_exists($jsonFile)) {
    $users = json_decode(file_get_contents($jsonFile), true);
    
    // IMPORTANT : On retire les mots de passe avant d'envoyer la liste au navigateur
    // (Même si c'est un admin, c'est une bonne pratique de ne pas balader les mots de passe)
    $safeUsers = [];
    foreach ($users as $u) {
        unset($u['password']); // On supprime le champ password
        $safeUsers[] = $u;
    }
    
    echo json_encode($safeUsers);
} else {
    echo json_encode([]);
}
?>