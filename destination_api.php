<?php
header('Content-Type: application/json');
$file      = 'destination_data.json';
$uploadDir = __DIR__ . '/uploads/';

if (!file_exists($file)) {
    if (file_put_contents($file, '[]') === false) {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Impossible de créer destination_data.json. Vérifiez les permissions du répertoire."]);
        exit;
    }
    chmod($file, 0664);
}

function readData($file) {
    return file_exists($file) ? (json_decode(file_get_contents($file), true) ?? []) : [];
}

function writeData($file, $data) {
    $fp = fopen($file, 'c');
    if (!$fp) {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Impossible d'ouvrir le fichier."]);
        exit;
    }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        fwrite($fp, json_encode(array_values($data), JSON_PRETTY_PRINT));
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        echo json_encode(["status" => "success"]);
    } else {
        fclose($fp);
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Impossible de verrouiller le fichier."]);
    }
    exit;
}

function saveImages($b64List, $uploadDir) {
    $paths = [];
    foreach (array_slice($b64List, 0, 2) as $b64) {
        if (!$b64) continue;
        if (!preg_match('/^data:image\/(\w+);base64,/', $b64, $match)) continue;
        $ext = strtolower($match[1]);
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) continue;
        $imgData  = base64_decode(substr($b64, strpos($b64, ',') + 1));
        $filename = uniqid('dst_') . '.' . $ext;
        if (file_put_contents($uploadDir . $filename, $imgData)) {
            $paths[] = 'uploads/' . $filename;
        }
    }
    return $paths;
}

function deleteImages($images) {
    foreach ($images as $path) {
        $full = __DIR__ . '/' . $path;
        if (file_exists($full)) @unlink($full);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo file_exists($file) ? file_get_contents($file) : '[]';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input  = json_decode(file_get_contents('php://input'), true);
    $data   = readData($file);
    $action = $input['action'] ?? 'save';

    // ── DELETE ──────────────────────────────────────────────────────────────
    if ($action === 'delete') {
        foreach ($data as $item) {
            if ($item['id'] === $input['id'] && !empty($item['images'])) {
                deleteImages($item['images']);
            }
        }
        $data = array_filter($data, fn($item) => $item['id'] !== $input['id']);
        writeData($file, $data);
    }

    // ── CONFIRM ─────────────────────────────────────────────────────────────
    elseif ($action === 'confirm') {
        $found = false;
        foreach ($data as &$item) {
            if ($item['id'] === $input['id']) {
                if (strcasecmp($item['pseudo'], trim($input['pseudo'])) !== 0) {
                    echo json_encode(["status" => "error", "message" => "Ce pseudo ne correspond pas à cette base."]);
                    exit;
                }
                $item['status'] = 'confirmee';
                $found = true;
                break;
            }
        }
        if (!$found) { echo json_encode(["status" => "error", "message" => "Base introuvable."]); exit; }
        writeData($file, $data);
    }

    // ── REJECT ──────────────────────────────────────────────────────────────
    elseif ($action === 'reject') {
        $found = false;
        foreach ($data as &$item) {
            if ($item['id'] === $input['id']) {
                if (strcasecmp($item['pseudo'], trim($input['pseudo'])) !== 0) {
                    echo json_encode(["status" => "error", "message" => "Ce pseudo ne correspond pas à cette base."]);
                    exit;
                }
                $item['status']       = 'rejetee';
                $item['rejectReason'] = trim($input['reason'] ?? '');
                $found = true;
                break;
            }
        }
        if (!$found) { echo json_encode(["status" => "error", "message" => "Base introuvable."]); exit; }
        writeData($file, $data);
    }

    // ── RESET ───────────────────────────────────────────────────────────────
    elseif ($action === 'reset') {
        foreach ($data as &$item) {
            if ($item['id'] === $input['id']) {
                $item['status'] = 'projetee';
                unset($item['rejectReason']);
                break;
            }
        }
        writeData($file, $data);
    }

    // ── SAVE (create / update) ───────────────────────────────────────────────
    else {
        $editId  = $input['id'] ?? null;
        $oldItem = null;
        if ($editId) {
            foreach ($data as $item) {
                if ($item['id'] === $editId) { $oldItem = $item; break; }
            }
        }

        // Images reçues en base64 (nouvelles captures)
        $newImages = [];
        if (!empty($input['images']) && is_array($input['images'])) {
            $newImages = saveImages($input['images'], $uploadDir);
        }

        if ($oldItem) {
            // Mise à jour : on garde les images que le client n'a pas supprimées
            $keepImages = isset($input['keepImages']) && is_array($input['keepImages'])
                ? $input['keepImages']
                : ($oldItem['images'] ?? []);

            // Supprimer les images retirées
            if (!empty($oldItem['images'])) {
                foreach ($oldItem['images'] as $oldPath) {
                    if (!in_array($oldPath, $keepImages)) {
                        $full = __DIR__ . '/' . $oldPath;
                        if (file_exists($full)) @unlink($full);
                    }
                }
            }

            $images  = array_values(array_merge($keepImages, $newImages));
            $images  = array_slice($images, 0, 2);

            $data    = array_filter($data, fn($item) => $item['id'] !== $editId);
            $newItem = [
                'id'        => $editId,
                'pseudo'    => trim($input['pseudo']),
                'sietch'    => $input['sietch'],
                'lat'       => $oldItem['lat'],
                'lng'       => $oldItem['lng'],
                'placedBy'  => trim($input['placedBy'] ?? $oldItem['placedBy']),
                'note'      => trim($input['note'] ?? ''),
                'images'    => $images,
                'status'    => $oldItem['status'],
                'timestamp' => $oldItem['timestamp'],
            ];
            if (isset($oldItem['rejectReason'])) $newItem['rejectReason'] = $oldItem['rejectReason'];

        } else {
            // Création
            $newItem = [
                'id'        => uniqid(),
                'pseudo'    => trim($input['pseudo']),
                'sietch'    => $input['sietch'],
                'lat'       => (float)$input['lat'],
                'lng'       => (float)$input['lng'],
                'placedBy'  => trim($input['placedBy'] ?? ''),
                'note'      => trim($input['note'] ?? ''),
                'images'    => $newImages,
                'status'    => 'projetee',
                'timestamp' => date('c'),
            ];
        }

        $data[] = $newItem;
        writeData($file, $data);
    }
}
?>
