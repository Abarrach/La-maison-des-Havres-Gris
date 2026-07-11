<?php
require_once __DIR__ . '/auth_epice.php'; // session + helpers de droits
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$action = $_GET['action'] ?? '';

// Lire le body UNE seule fois (php://input n'est lisible qu'une fois)
$raw   = file_get_contents('php://input');
$input = json_decode($raw, true) ?? [];

// --- Contrôle d'accès serveur (basé sur la session du site, plus de token en dur) ---
$organize_actions = ['list', 'open_sorties', 'new_soiree', 'close_soiree', 'reopen_sortie', 'save_assign', 'save_analyse', 'history', 'sortie_detail', 'delete_sortie', 'save_sop_content'];
$member_actions   = ['init', 'get_assign', 'my_debrief', 'save_debrief', 'public_history', 'public_sortie', 'me', 'my_activity', 'get_sop_content'];
$admin_only       = ['get_orga', 'set_orga', 'activity_report'];
if      (in_array($action, $admin_only, true))       epice_require_admin();
elseif  (in_array($action, $organize_actions, true)) epice_require_organize();
elseif  (in_array($action, $member_actions, true))   epice_require_login();

$data_dir = __DIR__ . '/data';
if (!is_dir($data_dir)) mkdir($data_dir, 0755, true);
define('DATA_FILE', $data_dir . '/debriefs.json');

function read_data(): array {
    if (!file_exists(DATA_FILE)) return ['soiree_active' => null, 'sorties' => []];
    return json_decode(file_get_contents(DATA_FILE), true)
        ?? ['soiree_active' => null, 'sorties' => []];
}

// Acquiert un verrou exclusif en NON bloquant, avec quelques retries courts, plutôt qu'un
// flock() classique qui peut bloquer indéfiniment si un autre process (ex : le bot Discord
// discord_sortie.php, qui partage ce même fichier) tient le verrou trop longtemps.
function try_lock($fp, $maxWaitSeconds = 1.5) {
    $deadline = microtime(true) + $maxWaitSeconds;
    do {
        if (flock($fp, LOCK_EX | LOCK_NB)) return true;
        usleep(50000); // 50ms
    } while (microtime(true) < $deadline);
    return false;
}

