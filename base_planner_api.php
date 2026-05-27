<?php
/**
 * base_planner_api.php
 *
 * CRUD pour les plans du Constructeur de Base.
 *
 * Stockage : un unique fichier `base_plans.json` à la racine du projet, format :
 *   { "plans": [ { id, owner, name, description, share_token, data, created_at, updated_at }, ... ] }
 *
 * Auth : le frontend envoie `owner` (pseudo connecté) dans chaque requête. Les actions
 * destructives (update/delete/share) vérifient que `owner` matche le propriétaire enregistré
 * — c'est la même convention que les autres API du projet (`migration_api.php`, etc.).
 *
 * Actions (POST avec champ `action`) :
 *   - list           : liste des plans d'un owner
 *   - load           : charge un plan par id (le requérant doit être owner OU le plan public)
 *   - load_shared    : charge un plan via son share_token (public, lecture seule)
 *   - save           : crée un nouveau plan OU met à jour un existant (si `id` fourni)
 *   - delete         : supprime un plan (owner uniquement)
 *   - share          : génère/retourne un share_token pour le plan (owner uniquement)
 *   - unshare        : retire le token public (owner uniquement)
 */

header('Content-Type: application/json');

$file = 'base_plans.json';

/** Charge l'index des plans. */
function loadPlans($file) {
  if (!file_exists($file)) return ['plans' => []];
  $raw = file_get_contents($file);
  $data = json_decode($raw, true);
  if (!is_array($data) || !isset($data['plans'])) return ['plans' => []];
  return $data;
}

/** Sauvegarde l'index. */
function savePlans($file, $data) {
  $ok = file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
  if ($ok === false) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'write_error']);
    exit;
  }
}

/** Identifiant unique court. */
function genId($prefix) {
  return $prefix . '_' . bin2hex(random_bytes(6));
}

/** Retire le champ `data` (volumineux) pour la liste. */
function summarize($p) {
  return [
    'id'           => $p['id'],
    'owner'        => $p['owner'],
    'name'         => $p['name'],
    'description'  => isset($p['description']) ? $p['description'] : '',
    'share_token'  => isset($p['share_token']) ? $p['share_token'] : null,
    'is_shared'    => !empty($p['share_token']),
    'created_at'   => $p['created_at'],
    'updated_at'   => $p['updated_at'],
    'item_count'   => isset($p['data']['item_count']) ? $p['data']['item_count'] : null,
    'floor_count'  => isset($p['data']['floor_count']) ? $p['data']['floor_count'] : null,
  ];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['status' => 'error', 'message' => 'method_not_allowed']);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  echo json_encode(['status' => 'error', 'message' => 'invalid_json']);
  exit;
}

$action = isset($input['action']) ? $input['action'] : '';
$owner  = isset($input['owner']) ? trim($input['owner']) : '';
$index  = loadPlans($file);

// ─── LIST ──────────────────────────────────────────────────────────────────
if ($action === 'list') {
  if (empty($owner)) { echo json_encode(['status' => 'error', 'message' => 'missing_owner']); exit; }
  $mine = [];
  foreach ($index['plans'] as $p) {
    if (strcasecmp($p['owner'], $owner) === 0) $mine[] = summarize($p);
  }
  // Trie par updated_at descendant
  usort($mine, function($a, $b) { return $b['updated_at'] - $a['updated_at']; });
  echo json_encode(['status' => 'ok', 'plans' => $mine]);
  exit;
}

// ─── LOAD (par id, owner-only ou public) ───────────────────────────────────
if ($action === 'load') {
  $id = isset($input['id']) ? $input['id'] : '';
  foreach ($index['plans'] as $p) {
    if ($p['id'] === $id) {
      // Si pas owner et pas public → refus
      $isOwner  = strcasecmp($p['owner'], $owner) === 0;
      $isPublic = !empty($p['share_token']);
      if (!$isOwner && !$isPublic) {
        echo json_encode(['status' => 'error', 'message' => 'forbidden']);
        exit;
      }
      echo json_encode(['status' => 'ok', 'plan' => $p, 'readonly' => !$isOwner]);
      exit;
    }
  }
  echo json_encode(['status' => 'error', 'message' => 'not_found']);
  exit;
}

// ─── LOAD_SHARED (par token public, lecture seule) ─────────────────────────
if ($action === 'load_shared') {
  $token = isset($input['token']) ? $input['token'] : '';
  if (empty($token)) { echo json_encode(['status' => 'error', 'message' => 'missing_token']); exit; }
  foreach ($index['plans'] as $p) {
    if (isset($p['share_token']) && $p['share_token'] === $token) {
      $isOwner = strcasecmp($p['owner'], $owner) === 0;
      echo json_encode(['status' => 'ok', 'plan' => $p, 'readonly' => !$isOwner]);
      exit;
    }
  }
  echo json_encode(['status' => 'error', 'message' => 'not_found']);
  exit;
}

