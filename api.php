<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");

$file = 'party_data.json';

// === LECTURE (GET) ===
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($file)) {
        $fp = fopen($file, 'r');
        // On attend que le fichier soit libre (Verrou partagé)
        if (flock($fp, LOCK_SH)) {
            $content = stream_get_contents($fp);
            flock($fp, LOCK_UN); // On libère
            echo $content ? $content : "[]";
        } else {
            echo "[]"; // Impossible de lire
        }
        fclose($fp);
    } else {
        echo "[]";
    }
    exit;
}

// === ÉCRITURE (POST) ===
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (is_array($data)) {
        $fp = fopen($file, 'c'); // 'c' pour écrire sans tronquer tout de suite
        // On verrouille EXCLUSIVEMENT (personne ne peut lire ni écrire)
        if (flock($fp, LOCK_EX)) {
            ftruncate($fp, 0); // On vide le fichier maintenant qu'on est seul
            fwrite($fp, json_encode($data, JSON_PRETTY_PRINT));
            fflush($fp); // On force l'écriture disque
            flock($fp, LOCK_UN); // On libère
            echo json_encode(["status" => "success"]);
        } else {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Verrouillage impossible"]);
        }
        fclose($fp);
    } else {
        echo json_encode(["status" => "error", "message" => "Données invalides"]);
    }
    exit;
}
?>