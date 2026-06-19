<?php
// api-gemini.php — proxy sécurisé vers l'API Gemini
// La clé API n'est JAMAIS exposée côté client

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-App-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

// --- Config ---
require_once 'config.php'; // ou '../config.php' si config est hors webroot

$input  = json_decode(file_get_contents('php://input'), true);
$prompt = trim($input['prompt'] ?? '');

// Token : header OU body (contournement filtre Apache)
$token = $_SERVER['mhg_2026_recolte_epice_xK9p'] ?? $input['_token'] ?? '';
if ($token !== APP_SECRET) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès non autorisé']);
    exit;
}

// Le prompt est déjà lu plus haut

if (!$prompt) {
    http_response_code(400);
    echo json_encode(['error' => 'Prompt manquant']);
    exit;
}

// --- Appel Gemini ---
$url  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . GEMINI_API_KEY;
$body = json_encode([
    'contents' => [['parts' => [['text' => $prompt]]]]
]);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_TIMEOUT        => 30,
]);

$response = curl_exec($ch);
$err      = curl_error($ch);
curl_close($ch);

if ($err) {
    http_response_code(502);
    echo json_encode(['error' => 'Erreur cURL : ' . $err]);
    exit;
}

$json = json_decode($response, true);

if (isset($json['error'])) {
    http_response_code(502);
    echo json_encode(['error' => $json['error']['message'] ?? 'Erreur API Gemini']);
    exit;
}

$text = $json['candidates'][0]['content']['parts'][0]['text'] ?? 'Pas de réponse.';
echo json_encode(['synthese' => $text]);
