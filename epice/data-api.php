<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-App-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once 'config.php';

$action = $_GET['action'] ?? '';

// Lire le body UNE seule fois (php://input n'est lisible qu'une fois)
$raw   = file_get_contents('php://input');
$input = json_decode($raw, true) ?? [];

// Token : accepté depuis le header OU depuis le body (contournement filtre Apache)
$admin_actions = ['list', 'new_soiree', 'close_soiree', 'save_assign', 'save_analyse', 'history', 'sortie_detail'];
if (in_array($action, $admin_actions)) {
    $token = $_SERVER['mhg_2026_recolte_epice_xK9p'] ?? $input['_token'] ?? $_GET['_t'] ?? '';
    if ($token !== APP_SECRET) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Accès non autorisé']);
        exit;
    }
}

$data_dir = __DIR__ . '/data';
if (!is_dir($data_dir)) mkdir($data_dir, 0755, true);
define('DATA_FILE', $data_dir . '/debriefs.json');

function read_data(): array {
    if (!file_exists(DATA_FILE)) return ['soiree_active' => null, 'sorties' => []];
    return json_decode(file_get_contents(DATA_FILE), true)
        ?? ['soiree_active' => null, 'sorties' => []];
}

function write_data(array $data): void {
    $fp = fopen(DATA_FILE, 'c+');
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

function out(bool $ok, array $payload = [], string $err = ''): void {
    echo json_encode(
        $ok ? array_merge(['ok' => true], $payload) : ['ok' => false, 'error' => $err],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

// Minuscule insensible à la casse, sans dépendre de l'extension mbstring (absente sur ce serveur)
function lc($s): string {
    return function_exists('mb_strtolower') ? mb_strtolower((string)$s) : strtolower((string)$s);
}

// Liste dédupliquée des participants à partir de l'assignation (pour la liste déroulante joueur)
function roster_from_assign($a): array {
    if (!is_array($a)) return [];
    $names = [];
    $push = function ($v) use (&$names) { $v = trim((string)$v); if ($v !== '') $names[] = $v; };
    $cm = $a['commandement'] ?? [];
    foreach (['cs','cdr','cp'] as $k) $push($cm[$k] ?? '');
    foreach (($a['recolte'] ?? []) as $g) foreach (['transporteur','moissonneur','defenseur_cac'] as $k) $push($g[$k] ?? '');
    $df = $a['defense'] ?? [];
    foreach (['nord','sud','est','ouest'] as $k) {
        $v = $df[$k] ?? '';
        if (is_array($v)) { $push($v['nom'] ?? ''); $push($v['passager'] ?? ''); } // nouveau format {nom,faucon,passager}
        else $push($v); // rétro-compat ancien format chaîne
    }
    foreach (($a['distance']['pilotes'] ?? []) as $p) { $push($p['nom'] ?? ''); $push($p['passager'] ?? ''); }
    foreach (($a['ingame'] ?? []) as $g) foreach (($g['membres'] ?? []) as $m) $push($m);
    // rétro-compat ancien format
    foreach (($a['patrouille'] ?? []) as $b) { $push($b['a'] ?? ''); $push($b['b'] ?? ''); }
    foreach (($a['faucon'] ?? []) as $b) { $push($b['pilote'] ?? ''); $push($b['passager'] ?? ''); }
    $seen = []; $out = [];
    foreach ($names as $n) { $key = lc($n); if (!isset($seen[$key])) { $seen[$key] = 1; $out[] = $n; } }
    sort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return $out;
}

switch ($action) {

    case 'init':
        $d = read_data();
        $a = $d['soiree_active'] ?? null;
        if (!$a || $a['statut'] !== 'ouverte') out(false, [], 'Aucune soirée ouverte');
        $assign = null;
        foreach ($d['sorties'] as $s) { if ($s['id'] === $a['id']) { $assign = $s['assignation'] ?? null; break; } }
        out(true, ['soiree' => $a, 'participants' => roster_from_assign($assign)]);

    // Retour existant d'un joueur (public — pour pré-remplir / modifier)
    case 'my_debrief':
        $pseudo = trim($_GET['pseudo'] ?? '');
        $d  = read_data();
        $id = $d['soiree_active']['id'] ?? null;
        if (!$pseudo || !$id) out(true, ['debrief' => null]);
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $id) {
                foreach ($s['debriefs'] ?? [] as $db) {
                    if (lc(trim($db['pseudo'] ?? '')) === lc($pseudo)) out(true, ['debrief' => $db]);
                }
            }
        }
        out(true, ['debrief' => null]);

    case 'save_debrief':
        $pseudo = trim($input['pseudo'] ?? '');
        $note   = intval($input['note'] ?? 0);
        if (!$pseudo || $note < 1 || $note > 5) out(false, [], 'Pseudo et note obligatoires');
        $d  = read_data();
        $id = $d['soiree_active']['id'] ?? null;
        if (!$id) out(false, [], 'Aucune soirée ouverte');
        $debrief = [
            'timestamp'    => date('H:i'),
            'pseudo'       => $pseudo,
            'role'         => trim($input['role'] ?? ''),
            'note'         => $note,
            'sliders'      => $input['sliders']      ?? [],
            'bien'         => $input['bien']          ?? [],
            'bien_autre'   => trim($input['bien_autre']  ?? ''),
            'points_noirs' => $input['points_noirs']  ?? [],
            'pn_autre'     => trim($input['pn_autre']    ?? ''),
            'libre'        => trim($input['libre']        ?? ''),
        ];
        $done = false; $updated = false;
        foreach ($d['sorties'] as &$s) {
            if ($s['id'] !== $id) continue;
            if (($s['statut'] ?? '') !== 'ouverte') out(false, [], 'Cette soirée est clôturée — modification impossible.');
            if (!isset($s['debriefs']) || !is_array($s['debriefs'])) $s['debriefs'] = [];
            foreach ($s['debriefs'] as &$ex) {
                if (lc(trim($ex['pseudo'] ?? '')) === lc($pseudo)) {
                    $debrief['id'] = $ex['id'] ?? ('db_' . uniqid('', true)); // conserve l'id existant
                    $ex = $debrief; $updated = true; break;
                }
            }
            unset($ex);
            if (!$updated) { $debrief['id'] = 'db_' . uniqid('', true); $s['debriefs'][] = $debrief; }
            $done = true; break;
        }
        unset($s);
        if (!$done) out(false, [], 'Soirée introuvable');
        write_data($d);
        out(true, ['message' => $updated ? 'Retour mis à jour' : 'Retour enregistré', 'updated' => $updated]);

    case 'list':
        $d  = read_data();
        $id = $d['soiree_active']['id'] ?? null;
        if (!$id) out(false, [], 'Aucune soirée active');
        $sortie = null;
        foreach ($d['sorties'] as $s) { if ($s['id'] === $id) { $sortie = $s; break; } }
        out(true, ['sortie' => $sortie]);

    case 'new_soiree':
        $titre = trim($input['titre'] ?? '');
        if (!$titre) out(false, [], 'Titre obligatoire');
        $id       = 'sortie_' . time();
        $date     = trim($input['date'] ?? date('Y-m-d'));
        $zone     = trim($input['zone'] ?? '');
        $nouvelle = ['id'=>$id,'date'=>$date,'titre'=>$titre,'zone'=>$zone,'statut'=>'ouverte','debriefs'=>[]];
        $d = read_data();
        foreach ($d['sorties'] as &$s) { if ($s['statut']==='ouverte') $s['statut']='archivée'; }
        $d['sorties'][]     = $nouvelle;
        $d['soiree_active'] = ['id'=>$id,'date'=>$date,'titre'=>$titre,'zone'=>$zone,'statut'=>'ouverte'];
        write_data($d);
        out(true, ['soiree' => $nouvelle]);

    case 'close_soiree':
        $d = read_data();
        foreach ($d['sorties'] as &$s) { if ($s['statut']==='ouverte') $s['statut']='archivée'; }
        if ($d['soiree_active']) $d['soiree_active']['statut'] = 'archivée';
        write_data($d);
        out(true, ['message' => 'Soirée clôturée']);

    // Sauvegarder l'assignation des rôles (admin)
    case 'save_assign':
        $d  = read_data();
        $id = $d['soiree_active']['id'] ?? null;
        if (!$id) out(false, [], 'Aucune soirée active');
        foreach ($d['sorties'] as &$s) {
            if ($s['id'] === $id) { $s['assignation'] = $input['assignation'] ?? []; break; }
        }
        write_data($d);
        out(true, ['message' => 'Assignation enregistrée']);

    // Sauvegarder l'analyse IA de la soirée active (admin)
    case 'save_analyse':
        $d  = read_data();
        $id = $d['soiree_active']['id'] ?? null;
        if (!$id) out(false, [], 'Aucune soirée active');
        $txt = trim($input['analyse'] ?? '');
        foreach ($d['sorties'] as &$s) {
            if ($s['id'] === $id) { $s['analyse'] = ['texte' => $txt, 'date' => date('Y-m-d H:i')]; break; }
        }
        unset($s);
        write_data($d);
        out(true, ['message' => 'Analyse enregistrée']);

    // Lire l'assignation de la soirée active (public — vue joueur)
    case 'get_assign':
        $d  = read_data();
        $id = $d['soiree_active']['id'] ?? null;
        if (!$id) out(false, [], 'Aucune soirée active');
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $id) {
                out(true, [
                    'soiree'      => ['titre'=>$s['titre'],'date'=>$s['date'],'zone'=>$s['zone']],
                    'assignation' => $s['assignation'] ?? null
                ]);
            }
        }
        out(false, [], 'Soirée introuvable');

    // Liste résumée de toutes les sorties (admin — historique)
    case 'history':
        $d = read_data();
        $resume = array_map(function($s) {
            $nb = count($s['debriefs'] ?? []);
            return [
                'id'       => $s['id'],
                'date'     => $s['date'],
                'titre'    => $s['titre'],
                'zone'     => $s['zone'] ?? '',
                'statut'   => $s['statut'],
                'nb'       => $nb,
                'note_moy' => $nb ? round(array_sum(array_column($s['debriefs'],'note')) / $nb, 1) : null,
                'a_compo'  => !empty($s['assignation']),
                'a_analyse'=> !empty($s['analyse']['texte'] ?? ''),
            ];
        }, $d['sorties']);
        out(true, ['sorties' => array_reverse($resume)]);

    // Détail complet d'une sortie (admin — historique)
    case 'sortie_detail':
        $sid = $_GET['sid'] ?? '';
        $d   = read_data();
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $sid) out(true, ['sortie' => $s]);
        }
        out(false, [], 'Sortie introuvable');

    default:
        out(false, [], 'Action inconnue : ' . htmlspecialchars($action));
}