// ─── SAVE (créer ou update) ────────────────────────────────────────────────
if ($action === 'save') {
  if (empty($owner)) { echo json_encode(['status' => 'error', 'message' => 'missing_owner']); exit; }
  $id   = isset($input['id']) ? $input['id'] : '';
  $name = isset($input['name']) ? trim($input['name']) : '';
  $desc = isset($input['description']) ? trim($input['description']) : '';
  $data = isset($input['data']) ? $input['data'] : null;

  if (empty($name) || $data === null) {
    echo json_encode(['status' => 'error', 'message' => 'missing_fields']);
    exit;
  }
  $now = time();

  if ($id) {
    // Update : vérifie l'ownership
    $found = false;
    foreach ($index['plans'] as &$p) {
      if ($p['id'] === $id) {
        if (strcasecmp($p['owner'], $owner) !== 0) {
          echo json_encode(['status' => 'error', 'message' => 'forbidden']);
          exit;
        }
        $p['name']        = $name;
        $p['description'] = $desc;
        $p['data']        = $data;
        $p['updated_at']  = $now;
        $found = true;
        $saved = $p;
        break;
      }
    }
    unset($p);
    if (!$found) {
      echo json_encode(['status' => 'error', 'message' => 'not_found']);
      exit;
    }
  } else {
    // Create
    $saved = [
      'id'           => genId('plan'),
      'owner'        => $owner,
      'name'         => $name,
      'description'  => $desc,
      'share_token'  => null,
      'data'         => $data,
      'created_at'   => $now,
      'updated_at'   => $now,
    ];
    $index['plans'][] = $saved;
  }
  savePlans($file, $index);
  echo json_encode(['status' => 'ok', 'plan' => summarize($saved)]);
  exit;
}

// ─── DELETE ────────────────────────────────────────────────────────────────
if ($action === 'delete') {
  if (empty($owner)) { echo json_encode(['status' => 'error', 'message' => 'missing_owner']); exit; }
  $id = isset($input['id']) ? $input['id'] : '';
  $found = false;
  $newPlans = [];
  foreach ($index['plans'] as $p) {
    if ($p['id'] === $id) {
      if (strcasecmp($p['owner'], $owner) !== 0) {
        echo json_encode(['status' => 'error', 'message' => 'forbidden']);
        exit;
      }
      $found = true;
      continue; // skip → suppression
    }
    $newPlans[] = $p;
  }
  if (!$found) {
    echo json_encode(['status' => 'error', 'message' => 'not_found']);
    exit;
  }
  $index['plans'] = $newPlans;
  savePlans($file, $index);
  echo json_encode(['status' => 'ok']);
  exit;
}

// ─── SHARE (génère ou retourne le token) ───────────────────────────────────
if ($action === 'share') {
  if (empty($owner)) { echo json_encode(['status' => 'error', 'message' => 'missing_owner']); exit; }
  $id = isset($input['id']) ? $input['id'] : '';
  foreach ($index['plans'] as &$p) {
    if ($p['id'] === $id) {
      if (strcasecmp($p['owner'], $owner) !== 0) {
        echo json_encode(['status' => 'error', 'message' => 'forbidden']);
        exit;
      }
      if (empty($p['share_token'])) {
        $p['share_token'] = genId('tok');
        $p['updated_at']  = time();
        savePlans($file, $index);
      }
      echo json_encode(['status' => 'ok', 'share_token' => $p['share_token']]);
      exit;
    }
  }
  unset($p);
  echo json_encode(['status' => 'error', 'message' => 'not_found']);
  exit;
}

// ─── UNSHARE ───────────────────────────────────────────────────────────────
if ($action === 'unshare') {
  if (empty($owner)) { echo json_encode(['status' => 'error', 'message' => 'missing_owner']); exit; }
  $id = isset($input['id']) ? $input['id'] : '';
  foreach ($index['plans'] as &$p) {
    if ($p['id'] === $id) {
      if (strcasecmp($p['owner'], $owner) !== 0) {
        echo json_encode(['status' => 'error', 'message' => 'forbidden']);
        exit;
      }
      $p['share_token'] = null;
      $p['updated_at']  = time();
      savePlans($file, $index);
      echo json_encode(['status' => 'ok']);
      exit;
    }
  }
  unset($p);
  echo json_encode(['status' => 'error', 'message' => 'not_found']);
  exit;
}

echo json_encode(['status' => 'error', 'message' => 'unknown_action']);