function write_data(array $data): void {
    $fp = @fopen(DATA_FILE, 'c+');
    if (!$fp) out(false, [], "Écriture impossible : droits insuffisants sur data/debriefs.json (le serveur web — www-data — doit pouvoir écrire le fichier).");
    if (!try_lock($fp)) { fclose($fp); out(false, [], "Fichier de sorties occupé (accès concurrent). Réessaie dans quelques secondes."); }
    ftruncate($fp, 0); rewind($fp);
    $ok = fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if (!$ok) out(false, [], "Écriture impossible dans data/debriefs.json (droits serveur).");
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

    // Charge UNE sortie pour l'assignation. ?sid=<id> ciblé, sinon la sortie active.
    // Un organisateur ne peut charger que ses propres sorties (l'admin, toutes).
    case 'list':
        $d   = read_data();
        $sid = trim($_GET['sid'] ?? ($input['sid'] ?? ''));
        $id  = $sid !== '' ? $sid : ($d['soiree_active']['id'] ?? null);
        if (!$id) out(false, [], 'Aucune soirée active');
        $sortie = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $id) { $sortie = $s; break; } }
        if (!$sortie) out(false, [], 'Sortie introuvable');
        // Contrôle de propriété UNIQUEMENT pour un accès CIBLÉ (?sid=) : empêche un
        // organisateur de charger la sortie d'un autre. La sortie « vedette » (sans
        // sid) reste visible de tout organisateur (en-tête admin / synthèse retours).
        if ($sid !== '' && !epice_owns_sortie($sortie))
            out(false, [], 'Réservé au créateur de la sortie.');
        out(true, ['sortie' => $sortie]);

    // Sorties OUVERTES assignables : admin = toutes ; organisateur = uniquement les siennes.
    case 'open_sorties':
        $d   = read_data();
        $adm = (epice_role() === 'admin');
        $activeId = $d['soiree_active']['id'] ?? null;
        $list = [];
        foreach ($d['sorties'] as $s) {
            if (($s['statut'] ?? '') !== 'ouverte') continue;
            $mine = epice_is_creator($s);
            if (!$adm && !$mine) continue;
            $list[] = [
                'id'       => $s['id'] ?? '',
                'titre'    => $s['titre'] ?? '',
                'date'     => $s['date'] ?? '',
                'createur' => $s['createur'] ?? '',
                'mine'     => $mine,
                'active'   => (($s['id'] ?? null) === $activeId),
            ];
        }
        out(true, ['sorties' => $list, 'active_id' => $activeId]);

    case 'new_soiree':
        $titre = trim($input['titre'] ?? '');
        if (!$titre) out(false, [], 'Titre obligatoire');
        $id       = 'sortie_' . time();
        $date     = trim($input['date'] ?? date('Y-m-d'));
        $zone     = trim($input['zone'] ?? '');
        $nouvelle = ['id'=>$id,'date'=>$date,'titre'=>$titre,'zone'=>$zone,'statut'=>'ouverte','debriefs'=>[],'createur'=>epice_user()];
        $d = read_data();
        // Multi-sorties : on N'ARCHIVE PLUS les autres (plusieurs ouvertes en parallèle).
        $d['sorties'][]     = $nouvelle;
        $d['soiree_active'] = ['id'=>$id,'date'=>$date,'titre'=>$titre,'zone'=>$zone,'statut'=>'ouverte'];
        write_data($d);
        out(true, ['soiree' => $nouvelle]);

    // Clôture UNE sortie. ?sid ciblé, sinon la sortie active. Organisateur = les siennes seulement.
    case 'close_soiree':
        $d   = read_data();
        $sid = trim($input['sid'] ?? ($_GET['sid'] ?? ''));
        if ($sid === '') $sid = $d['soiree_active']['id'] ?? '';
        if ($sid === '') out(false, [], 'Aucune sortie à clôturer.');
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target) out(false, [], 'Sortie introuvable.');
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux clôturer que tes propres sorties.');
        foreach ($d['sorties'] as &$s) { if (($s['id'] ?? '') === $sid) $s['statut'] = 'archivée'; }
        unset($s);
        // Si on clôture la sortie "vedette", on désigne la plus récente encore ouverte (ou rien).
        if (($d['soiree_active']['id'] ?? null) === $sid) {
            $d['soiree_active'] = null;
            foreach (array_reverse($d['sorties']) as $s) {
                if (($s['statut'] ?? '') === 'ouverte') {
                    $d['soiree_active'] = ['id'=>$s['id'],'date'=>$s['date'] ?? '','titre'=>$s['titre'] ?? '','zone'=>$s['zone'] ?? '','statut'=>'ouverte'];
                    break;
                }
            }
        }
        write_data($d);
        out(true, ['message' => 'Sortie clôturée']);

    // Sauvegarder l'assignation des rôles. ?sid ciblé, sinon active. Ouverte + (admin OU créateur).
    case 'save_assign':
        $d   = read_data();
        $sid = trim($input['sid'] ?? '');
        if ($sid === '') $sid = $d['soiree_active']['id'] ?? '';
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target || ($target['statut'] ?? '') !== 'ouverte') out(false, [], 'Sortie introuvable ou non ouverte — modification impossible.');
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux modifier que la compo de tes propres sorties.');
        foreach ($d['sorties'] as &$s) {
            if (($s['id'] ?? '') === $sid) { $s['assignation'] = $input['assignation'] ?? []; break; }
        }
        unset($s);
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

    // Lire l'assignation de la soirée active (public — vue joueur). UNIQUEMENT si ouverte.
    case 'get_assign':
        $d  = read_data();
        $a  = $d['soiree_active'] ?? null;
        $id = $a['id'] ?? null;
        if (!$id || ($a['statut'] ?? '') !== 'ouverte') out(false, [], 'Aucune soirée active');
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $id) {
                out(true, [
                    'soiree'      => ['titre'=>$s['titre'],'date'=>$s['date'],'zone'=>$s['zone']],
                    'assignation' => $s['assignation'] ?? null
                ]);
            }
        }
        out(false, [], 'Soirée introuvable');

    // Historique PUBLIC (vue joueur) — liste assainie : AUCUN retour, note ni analyse
    case 'public_history':
        $d = read_data();
        $resume = array_map(function($s) {
            return [
                'id'      => $s['id'],
                'date'    => $s['date'],
                'titre'   => $s['titre'],
                'zone'    => $s['zone'] ?? '',
                'statut'  => $s['statut'],
                'a_compo' => !empty($s['assignation']),
            ];
        }, $d['sorties']);
        out(true, ['sorties' => array_reverse($resume)]);

    // Compo PUBLIQUE d'une sortie donnée (vue joueur) — compo seule, JAMAIS les retours/analyse
    case 'public_sortie':
        $sid = $_GET['sid'] ?? '';
        $d   = read_data();
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $sid) {
                out(true, [
                    'soiree'      => ['titre'=>$s['titre'],'date'=>$s['date'],'zone'=>$s['zone'],'statut'=>$s['statut']],
                    'assignation' => $s['assignation'] ?? null
                ]);
            }
        }
        out(false, [], 'Sortie introuvable');

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
                'createur' => $s['createur'] ?? '',
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

    // Rouvrir une sortie archivée : elle redevient OUVERTE et la sortie « vedette »
    // (assignation + retours possibles). Admin = toutes ; organisateur = les siennes.
    case 'reopen_sortie':
        $sid = trim($input['sid'] ?? ($_GET['sid'] ?? ''));
        if ($sid === '') out(false, [], 'ID manquant');
        $d = read_data();
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target) out(false, [], 'Sortie introuvable');
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux rouvrir que tes propres sorties.');
        foreach ($d['sorties'] as &$s) { if (($s['id'] ?? '') === $sid) $s['statut'] = 'ouverte'; }
        unset($s);
        $d['soiree_active'] = ['id'=>$target['id'],'date'=>$target['date'] ?? '','titre'=>$target['titre'] ?? '','zone'=>$target['zone'] ?? '','statut'=>'ouverte'];
        write_data($d);
        out(true, ['message' => 'Sortie rouverte']);

    // Supprimer une sortie (admin — nettoyage / tests)
    case 'delete_sortie':
        $sid = trim($input['sid'] ?? ($_GET['sid'] ?? ''));
        if (!$sid) out(false, [], 'ID manquant');
        $d = read_data();
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target) out(false, [], 'Sortie introuvable');
        // Un organisateur ne supprime QUE ses propres sorties ; l'admin peut tout supprimer
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux supprimer que les sorties que tu as créées.');
        $d['sorties'] = array_values(array_filter($d['sorties'], function($s) use ($sid) {
            return ($s['id'] ?? '') !== $sid;
        }));
        // Si on supprime la sortie active, on désactive
        if (($d['soiree_active']['id'] ?? null) === $sid) $d['soiree_active'] = null;
        write_data($d);
        out(true, ['message' => 'Sortie supprimée']);

    // Identité + droits de l'utilisateur courant (pour l'UI)
    case 'me':
        out(true, ['user' => epice_user(), 'role' => epice_role(), 'can_organize' => epice_can_organize()]);

    // Mes activités (Mon Compte) : sorties QUE J'AI ORGANISÉES / AUXQUELLES J'AI PARTICIPÉ.
    // Personnel uniquement — jamais de comparaison avec d'autres membres (cf. rapport admin
    // séparé, action activity_report). Toutes sorties confondues (épice + autres types).
    case 'my_activity':
        $me        = epice_user() ?? '';
        $myDiscord = (string)($_SESSION['discord_id'] ?? '');
        $organized = [];
        $attended  = [];

        $dstoreFile = __DIR__ . '/data/discord_sorties.json';
        $dstore = file_exists($dstoreFile) ? (json_decode(file_get_contents($dstoreFile), true) ?: ['sorties' => []]) : ['sorties' => []];

        foreach ([read_data(), $dstore] as $store) {
            foreach ($store['sorties'] ?? [] as $s) {
                $entry = ['titre' => $s['titre'] ?? '(sans titre)', 'date' => $s['date'] ?? '', 'type' => $s['type'] ?? 'epice'];
                // Organiser une sortie = déjà compté présent pour celle-ci, pas besoin
                // d'être aussi inscrit (mêmes règles que le rapport admin activity_report).
                if (epice_is_creator($s)) { $organized[] = $entry; continue; }
                foreach ($s['signups'] ?? [] as $su) {
                    if (($su['statut'] ?? 'present') !== 'present') continue;
                    $isMe = ($myDiscord !== '' && (string)($su['id'] ?? '') === $myDiscord)
                         || ($me !== '' && strcasecmp((string)($su['name'] ?? ''), $me) === 0);
                    if ($isMe) { $attended[] = $entry; break; }
                }
            }
        }
        usort($organized, fn($a, $b) => strcmp($b['date'], $a['date']));
        usort($attended, fn($a, $b) => strcmp($b['date'], $a['date']));
        out(true, ['organized' => $organized, 'attended' => $attended]);

    // Liste des organisateurs (admin)
    case 'get_orga':
        out(true, ['organizers' => epice_organizers()]);

    // Définir la liste des organisateurs (admin)
    case 'set_orga':
        $list = $input['organizers'] ?? [];
        if (!is_array($list)) out(false, [], 'Format invalide');
        $clean = [];
        foreach ($list as $n) { $n = trim((string)$n); if ($n !== '' && !in_array($n, $clean, true)) $clean[] = $n; }
        $ok = @file_put_contents(__DIR__ . '/data/organizers.json', json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
        if (!$ok) out(false, [], "Écriture impossible (droits sur data/organizers.json).");
        out(true, ['organizers' => $clean, 'message' => 'Organisateurs enregistrés']);

    // Contenu personnalisé du Manuel de combat (édité directement sur la page par un
    // organisateur, cf debrief.html #sop-editable). html='' → le front garde son contenu par
    // défaut livré dans le code, pas besoin de dupliquer le texte par défaut ici.
    case 'get_sop_content':
        $p = __DIR__ . '/data/sop_content.json';
        $html = '';
        if (file_exists($p)) {
            $j = json_decode(file_get_contents($p), true);
            $html = is_array($j) ? (string)($j['html'] ?? '') : '';
        }
        out(true, ['html' => $html]);

    case 'save_sop_content':
        $html = (string)($input['html'] ?? '');
        $ok = @file_put_contents(__DIR__ . '/data/sop_content.json', json_encode([
            'html' => $html, 'date' => date('Y-m-d H:i'), 'by' => epice_user(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
        if (!$ok) out(false, [], "Écriture impossible (droits sur data/sop_content.json).");
        out(true, ['message' => 'Manuel de combat enregistré']);

    // Rapport admin : qui organise / qui participe aux activités (toutes sorties,
    // épice ET autres types). Réservé admin — jamais exposé aux joueurs (pas de
    // classement social visible). Croise debriefs.json + discord_sorties.json.
    case 'activity_report':
        $usersFile = __DIR__ . '/../users_SECURE_9x.json';
        $users = file_exists($usersFile) ? (json_decode(file_get_contents($usersFile), true) ?: []) : [];
        $pseudoByDiscordId = [];
        $allPseudos = [];
        foreach ($users as $u) {
            $p = trim((string)($u['user'] ?? ''));
            if ($p === '') continue;
            $allPseudos[] = $p;
            if (!empty($u['discord_id'])) $pseudoByDiscordId[(string)$u['discord_id']] = $p;
        }

        // Résout un identifiant de sortie (organisateur ou inscrit) vers un pseudo du
        // site : priorité à l'id Discord (immuable), repli sur le nom en clair.
        $resolve = function (string $discordId, string $rawName) use ($pseudoByDiscordId, $allPseudos): string {
            if ($discordId !== '' && isset($pseudoByDiscordId[$discordId])) return $pseudoByDiscordId[$discordId];
            foreach ($allPseudos as $p) { if (strcasecmp($p, $rawName) === 0) return $p; }
            return $rawName !== '' ? $rawName . ' (non lié)' : '?';
        };

        $stats = []; // pseudo => ['organized'=>[{titre,date,type}], 'attended'=>[...], 'present'=>int]
        $ensure = function (string $key) use (&$stats) {
            if (!isset($stats[$key])) $stats[$key] = ['organized' => [], 'attended' => [], 'present' => 0];
        };

        $dstoreFile = __DIR__ . '/data/discord_sorties.json';
        $dstore = file_exists($dstoreFile) ? (json_decode(file_get_contents($dstoreFile), true) ?: ['sorties' => []]) : ['sorties' => []];

        foreach ([read_data(), $dstore] as $store) {
            foreach ($store['sorties'] ?? [] as $s) {
                $entry = ['titre' => $s['titre'] ?? '(sans titre)', 'date' => $s['date'] ?? '', 'type' => $s['type'] ?? 'epice'];

                // Organiser une sortie = compté organisateur ET présent pour CETTE sortie
                // (on ne demande pas à l'organisateur de s'auto-inscrire pour être crédité).
                $organizer = $resolve((string)($s['discord']['user_id'] ?? ''), (string)($s['createur'] ?? ''));
                $ensure($organizer);
                $stats[$organizer]['organized'][] = $entry;
                $stats[$organizer]['present']++;
                $presentHere = [$organizer => true]; // anti-doublon si l'organisateur s'est AUSSI inscrit

                foreach ($s['signups'] ?? [] as $su) {
                    if (($su['statut'] ?? 'present') !== 'present') continue;
                    $p = $resolve((string)($su['id'] ?? ''), (string)($su['name'] ?? ''));
                    if (isset($presentHere[$p])) continue;
                    $presentHere[$p] = true;
                    $ensure($p);
                    $stats[$p]['present']++;
                    $stats[$p]['attended'][] = $entry;
                }
            }
        }

        // Le roster complet est inclus même à 0/0 (repérer ceux qui ne font ni l'un ni l'autre).
        foreach ($allPseudos as $p) { $ensure($p); }

        $rows = [];
        foreach ($stats as $pseudo => $v) {
            usort($v['organized'], fn($a, $b) => strcmp($b['date'], $a['date']));
            usort($v['attended'], fn($a, $b) => strcmp($b['date'], $a['date']));
            $rows[] = [
                'pseudo'        => $pseudo,
                'organized'     => count($v['organized']),
                'present'       => $v['present'],
                'organized_list'=> $v['organized'],
                'attended_list' => $v['attended'],
            ];
        }
        usort($rows, fn($a, $b) => ($b['organized'] + $b['present']) <=> ($a['organized'] + $a['present']));

        out(true, ['rows' => $rows]);

    default:
        out(false, [], 'Action inconnue : ' . htmlspecialchars($action));
}
