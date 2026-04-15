<?php
header('Content-Type: application/json; charset=utf-8');

// ⚠ IMPORTANT : On force l'heure de Paris
date_default_timezone_set('Europe/Paris');

function jerr($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

function readJson($path) {
    if (!file_exists($path)) return [];
    $content = file_get_contents($path);
    $json = json_decode($content, true);
    return is_array($json) ? $json : [];
}

function writeJson($path, $data) {
    @chmod($path, 0666);
    if (file_exists($path) && !is_writable($path)) return false;
    $res = file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return ($res !== false);
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if ($data === null) jerr("invalid_json");
$action = $data['action'] ?? null;
if (!$action) jerr("missing_action");

switch ($action) {

    case 'checkWipe':
        $jourCible = 2; // Mardi
        $heureCible = 5; 
        $minuteCible = 0;

        $nowJour = date('w');
        $nowTime = date('H') * 60 + date('i');
        $cibleTime = $heureCible * 60 + $minuteCible;

        if ($nowJour == $jourCible && $nowTime >= $cibleTime) {
            $threshold = strtotime("today $heureCible:$minuteCible");
        } else {
            $daysEn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            $dayName = $daysEn[$jourCible];
            $threshold = strtotime("last $dayName $heureCible:$minuteCible");
        }

        $logFile = __DIR__ . '/last_wipe.txt';
        $lastWipeTimestamp = file_exists($logFile) ? intval(file_get_contents($logFile)) : 0;

        if ($lastWipeTimestamp < $threshold) {
            $basesFile = __DIR__ . '/bases.json';
            $bases = readJson($basesFile);
            $newBases = array_filter($bases, function($b) {
                return ($b['map'] ?? 'hagga') !== 'deep_desert';
            });

            if (writeJson($basesFile, array_values($newBases))) {
                file_put_contents($logFile, $threshold);
                echo json_encode(['ok' => true, 'message' => 'Wipe Hebdo effectué']);
            } else {
                jerr("Erreur écriture wipe", 500);
            }
        } else {
            echo json_encode(['ok' => true, 'message' => 'Déjà à jour']);
        }
        exit;

    case 'addUser':
        $user = trim($data['user'] ?? '');
        $pass = trim($data['password'] ?? '');
        if ($user === '' || $pass === '') jerr("missing_fields");
        
        $usersFile = __DIR__ . '/users_SECURE_9x.json';
        $users = readJson($usersFile);
        
        foreach ($users as $u) {
            if (strcasecmp($u['user'], $user) === 0) jerr("exists");
        }
        $users[] = ['user' => $user, 'password' => $pass, 'role' => 'user'];
        
        if (!writeJson($usersFile, $users)) jerr("write_error", 500);
        
        echo json_encode(['ok' => true]);
        exit;

    case 'add':
        $user = trim($data['user'] ?? '');
        $x = floatval($data['x'] ?? 0);
        $y = floatval($data['y'] ?? 0);
        $type = $data['type'] ?? 'joueur';
        $mapId = $data['mapId'] ?? 'hagga';
        $note = trim($data['note'] ?? '');

        if ($user === '') jerr("missing_user");
        $file = __DIR__ . '/bases.json';
        $bases = readJson($file);
        $bases[] = ['user' => $user, 'x' => $x, 'y' => $y, 'type' => $type, 'map' => $mapId, 'note' => $note];
        if (!writeJson($file, $bases)) jerr("write_error");
        echo json_encode(['ok' => true]);
        exit;

    case 'updateNote':
        $targetUser = $data['user'] ?? '';
        $x = floatval($data['x'] ?? 0);
        $y = floatval($data['y'] ?? 0);
        $newNote = trim($data['note'] ?? '');

        $file = __DIR__ . '/bases.json';
        $bases = readJson($file);
        $found = false;

        foreach ($bases as &$b) {
            if ($b['user'] === $targetUser && abs($b['x'] - $x) < 0.001 && abs($b['y'] - $y) < 0.001) {
                $b['note'] = $newNote;
                $found = true;
                break;
            }
        }

        if ($found) {
            if (writeJson($file, $bases)) echo json_encode(['ok' => true]);
            else jerr("write_error");
        } else {
            jerr("base_not_found");
        }
        exit;

    case 'remove':
        $targetUser = $data['user'] ?? '';
        $x = floatval($data['x'] ?? 0);
        $y = floatval($data['y'] ?? 0);
        $file = __DIR__ . '/bases.json';
        $bases = readJson($file);
        $bases = array_filter($bases, function($b) use ($targetUser, $x, $y) {
            return !($b['user'] === $targetUser && abs($b['x'] - $x) < 0.001 && abs($b['y'] - $y) < 0.001);
        });
        if (!writeJson($file, array_values($bases))) jerr("write_error");
        echo json_encode(['ok' => true]);
        exit;

    case 'deleteUser':
        $target = trim($data['target'] ?? '');
        if ($target === '') jerr("missing_target");
        if (strcasecmp($target, 'Abarrach') === 0) jerr("Impossible de supprimer le chef.");
        
        $usersFile = __DIR__ . '/users_SECURE_9x.json';
        $users = readJson($usersFile);
        $users = array_filter($users, fn($u) => $u['user'] !== $target);
        writeJson($usersFile, array_values($users));
        
        $basesFile = __DIR__ . '/bases.json';
        $bases = readJson($basesFile);
        $bases = array_filter($bases, fn($b) => $b['user'] !== $target);
        writeJson($basesFile, array_values($bases));
        echo json_encode(['ok' => true]);
        exit;

    case 'updateRole':
        $target = trim($data['target'] ?? '');
        $newRole = trim($data['role'] ?? 'user');
        if (strcasecmp($target, 'Abarrach') === 0 && $newRole !== 'admin') jerr("Impossible de rétrograder le chef.");
        
        $usersFile = __DIR__ . '/users_SECURE_9x.json';
        $users = readJson($usersFile);
        $found = false;
        foreach ($users as &$u) {
            if ($u['user'] === $target) {
                $u['role'] = $newRole;
                $found = true;
                break;
            }
        }
        if (!$found || !writeJson($usersFile, $users)) jerr("error");
        echo json_encode(['ok' => true]);
        exit;

    // ==========================================
    // CASES POUR LES REQUÊTES DE CRAFT (VEC IMAGE)
    // ==========================================

    case 'getRequetes':
        $reqFile = __DIR__ . '/requetes.json';
        if (!file_exists($reqFile)) writeJson($reqFile, []);
        echo json_encode(readJson($reqFile));
        exit;

    case 'addRequete':
        $user  = trim($data['user']  ?? '');
        $type  = trim($data['type']  ?? '');
        $notes = trim($data['notes'] ?? '');
        if (strlen($notes) > 1600) $notes = substr($notes, 0, 1600);

        if ($user === '' || $type === '') jerr("missing_data");

        // Accepte le nouveau champ 'images' (array) ET l'ancien 'image' (string) par rétrocompatibilité
        $b64List = [];
        if (!empty($data['images']) && is_array($data['images'])) {
            $b64List = array_slice($data['images'], 0, 4); // max 4 images
        } elseif (!empty($data['image'])) {
            $b64List = [$data['image']];
        }

        // Création du dossier uploads si nécessaire
        $uploadDir = __DIR__ . '/uploads/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0777, true);
            @chmod($uploadDir, 0777);
        }

        // Sauvegarde de chaque image
        $imageUrls = [];
        foreach ($b64List as $b64Image) {
            if (!$b64Image) continue;
            if (!preg_match('/^data:image\/(\w+);base64,/', $b64Image, $match)) continue;
            $ext = strtolower($match[1]);
            if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;

            $imgData = base64_decode(substr($b64Image, strpos($b64Image, ',') + 1));
            $filename = uniqid('img_') . '.' . $ext;
            if (file_put_contents($uploadDir . $filename, $imgData)) {
                $imageUrls[] = 'uploads/' . $filename;
            }
        }

        $reqFile = __DIR__ . '/requetes.json';
        $reqs = readJson($reqFile);

        $newReq = [
            'id'              => uniqid('req_'),
            'player'          => $user,
            'type'            => $type,
            'notes'           => $notes,
            'image'           => $imageUrls[0] ?? null,   // champ legacy (1re image)
            'images'          => $imageUrls,               // nouveau champ (toutes les images)
            'status'          => 'pending',
            'crafterAssigned' => null
        ];

        array_unshift($reqs, $newReq);

        if (!writeJson($reqFile, $reqs)) jerr("write_error");
        echo json_encode(['ok' => true]);
        exit;

    case 'updateRequete':
        $id = $data['id'] ?? null;
        $status = $data['status'] ?? '';
        $crafter = $data['crafter'] ?? null;

        if (!$id || !$status) jerr("missing_data");

        $reqFile = __DIR__ . '/requetes.json';
        $reqs = readJson($reqFile);
        $found = false;

        foreach ($reqs as &$r) {
            if ($r['id'] === $id) {
                $r['status'] = $status;
                if ($status === 'progress') {
                    $r['crafterAssigned'] = $crafter;
                }
                $found = true;
                break;
            }
        }

        if ($found) {
            if (!writeJson($reqFile, $reqs)) jerr("write_error");
            echo json_encode(['ok' => true]);
        } else {
            jerr("requete_not_found");
        }
        exit;

    // --- NOUVEAU : Fonction de suppression de requête ---
    case 'deleteRequete':
        $id = $data['id'] ?? null;
        if (!$id) jerr("missing_data");

        $reqFile = __DIR__ . '/requetes.json';
        $reqs = readJson($reqFile);
        
        // On filtre pour retirer la demande qui correspond à l'ID envoyé
        $newReqs = array_filter($reqs, fn($r) => $r['id'] !== $id);
        
        if (!writeJson($reqFile, array_values($newReqs))) jerr("write_error");
        echo json_encode(['ok' => true]);
        exit;

    default: jerr("unknown_action");
}
?>