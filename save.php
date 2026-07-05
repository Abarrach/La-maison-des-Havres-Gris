<?php
header('Content-Type: application/json; charset=utf-8');

// ⚠ IMPORTANT : On force l'heure de Paris
date_default_timezone_set('Europe/Paris');

// Intégration Discord (envoi/suppression auto des messages de demande)
require_once __DIR__ . '/discord_helper.php';
// Session (démarre avec les bons paramètres de cookie 30j, cf. discord_oauth.php)
// + dco_config()/dco_dm_send() pour les MP d'octroi d'accès à une page.
require_once __DIR__ . '/discord_oauth.php';

function jerr($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// Vérification serveur du rôle admin (ne JAMAIS faire confiance à un champ
// envoyé par le client, ex: adminUser) — s'appuie sur la session PHP réelle.
function requireAdmin() {
    if (($_SESSION['role'] ?? '') !== 'admin') jerr("not_authorized", 403);
}

// Cheffe de guilde protégée par ID Discord (immuable), pas par pseudo — un pseudo
// peut être mal orthographié/renommé, l'ID Discord jamais. Ni rétrogradable ni
// supprimable par un autre admin (cf. Abarrach, responsable du site, protégé pareil
// mais par pseudo puisque son compte n'est pas nécessairement lié à Discord).
const GUILD_CHIEF_DISCORD_ID = '332476079875031051'; // Lorhelyne

function isGuildChief(array $users, string $pseudo): bool {
    foreach ($users as $u) {
        if (strcasecmp($u['user'] ?? '', $pseudo) === 0) {
            return (string)($u['discord_id'] ?? '') === GUILD_CHIEF_DISCORD_ID;
        }
    }
    return false;
}

function readJson($path) {
    if (!file_exists($path)) return [];
    $content = file_get_contents($path);
    $json = json_decode($content, true);
    return is_array($json) ? $json : [];
}

function writeJson($path, $data) {
    @chmod($path, 0664);
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

    case 'add':
        $user = trim($data['user'] ?? '');
        $x = floatval($data['x'] ?? 0);
        $y = floatval($data['y'] ?? 0);
        $type = $data['type'] ?? 'joueur';
        $mapId = $data['mapId'] ?? 'hagga';
        $note = trim($data['note'] ?? '');
        $sietch = trim($data['sietch'] ?? '');
        $instance = trim($data['instance'] ?? '');

        if ($user === '') jerr("missing_user");
        $file = __DIR__ . '/bases.json';
        $bases = readJson($file);
        $bases[] = ['user' => $user, 'x' => $x, 'y' => $y, 'type' => $type, 'map' => $mapId, 'note' => $note, 'sietch' => $sietch, 'instance' => $instance];
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
        requireAdmin();
        $target = trim($data['target'] ?? '');
        if ($target === '') jerr("missing_target");
        if (strcasecmp($target, 'Abarrach') === 0) jerr("Impossible de supprimer le responsable du site.");

        $usersFile = __DIR__ . '/users_SECURE_9x.json';
        $users = readJson($usersFile);
        if (isGuildChief($users, $target)) jerr("Impossible de supprimer le chef de guilde.");
        $users = array_filter($users, fn($u) => $u['user'] !== $target);
        writeJson($usersFile, array_values($users));
        
        $basesFile = __DIR__ . '/bases.json';
        $bases = readJson($basesFile);
        $bases = array_filter($bases, fn($b) => $b['user'] !== $target);
        writeJson($basesFile, array_values($bases));
        echo json_encode(['ok' => true]);
        exit;

    case 'updateRole':
        requireAdmin();
        $target = trim($data['target'] ?? '');
        $newRole = trim($data['role'] ?? 'user');
        if (strcasecmp($target, 'Abarrach') === 0 && $newRole !== 'admin') jerr("Impossible de rétrograder le responsable du site.");

        $usersFile = __DIR__ . '/users_SECURE_9x.json';
        $users = readJson($usersFile);
        if ($newRole !== 'admin' && isGuildChief($users, $target)) jerr("Impossible de rétrograder le chef de guilde.");
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
            'crafterAssigned' => null,
            'discordMsgId'    => null,                      // ID du message Discord (pour suppression auto)
            'siteUrl'         => trim($data['siteUrl'] ?? '') // URL du lien (pour rééditer le message plus tard)
        ];

        array_unshift($reqs, $newReq);

        // 1) On ENREGISTRE la demande AVANT tout envoi Discord.
        //    Si l'écriture échoue, rien n'est posté sur Discord (pas de message orphelin).
        if (!writeJson($reqFile, $reqs)) jerr("write_error");

        // 2) Envoi automatique sur Discord (silencieux si webhook non configuré).
        //    L'URL du lien est fournie par le navigateur (gère /v2/, http/https, etc.).
        $siteUrl = $newReq['siteUrl'];
        $msgId = discord_post_request($newReq, $siteUrl);
        if ($msgId) {
            // On mémorise l'ID du message pour pouvoir le supprimer plus tard
            $reqs[0]['discordMsgId'] = $msgId;
            writeJson($reqFile, $reqs); // best-effort : si ça rate, pas grave
        }

        $discordReason = $GLOBALS['discord_last_error'] ?? null;
        // Log debug serveur (lisible en SSH : tail -n 20 /chemin/v2/discord_debug.log)
        if (!$msgId && $discordReason) {
            @file_put_contents(__DIR__ . '/discord_debug.log',
                date('Y-m-d H:i:s') . " | " . $discordReason . "\n", FILE_APPEND);
        }

        echo json_encode(['ok' => true, 'id' => $newReq['id'], 'discord' => (bool)$msgId, 'discordReason' => $discordReason]);
        exit;

    case 'updateRequete':
        $id = $data['id'] ?? null;
        $status = $data['status'] ?? '';
        $crafter = $data['crafter'] ?? null;

        if (!$id || !$status) jerr("missing_data");

        $reqFile = __DIR__ . '/requetes.json';
        $reqs = readJson($reqFile);
        $found = false;
        $msgToThank  = null;   // ID du message Discord à transformer en remerciement (terminé)
        $msgToEdit   = null;   // ID du message Discord à rééditer (prise en charge)
        $reqForEdit  = null;   // copie de la demande à jour pour reconstruire le message
        $reqForThank = null;   // copie de la demande terminée pour le remerciement

        foreach ($reqs as &$r) {
            if ($r['id'] === $id) {
                $r['status'] = $status;
                if ($status === 'progress') {
                    $r['crafterAssigned'] = $crafter;
                    // Prise en charge : on prévoit l'édition du message Discord
                    if (!empty($r['discordMsgId'])) {
                        $msgToEdit  = $r['discordMsgId'];
                        $reqForEdit = $r;
                    }
                }
                // Travail terminé : on transforme le message Discord en remerciement
                if ($status === 'done' && !empty($r['discordMsgId'])) {
                    $msgToThank  = $r['discordMsgId'];
                    $reqForThank = $r;
                }
                $found = true;
                break;
            }
        }
        unset($r);

        if ($found) {
            if (!writeJson($reqFile, $reqs)) jerr("write_error");
            if ($msgToThank) {
                discord_complete_message($msgToThank, $reqForThank);
            } elseif ($msgToEdit) {
                discord_edit_message($msgToEdit, $reqForEdit, $reqForEdit['siteUrl'] ?? '');
            }
            echo json_encode(['ok' => true]);
        } else {
            jerr("requete_not_found");
        }
        exit;

    case 'deleteRequete':
        $id   = $data['id']   ?? null;
        $user = trim($data['user'] ?? '');
        if (!$id || !$user) jerr("missing_data");

        $reqFile = __DIR__ . '/requetes.json';
        $reqs = readJson($reqFile);

        // Vérifier que l'auteur correspond et que la demande n'est pas terminée
        $target = null;
        foreach ($reqs as $r) { if ($r['id'] === $id) { $target = $r; break; } }
        if (!$target) jerr("requete_not_found");
        if ($target['player'] !== $user) jerr("not_authorized");
        if (($target['status'] ?? '') === 'done') jerr("cannot_delete_done");

        $newReqs = array_filter($reqs, fn($r) => $r['id'] !== $id);
        if (!writeJson($reqFile, array_values($newReqs))) jerr("write_error");

        // On efface aussi le message Discord associé (silencieux si absent)
        if (!empty($target['discordMsgId'])) discord_delete_message($target['discordMsgId']);

        echo json_encode(['ok' => true]);
        exit;

    case 'getSettings':
        $settingsFile = __DIR__ . '/settings.json';
        if (!file_exists($settingsFile)) writeJson($settingsFile, ['pages' => new stdClass()]);
        $settings = readJson($settingsFile);
        if (!isset($settings['pages']) || !is_array($settings['pages'])) $settings['pages'] = [];
        if (!isset($settings['pages_access']) || !is_array($settings['pages_access'])) $settings['pages_access'] = [];

        // Migration : ancien booléen analytics_public -> pages.analytics
        // (true = ouvert à tous, false = restreint admin -> masqué pour les joueurs)
        if (array_key_exists('analytics_public', $settings)) {
            if (!isset($settings['pages']['analytics'])) {
                $settings['pages']['analytics'] = $settings['analytics_public'] ? 'open' : 'hidden';
            }
            unset($settings['analytics_public']);
            writeJson($settingsFile, $settings);
        }

        // Toujours renvoyer "pages"/"pages_access" comme objets (et non tableau vide [])
        if (empty($settings['pages'])) $settings['pages'] = new stdClass();
        if (empty($settings['pages_access'])) $settings['pages_access'] = new stdClass();
        echo json_encode($settings);
        exit;

    case 'updatePage':
        requireAdmin();
        $key       = trim($data['key']       ?? '');
        $status    = trim($data['status']    ?? '');
        if ($key === '') jerr("missing_data");
        if (!in_array($status, ['open', 'hidden', 'wip'], true)) jerr("bad_status");

        $settingsFile = __DIR__ . '/settings.json';
        $settings = readJson($settingsFile);
        if (!isset($settings['pages']) || !is_array($settings['pages'])) $settings['pages'] = [];
        $settings['pages'][$key] = $status;
        unset($settings['analytics_public']); // nettoyage post-migration
        if (!writeJson($settingsFile, $settings)) jerr("write_error", 500);
        echo json_encode(['ok' => true]);
        exit;

    case 'updatePageAccess':
        requireAdmin();
        $key   = trim($data['key'] ?? '');
        $title = trim($data['title'] ?? $key);
        $link  = trim($data['link'] ?? '');
        if ($key === '') jerr("missing_data");
        $rawUsers = is_array($data['users'] ?? null) ? $data['users'] : [];

        $newList = [];
        foreach ($rawUsers as $u) {
            $u = trim((string)$u);
            if ($u !== '' && !in_array($u, $newList, true)) $newList[] = $u;
        }

        $settingsFile = __DIR__ . '/settings.json';
        $settings = readJson($settingsFile);
        if (!isset($settings['pages_access']) || !is_array($settings['pages_access'])) $settings['pages_access'] = [];
        $oldList = $settings['pages_access'][$key] ?? [];
        $settings['pages_access'][$key] = $newList;
        if (!writeJson($settingsFile, $settings)) jerr("write_error", 500);

        // MP Discord aux joueurs NOUVELLEMENT ajoutés uniquement (pas aux déjà-autorisés).
        $added = array_values(array_diff($newList, $oldList));
        if (!empty($added) && $link !== '') {
            $cfg = dco_config();
            if ($cfg) {
                $usersAll = readJson(__DIR__ . '/users_SECURE_9x.json');
                foreach ($added as $pseudo) {
                    $discordId = '';
                    foreach ($usersAll as $u) {
                        if (strcasecmp($u['user'] ?? '', $pseudo) === 0) { $discordId = (string)($u['discord_id'] ?? ''); break; }
                    }
                    if ($discordId === '') continue;
                    $msg = "🔑 **Accès accordé** : tu as maintenant accès à la page **{$title}** sur le portail des Havres Gris.\n👉 {$link}";
                    dco_dm_send($cfg, $discordId, $msg);
                }
            }
        }

        echo json_encode(['ok' => true, 'added' => $added]);
        exit;

    default: jerr("unknown_action");
}
?>