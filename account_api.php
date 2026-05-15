<?php
header('Content-Type: application/json');
session_start();

$usersFile    = 'users_SECURE_9x.json';
$profilesFile = 'profiles_data.json';
$destFile     = 'destination_data.json';
$basesFile    = 'bases.json';
$avatarsDir   = 'avatars/';
$customDir    = 'avatars/';   // uploads dans le même dossier, préfixe u_

$allowedExt   = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
$maxSizeBytes = 2 * 1024 * 1024; // 2 Mo

function readJson($file) {
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function writeJson($file, $data) {
    $fp = fopen($file, 'c');
    if (!$fp) return false;
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return true;
}

$method = $_SERVER['REQUEST_METHOD'];

// ==================== GET ====================
if ($method === 'GET') {
    $action = $_GET['action'] ?? '';
    $user   = trim($_GET['user'] ?? '');

    // Liste des avatars disponibles (presets + uploads de l'utilisateur)
    if ($action === 'listAvatars') {
        $presets = [];
        $custom  = [];
        $safeU   = $user ? preg_replace('/[^a-z0-9_]/i', '', $user) : '';

        if (is_dir($avatarsDir)) {
            foreach (scandir($avatarsDir) as $f) {
                if ($f === '.' || $f === '..' || is_dir($avatarsDir . $f)) continue;
                $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
                if (!in_array($ext, $allowedExt)) continue;

                if (str_starts_with($f, 'u_')) {
                    // Upload utilisateur — n'afficher que les siens
                    if ($safeU && str_starts_with($f, 'u_' . $safeU . '_')) {
                        $custom[] = $avatarsDir . $f;
                    }
                } else {
                    $presets[] = $avatarsDir . $f;
                }
            }
            sort($presets);
            sort($custom);
        }

        echo json_encode(['ok' => true, 'presets' => $presets, 'custom' => $custom]);
        exit;
    }

    if (!$user) { echo json_encode(['ok' => false, 'error' => 'Utilisateur manquant']); exit; }

    if ($action === 'getProfile') {
        $profiles = readJson($profilesFile);
        $profile  = $profiles[$user] ?? [];
        echo json_encode([
            'ok'      => true,
            'discord' => $profile['discord'] ?? '',
            'avatar'  => $profile['avatar']  ?? '',
        ]);
        exit;
    }

    if ($action === 'stats') {
        $destinations = readJson($destFile);
        $bases        = readJson($basesFile);

        $destCount = 0;
        foreach ($destinations as $d) {
            if (($d['placedBy'] ?? '') === $user) $destCount++;
        }
        $baseCount = 0;
        foreach ($bases as $b) {
            if (($b['user'] ?? '') === $user) $baseCount++;
        }

        $users = readJson($usersFile);
        $role  = 'Joueur';
        foreach ($users as $u) {
            if ($u['user'] === $user) { $role = ucfirst($u['role'] ?? 'user'); break; }
        }

        echo json_encode(['ok' => true, 'destinations' => $destCount, 'bases' => $baseCount, 'role' => $role]);
        exit;
    }

    if ($action === 'getOrderHistory') {
        $requetes  = readJson('requetes.json');
        $demanded  = [];
        $fulfilled = [];
        foreach ($requetes as $r) {
            if (($r['player'] ?? '') === $user) {
                $demanded[] = [
                    'id'     => $r['id'],
                    'type'   => $r['type']   ?? '',
                    'notes'  => $r['notes']  ?? '',
                    'status' => $r['status'] ?? 'pending',
                    'crafter'=> $r['crafterAssigned'] ?? null,
                ];
            }
            if (($r['crafterAssigned'] ?? '') === $user && ($r['status'] ?? '') === 'done') {
                $fulfilled[] = [
                    'id'     => $r['id'],
                    'type'   => $r['type']   ?? '',
                    'notes'  => $r['notes']  ?? '',
                    'player' => $r['player'] ?? '',
                ];
            }
        }
        echo json_encode(['ok' => true, 'demanded' => $demanded, 'fulfilled' => $fulfilled]);
        exit;
    }

    echo json_encode(['ok' => false, 'error' => 'Action inconnue']);
    exit;
}

// ==================== POST ====================
if ($method === 'POST') {
    $input  = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? '';
    $user   = trim($input['user'] ?? '');

    if (!$user) { echo json_encode(['ok' => false, 'error' => 'Utilisateur manquant']); exit; }

    // Changer le mot de passe
    if ($action === 'changePassword') {
        $currentPwd = $input['currentPassword'] ?? '';
        $newPwd     = trim($input['newPassword'] ?? '');

        if (strlen($newPwd) < 6) {
            echo json_encode(['ok' => false, 'error' => 'Le mot de passe doit faire au moins 6 caractères']); exit;
        }

        $users = readJson($usersFile);
        $found = false;
        foreach ($users as &$u) {
            if ($u['user'] === $user && $u['password'] === $currentPwd) {
                $u['password'] = $newPwd;
                $found = true;
                break;
            }
        }
        unset($u);

        if (!$found) { echo json_encode(['ok' => false, 'error' => 'Mot de passe actuel incorrect']); exit; }

        writeJson($usersFile, $users);
        echo json_encode(['ok' => true]);
        exit;
    }

    // Sauvegarder Discord
    if ($action === 'saveProfile') {
        $discord  = trim($input['discord'] ?? '');
        $profiles = readJson($profilesFile);
        if (!isset($profiles[$user])) $profiles[$user] = [];
        $profiles[$user]['discord'] = $discord;
        writeJson($profilesFile, $profiles);
        echo json_encode(['ok' => true]);
        exit;
    }

    // Choisir un avatar preset
    if ($action === 'setAvatar') {
        $path = $input['avatarPath'] ?? '';
        // Valider que le chemin est bien dans avatars/
        $real = realpath(__DIR__ . '/' . $path);
        $base = realpath(__DIR__ . '/' . $avatarsDir);
        if (!$real || !$base || strpos($real, $base) !== 0) {
            echo json_encode(['ok' => false, 'error' => 'Chemin invalide']); exit;
        }
        $profiles = readJson($profilesFile);
        if (!isset($profiles[$user])) $profiles[$user] = [];
        $profiles[$user]['avatar'] = $path;
        writeJson($profilesFile, $profiles);
        echo json_encode(['ok' => true, 'avatarPath' => $path]);
        exit;
    }

    // Upload d'un avatar custom
    if ($action === 'uploadAvatar') {
        $b64 = $input['image'] ?? '';
        if (!preg_match('/^data:image\/(\w+);base64,/', $b64, $match)) {
            echo json_encode(['ok' => false, 'error' => 'Format image invalide']); exit;
        }
        $ext = strtolower($match[1]);
        if ($ext === 'jpeg') $ext = 'jpg';
        if (!in_array($ext, $allowedExt)) {
            echo json_encode(['ok' => false, 'error' => 'Extension non autorisée']); exit;
        }

        $imgData = base64_decode(substr($b64, strpos($b64, ',') + 1));
        if (strlen($imgData) > $maxSizeBytes) {
            echo json_encode(['ok' => false, 'error' => 'Image trop lourde (max 2 Mo)']); exit;
        }

        $safeUser = preg_replace('/[^a-z0-9_]/i', '', $user);
        $filename = 'u_' . $safeUser . '_' . uniqid() . '.jpg';
        $fullPath = $customDir . $filename;

        // --- Resize 200×200 avec crop carré centré via GD ---
        $src = imagecreatefromstring($imgData);
        if ($src === false) {
            echo json_encode(['ok' => false, 'error' => 'Image illisible ou format non supporté']); exit;
        }
        $srcW = imagesx($src);
        $srcH = imagesy($src);

        $cropSize = min($srcW, $srcH);
        $cropX    = intval(($srcW - $cropSize) / 2);
        $cropY    = intval(($srcH - $cropSize) / 2);

        $dst = imagecreatetruecolor(200, 200);
        imagecopyresampled($dst, $src, 0, 0, $cropX, $cropY, 200, 200, $cropSize, $cropSize);
        imagedestroy($src);

        $written = imagejpeg($dst, $fullPath, 88);
        imagedestroy($dst);

        if (!$written) {
            echo json_encode(['ok' => false, 'error' => 'Écriture échouée — vérifiez les permissions de avatars/ sur le serveur (chmod 775, www-data)']); exit;
        }
        chmod($fullPath, 0664);

        $profiles = readJson($profilesFile);
        if (!isset($profiles[$user])) $profiles[$user] = [];
        $profiles[$user]['avatar'] = $fullPath;
        writeJson($profilesFile, $profiles);

        echo json_encode(['ok' => true, 'avatarPath' => $fullPath]);
        exit;
    }

    // Supprimer l'avatar (revenir aux initiales)
    if ($action === 'removeAvatar') {
        $profiles = readJson($profilesFile);
        if (isset($profiles[$user])) {
            $profiles[$user]['avatar'] = '';
        }
        writeJson($profilesFile, $profiles);
        echo json_encode(['ok' => true]);
        exit;
    }

    echo json_encode(['ok' => false, 'error' => 'Action inconnue']);
    exit;
}

echo json_encode(['ok' => false, 'error' => 'Méthode non supportée']);
